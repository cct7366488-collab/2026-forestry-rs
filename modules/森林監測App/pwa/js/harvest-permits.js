// js/harvest-permits.js — 土肉桂修枝（修下枝葉採取）：林產物採取許可電子化（全鏈路 + 公文稿 + 合作社彙整，v2.11.44）
//
// 行政流程（依《森林法》第 15 條 / 林產物處分相關規定）：
//   林農申請（修枝）→ 林保署核准（生法定許可文號）→ 葉片採收量登錄（累計實際量）→ 結案
//   v2.11.69：許可不再預估/限制採收量，葉片採收以實際回報為準（不設上限）
//   雙軌：申請端可印「申請公文函稿」、核准端可印「林產物採取許可單」（皆即時由線上記錄產生，不另存副本）
//
// 狀態機：
//   draft ─送出→ submitted ─分署─┬─核准（transaction 生許可文號）→ approved
//                                ├─駁回→ rejected（終結）
//                                └─補件→ revision ─補正再送→ submitted
//   approved ─首筆葉片採收登錄→ harvesting ─結案→ completed
//
// 權限分流（與 firestore.rules 對齊）：
//   林農端（pi/surveyor/admin，canCollect）：申請/編輯草稿/送出/刪草稿、葉片採收量登錄/結案
//   分署端（harvest_authority/admin）：僅 submitted 時核准/駁回/補件，受限只能寫狀態+審核欄位+文號
//   合作社（coop/admin）：唯讀觀察者 — 修枝葉片採收彙整分頁（總覽 + 依林農葉片採收彙整供共同銷售）；無寫入權
//   許可文號：counters/harvestPermit 原子流水號（runTransaction，法定編號不可重號）
//
// 注意：本模組所有 import 的 ?v= 須與 index.html / app.js 一致（ESM 單實例，見 SW v2.10.2 雷）
// 文案：B1（2026-05-20 分署意見）申請主體＝「修枝」、事後實際量＝「葉片採收」；Firestore field 名一律不動（保 prod 資料）。

import { fb, $, el, toast, openModal, closeModal, state, isPi, isSystemAdmin } from './app.js?v=21192';

// ⚠ 不可在模組頂層 destructure fb：app.js ⇄ harvest-permits.js 為循環 import，
//   模組求值時 app.js body 尚未執行、export const fb 還在 TDZ → 整個 module graph throw → 白畫面。
//   改 lazy bind（與 forms.js 一律用 fb.x 同理）；每個進入點函式開頭呼叫 bindFb()。
let db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp, runTransaction;
let _fbBound = false;
function bindFb() {
  if (_fbBound) return;
  ({ db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp, runTransaction } = fb);
  _fbBound = true;
}

export const HP_STATUS = {
  draft:        { label: '草稿',         cls: 'bg-stone-100 text-stone-700' },
  submitted:    { label: '已送出・待審', cls: 'bg-amber-100 text-amber-800' },
  under_review: { label: '審核中',       cls: 'bg-blue-100 text-blue-800' },
  revision:     { label: '要求補件',     cls: 'bg-orange-100 text-orange-800' },
  approved:     { label: '已核准',       cls: 'bg-emerald-100 text-emerald-800' },
  harvesting:   { label: '修枝作業中',   cls: 'bg-teal-100 text-teal-800' },
  completed:    { label: '已結案',       cls: 'bg-slate-200 text-slate-700' },
  rejected:     { label: '已駁回',       cls: 'bg-red-100 text-red-800' }
};

const HARVEST_METHODS = ['修枝', '其他'];

function hpBadge(status) {
  const m = HP_STATUS[status] || HP_STATUS.draft;
  return el('span', { class: `text-xs px-2 py-0.5 rounded font-medium ${m.cls}` }, m.label);
}

function fmtNum(n) { return (n == null || n === '') ? '—' : String(n); }

async function loadPermits(projectId) {
  const ref = collection(db, 'projects', projectId, 'harvestPermits');
  const snap = await getDocs(query(ref, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadLogs(projectId, permitId) {
  const ref = collection(db, 'projects', projectId, 'harvestPermits', permitId, 'logs');
  const snap = await getDocs(query(ref, orderBy('logDate', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 法定許可文號（ROC 年 + 專案級原子流水號）— 不可重號
function buildPermitNo(seq) {
  const roc = new Date().getFullYear() - 1911;
  return `林保中-土肉桂修枝-${roc}-${String(seq).padStart(3, '0')}`;
}

// v2.11.61：林農申請發文字號（送出時 transaction 原子產生）— 大雪山林業合作社（修）字第 XXX 號
//   專案級流水號，三位零填補。送出 (draft/revision → submitted) 時產生一次、回退/再送不重編。
//   合作社名目前 hardcode；未來若多合作社共用系統，加 project.applicantOrgName 欄位以
//   project.applicantOrgName || '大雪山林業合作社' fallback。
function buildApplicantDocNo(seq) {
  return `大雪山林業合作社（修）字第${String(seq).padStart(3, '0')}號`;
}

// v2.11.69：原 quotaInfo 已廢除（業務拍板：許可只許可修枝作業、不預估/限制採收量；
//   採收量以實際回報為準、不設預估上限）。schema 保留 approvedAmount_kg 欄位向後相容，
//   但核准時一律寫 null、UI 全部不顯示。既有資料（吳宏斌 null / 陳璽元 0.9）不動。
//   累計回報量改成單純顯示 totalLogged_kg、不再與核准量做對照。

// ===== 共用：申請卡片 =====
function permitCard(project, p, reviewMode) {
  const mineOrManager = p.createdBy === state.user.uid || isPi() || isSystemAdmin();
  const canEdit = mineOrManager && (p.status === 'draft' || p.status === 'revision');
  // v2.11.39：填報/結案改至「🌾 葉片採收回報及結案」分頁（renderHarvestReport），申請卡僅指路
  const needsReport = mineOrManager && (p.status === 'approved' || p.status === 'harvesting');
  const hasPermitDoc = p.status === 'approved' || p.status === 'harvesting' || p.status === 'completed';

  const rows = [
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('span', { class: 'font-semibold' }, p.applicantName || '（未填申請人）'),
      hpBadge(p.status),
      p.permitNo ? el('span', { class: 'text-xs text-stone-500' }, `許可文號 ${p.permitNo}`) : null
    ),
    el('div', { class: 'text-sm text-stone-600' },
      `林地：${p.landParcel || '—'}　面積：${fmtNum(p.forestArea_ha)} ha　修枝株數：${fmtNum(p.estTrees)}`),
    el('div', { class: 'text-xs text-stone-500' },
      `修枝方式：${p.harvestMethod || '—'}　修枝期間：${p.periodFrom || '—'} ~ ${p.periodTo || '—'}`)
  ];
  // v2.11.55：若有 picker 帶出的結構化 meta → 補一行系統識別摘要（讓 user 視覺確認沒選錯）
  if (p.landParcelMeta && (p.landParcelMeta.zone || p.landParcelMeta.lessee)) {
    const m = p.landParcelMeta;
    const parts = [m.zone, m.lessee, m.unitId, m.species, m.area_ha != null ? `${m.area_ha} ha` : null].filter(Boolean);
    rows.push(el('div', { class: 'text-xs text-blue-700' }, '✓ 系統識別：' + parts.join(' / ')));
  }
  if (hasPermitDoc) {
    // v2.11.69：拿掉「核准量 X kg」，只顯示效期；累計回報量改用單一資訊不對照
    rows.push(el('div', { class: 'text-xs text-emerald-700 mt-1' },
      `效期 ${p.validFrom || '—'} ~ ${p.validUntil || '—'}`));
    if (p.totalLogged_kg != null && p.totalLogged_kg > 0) {
      rows.push(el('div', { class: 'text-xs text-stone-600 mt-0.5' },
        `已回報葉片採收累計：${fmtNum(p.totalLogged_kg)} kg`));
    }
  }
  if ((p.status === 'rejected' || p.status === 'revision') && p.reviewComment) {
    rows.push(el('div', { class: 'text-xs text-red-700 mt-1' }, `審核意見：${p.reviewComment}`));
  }

  const actions = el('div', { class: 'flex gap-2 mt-2 flex-wrap' });
  if (reviewMode) {
    actions.appendChild(el('button', {
      class: 'text-xs bg-emerald-600 text-white px-2 py-1 rounded',
      onClick: () => openDecisionModal(project, p, 'approve')
    }, '✅ 核准'));
    actions.appendChild(el('button', {
      class: 'text-xs bg-orange-500 text-white px-2 py-1 rounded',
      onClick: () => openDecisionModal(project, p, 'revision')
    }, '↩️ 要求補件'));
    actions.appendChild(el('button', {
      class: 'text-xs bg-red-600 text-white px-2 py-1 rounded',
      onClick: () => openDecisionModal(project, p, 'reject')
    }, '✕ 駁回'));
  } else {
    if (canEdit) {
      actions.appendChild(el('button', {
        class: 'text-xs border border-blue-300 text-blue-700 hover:bg-blue-50 px-2 py-1 rounded',
        onClick: () => openHarvestPermitForm(state.project, p)   // v2.11.57：用 state.project 避免 stale closure
      }, '✏️ 編輯'));
      actions.appendChild(el('button', {
        class: 'text-xs bg-forest-700 text-white px-2 py-1 rounded',
        onClick: () => submitPermit(state.project, p)            // v2.11.57：用 state.project 避免 stale closure
      }, '📤 送出申請'));
    }
    if (needsReport) {
      // v2.11.39：填報實際葉片採收量與結案統一在「🌾 葉片採收回報及結案」分頁；申請卡僅指路
      actions.appendChild(el('div', {
        class: 'w-full text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded'
      }, '✅ 已核准 → 請至「🌾 葉片採收回報及結案」分頁填報實際葉片採收量，回報完畢後結案'));
    }
    // v2.11.62：刪除按鈕分兩款
    //   (A) 林農 owner 刪自己「草稿」：小型下劃線連結（已有，保持低調避免誤刪）
    //   (B) PI/admin 任何狀態：紅框醒目按鈕（清練習案 / 修誤鍵案件用；含 cascade logs）
    if (p.status === 'draft' && mineOrManager && !isPi() && !isSystemAdmin()) {
      actions.appendChild(el('button', {
        class: 'text-xs text-red-600 hover:text-red-800 underline',
        onClick: () => deletePermit(state.project, p)
      }, '✕ 刪除草稿'));
    }
    if (isPi() || isSystemAdmin()) {
      actions.appendChild(el('button', {
        class: 'text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-300 px-2 py-1 rounded',
        onClick: () => deletePermit(state.project, p)
      }, '🗑️ 刪除申請案'));
    }
    // 申請公文「函」稿 — 草稿/送出後皆可下載，供紙本正式發文（電子＋文書雙軌同步）
    if (mineOrManager) {
      actions.appendChild(el('button', {
        class: 'text-xs border border-stone-400 text-stone-700 hover:bg-stone-50 px-2 py-1 rounded',
        onClick: () => printApplicationLetter(p, state.project)
      }, '📄 申請公文稿'));
    }
  }
  // 林產物採取許可單／葉片採收總結 — 核准後雙方（林農 + 分署）皆可檢視與列印
  if (hasPermitDoc) {
    actions.appendChild(el('button', {
      class: 'text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded',
      onClick: () => openPermitDetail(project, p)
    }, '📄 採取許可單'));
  }
  rows.push(actions);
  return el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' }, ...rows);
}

// ===== v2.11.55：作業單元 picker（專區 → 承租人 → 作業單元 三層 dropdown，自動帶入地籍）=====
//   入：project（讀 boundaryGeoJsonStr，需為 v2.11.55+ FeatureCollection 格式才能用）
//       existingMeta（編輯時帶入既有選擇），onPick(meta) 選完通知 caller
//   出：DOM 節點。若 boundary 缺或舊格式 → 回傳 hint 區塊（請手填）
//
//   schema 兼容（橫流溪 vs 烏石坑）：
//     - 承租人：props.承租人 (橫流溪) / props.name (烏石坑)
//     - 作業單元ID：props.作業區「14_1_1」/ props.標示「117-260-01」
//     - 樹種：props.樹種 / props.契約樹種
//     - 面積：props.面積 / props.契約面積 / props.area1
//     - 林班：props.林班 (烏石坑) / null (橫流溪)
//     - 假地號：props.假地號（皆有）
//     - 工作站：props.工作站 (橫流溪) / props.事業區 (烏石坑)
//     - 契約書號：props.契約書 (橫流溪)
function normalizeWorkUnit(props) {
  if (!props) return null;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const zone = props.專區 ?? null;
  const lessee = props.承租人 ?? props.name ?? null;
  const unitId = props.作業區 ?? props.標示 ?? null;
  const species = props.樹種 ?? props.契約樹種 ?? null;
  const area = num(props.面積 ?? props.契約面積 ?? props.area1);
  const station = props.工作站 ?? props.事業區 ?? null;
  const contract = props.契約書 ?? null;
  const lin = props.林班 ?? null;
  const dihao = props.假地號 ?? null;
  // 組合「林班 X，假地號 Y」字串塞回手填欄位（保留 unit ID 為 fallback）
  const parts = [];
  if (lin) parts.push(`林班 ${lin}`);
  if (dihao != null && dihao !== '') parts.push(`假地號 ${dihao}`);
  const landParcelText = parts.length ? parts.join('，') : (unitId || '');
  return { zone, lessee, unitId, species, area_ha: area, station, contract, landParcelText };
}

// ===== v2.11.66：申請表單內嵌迷你地圖 — picker 選作業單元 → 自動定位預覽 =====
//   入：project（讀 boundaryGeoJsonStr，需為 FC 格式）
//   出：{ wrap, setSelectedUnit(wu), invalidateSize() }；caller 負責 invalidateSize 在 modal 顯示後呼叫一次。
//   行為：
//     - 初始畫所有 polygon 灰色淡填，fit 到全 boundary
//     - picker partial（zone+lessee 已選）→ 高亮該承租人所有 polygon、fit bounds
//     - picker full（含 unitId）→ 高亮該作業單元、fit bounds
//     - 切換時舊高亮 layer remove、新增上去
//   cleanup：modal 內 leaflet map 於下次 openModal innerHTML='' 時 detach；無顯式 remove 不致 leak（小規模）。
function buildApplicationMiniMap(project) {
  const wrap = el('div', { class: 'border border-blue-200 rounded p-2 bg-blue-50 space-y-1.5' });
  wrap.appendChild(el('div', { class: 'text-sm font-medium text-blue-900' }, '📍 作業位置預覽（地圖）'));
  const mapDiv = el('div', { style: 'height:240px;border-radius:4px;overflow:hidden;background:#e5e7eb' });
  wrap.appendChild(mapDiv);
  const status = el('div', { class: 'text-xs text-stone-600' }, '請於上方下拉選擇承租人/作業單元，地圖會自動 zoom。');
  wrap.appendChild(status);

  let features = [];
  try {
    const geo = JSON.parse(project?.boundaryGeoJsonStr || 'null');
    if (geo?.type === 'FeatureCollection') features = geo.features || [];
  } catch {}

  if (features.length === 0) {
    mapDiv.style.display = 'none';
    status.textContent = '（專案邊界尚未上傳或為舊格式，無地圖可顯示）';
    return { wrap, setSelectedUnit: () => {}, invalidateSize: () => {} };
  }

  let map = null, baseLayer = null, highlightLayer = null, fullBounds = null;
  function init() {
    if (map) return;
    map = L.map(mapDiv, { zoomControl: true, attributionControl: false }).setView([24.27, 121.0], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    baseLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
      style: { color: '#6b7280', weight: 1, opacity: 0.6, fillColor: '#9ca3af', fillOpacity: 0.08 }
    }).addTo(map);
    fullBounds = baseLayer.getBounds();
    if (fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [8, 8] });
  }

  function setSelectedUnit(wu) {
    init();
    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
    if (!wu) {
      status.textContent = '請於上方下拉選擇承租人/作業單元，地圖會自動 zoom。';
      if (fullBounds?.isValid()) map.fitBounds(fullBounds, { padding: [8, 8] });
      return;
    }
    // 匹配優先序：unitId（完整選擇）→ lessee（部分選擇）
    let matches = [];
    if (wu.unitId) {
      matches = features.filter(f => {
        const code = f.properties?.['作業區'] || f.properties?.['標示'];
        return code === wu.unitId;
      });
    } else if (wu.lessee) {
      matches = features.filter(f => {
        const lessee = f.properties?.['承租人'] || f.properties?.['name'];
        return lessee === wu.lessee;
      });
    }
    if (matches.length === 0) {
      status.textContent = '⚠ 找不到對應位置（屬性與選擇不符）';
      return;
    }
    highlightLayer = L.geoJSON({ type: 'FeatureCollection', features: matches }, {
      style: { color: '#dc2626', weight: 3, opacity: 1, fillColor: '#ef4444', fillOpacity: 0.4 }
    }).addTo(map);
    const b = highlightLayer.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [25, 25], maxZoom: 18 });
    if (wu.unitId) {
      status.textContent = `✓ 已定位：${wu.zone || ''} / ${wu.lessee || ''} / ${wu.unitId}（${matches.length} 個圖塊）`;
    } else if (wu.lessee) {
      status.textContent = `✓ 顯示承租人「${wu.lessee}」的 ${matches.length} 個作業單元（待選作業單元定位至單一圖塊）`;
    }
  }

  function invalidateSize() {
    init();
    if (map) map.invalidateSize();
  }

  return { wrap, setSelectedUnit, invalidateSize };
}

function getProjectWorkUnits(project) {
  // 回傳 [{ wu: normalized, raw: properties }, ...]；缺/舊格式回 []
  if (!project?.boundaryGeoJsonStr) return [];
  let geo;
  try { geo = JSON.parse(project.boundaryGeoJsonStr); }
  catch { return []; }
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) return [];
  const out = [];
  for (const f of geo.features) {
    const wu = normalizeWorkUnit(f.properties);
    if (!wu) continue;
    if (!wu.zone && !wu.lessee && !wu.unitId) continue;   // 完全沒可辨識欄位 → 跳過
    out.push({ wu, raw: f.properties });
  }
  return out;
}

function buildWorkUnitPicker(project, existingMeta, onPick) {
  const units = getProjectWorkUnits(project);
  const wrap = el('div', { class: 'bg-blue-50 border border-blue-200 rounded p-2.5 space-y-2' });
  wrap.appendChild(el('div', { class: 'text-sm font-medium text-blue-900' }, '📍 作業位置（從專案邊界帶入）'));

  if (units.length === 0) {
    // v2.11.55+：精細化提示 — 區分三種空陣列原因，讓 admin 知道要做什麼動作升級
    let reason = '尚未上傳專案邊界';
    let action = '請 admin 進入「✏️ 編輯專案 → 📐 專案邊界」上傳邊界 GeoJSON。';
    if (project?.boundaryGeoJsonStr) {
      try {
        const geo = JSON.parse(project.boundaryGeoJsonStr);
        if (geo?.type === 'Polygon' || geo?.type === 'MultiPolygon') {
          reason = '邊界格式為舊版（v2.11.54 以前上傳，未保留作業單元屬性）';
          action = '請 admin 進入「✏️ 編輯專案 → 📐 專案邊界」→ 在「📥 預設邊界」下拉選「土肉桂專區（橫流溪 + 烏石坑）」→ 按「載入」→ 儲存。即會升級為含屬性的 FeatureCollection，dropdown 立刻可用。';
        } else if (geo?.type === 'FeatureCollection') {
          const n = Array.isArray(geo.features) ? geo.features.length : 0;
          reason = `邊界含 ${n} 個 features，但屬性無「專區/承租人/作業單元」可辨識欄位`;
          action = '請確認邊界檔已含 normalized properties（橫流溪/烏石坑合併檔 cinnamon-zones-merged.geojson 即符合）。';
        }
      } catch {
        reason = '邊界資料 JSON 解析失敗';
        action = '請 admin 進入「✏️ 編輯專案」重新上傳邊界。';
      }
    }
    const hint = el('div', { class: 'text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 space-y-1' },
      el('div', { class: 'font-medium' }, `⚠ ${reason}`),
      el('div', {}, action),
      el('div', { class: 'text-stone-600' }, '目前可手填下方林班/地號欄位繼續送出，但無法享有自動帶入。')
    );
    wrap.appendChild(hint);
    return wrap;
  }

  // 索引：zone → set(lessee)；zone+lessee → [unit]
  const zones = [...new Set(units.map(u => u.wu.zone).filter(Boolean))].sort();
  function lesseesOf(zone) {
    return [...new Set(units.filter(u => u.wu.zone === zone).map(u => u.wu.lessee).filter(Boolean))].sort();
  }
  function unitsOf(zone, lessee) {
    return units.filter(u => u.wu.zone === zone && u.wu.lessee === lessee);
  }

  const zoneSel = el('select', { class: 'w-full border rounded px-2 py-1 text-sm bg-white' },
    el('option', { value: '' }, '— 選專區 —'),
    ...zones.map(z => el('option', { value: z }, z)));
  const lesseeSel = el('select', { class: 'w-full border rounded px-2 py-1 text-sm bg-white', disabled: 'true' },
    el('option', { value: '' }, '— 先選專區 —'));
  const unitSel = el('select', { class: 'w-full border rounded px-2 py-1 text-sm bg-white', disabled: 'true' },
    el('option', { value: '' }, '— 先選承租人 —'));

  const summary = el('div', { class: 'text-xs text-stone-700 mt-1 leading-relaxed' });

  function refreshLessees() {
    const z = zoneSel.value;
    lesseeSel.innerHTML = '';
    if (!z) {
      lesseeSel.appendChild(el('option', { value: '' }, '— 先選專區 —'));
      lesseeSel.disabled = true;
      unitSel.innerHTML = '';
      unitSel.appendChild(el('option', { value: '' }, '— 先選承租人 —'));
      unitSel.disabled = true;
      summary.innerHTML = '';
      onPick(null);
      return;
    }
    const ls = lesseesOf(z);
    lesseeSel.appendChild(el('option', { value: '' }, `— 選承租人（${ls.length} 位）—`));
    ls.forEach(l => lesseeSel.appendChild(el('option', { value: l }, l)));
    lesseeSel.disabled = false;
    unitSel.innerHTML = '';
    unitSel.appendChild(el('option', { value: '' }, '— 先選承租人 —'));
    unitSel.disabled = true;
    summary.innerHTML = '';
    onPick(null);
  }
  function refreshUnits() {
    const z = zoneSel.value, l = lesseeSel.value;
    unitSel.innerHTML = '';
    if (!z || !l) {
      unitSel.appendChild(el('option', { value: '' }, '— 先選承租人 —'));
      unitSel.disabled = true;
      summary.innerHTML = '';
      onPick(null);
      return;
    }
    const us = unitsOf(z, l);
    unitSel.appendChild(el('option', { value: '' }, `— 選作業單元（${us.length} 個）—`));
    us.forEach((u, i) => {
      const wu = u.wu;
      const label = [
        wu.unitId || `#${i + 1}`,
        wu.area_ha != null ? `${wu.area_ha} ha` : null,
        wu.species,
      ].filter(Boolean).join(' / ');
      unitSel.appendChild(el('option', { value: String(i) }, label));
    });
    unitSel.disabled = false;
    summary.innerHTML = '';
    // v2.11.63：zone+lessee 已選定但 unit 未選 → fire partial wu，讓 caller 可自動帶入申請人姓名等
    //   partial: true 旗標讓 caller 區分「部分選擇（未進 Firestore meta）」vs「完整三層選擇（commit meta）」
    onPick({ zone: z, lessee: l, unitId: null, partial: true });
  }
  function refreshSummary() {
    const z = zoneSel.value, l = lesseeSel.value;
    const idx = unitSel.value;
    if (!z || !l || idx === '') { summary.innerHTML = ''; onPick(null); return; }
    const us = unitsOf(z, l);
    const u = us[Number(idx)];
    if (!u) { summary.innerHTML = ''; onPick(null); return; }
    const wu = u.wu;
    const rows = [
      ['專區', wu.zone],
      ['承租人', wu.lessee],
      ['作業單元', wu.unitId],
      ['契約樹種', wu.species],
      ['契約面積', wu.area_ha != null ? `${wu.area_ha} ha` : null],
      ['工作站／事業區', wu.station],
      ['契約書', wu.contract],
    ].filter(r => r[1] != null && r[1] !== '');
    summary.innerHTML = '';
    summary.appendChild(el('div', { class: 'font-medium text-emerald-700 mb-0.5' }, '✓ 已帶入下方林班/地號欄位（如需細調可手動編輯）：'));
    const table = el('table', { class: 'w-full text-xs' });
    rows.forEach(([k, v]) => {
      table.appendChild(el('tr', {},
        el('td', { class: 'text-stone-500 pr-2 align-top whitespace-nowrap py-0.5' }, k + '：'),
        el('td', { class: 'py-0.5 break-all' }, String(v))
      ));
    });
    summary.appendChild(table);
    onPick(wu);
  }

  zoneSel.addEventListener('change', refreshLessees);
  lesseeSel.addEventListener('change', refreshUnits);
  unitSel.addEventListener('change', refreshSummary);

  wrap.appendChild(el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-2' },
    el('div', {}, el('label', { class: 'block text-xs text-stone-600 mb-0.5' }, '1. 專區'), zoneSel),
    el('div', {}, el('label', { class: 'block text-xs text-stone-600 mb-0.5' }, '2. 承租人'), lesseeSel),
    el('div', {}, el('label', { class: 'block text-xs text-stone-600 mb-0.5' }, '3. 作業單元'), unitSel),
  ));
  wrap.appendChild(summary);

  // 編輯既有申請時，若 landParcelMeta 有值 → 預選
  if (existingMeta?.zone && zones.includes(existingMeta.zone)) {
    zoneSel.value = existingMeta.zone;
    refreshLessees();
    if (existingMeta.lessee && lesseesOf(existingMeta.zone).includes(existingMeta.lessee)) {
      lesseeSel.value = existingMeta.lessee;
      refreshUnits();
      if (existingMeta.unitId) {
        const us = unitsOf(existingMeta.zone, existingMeta.lessee);
        const matchIdx = us.findIndex(u => u.wu.unitId === existingMeta.unitId);
        if (matchIdx >= 0) {
          unitSel.value = String(matchIdx);
          refreshSummary();
        }
      }
    }
  }

  return wrap;
}

// ===== 共用：表單欄位工廠 =====
function fld(label, name, opts = {}) {
  const id = `hp-${name}`;
  const lab = el('label', { for: id, class: 'block text-sm font-medium mb-0.5' },
    label, opts.required ? el('span', { class: 'text-red-600' }, ' *') : null);
  let input;
  if (opts.options) {
    input = el('select', { id, name, class: 'w-full border rounded px-2 py-1 text-sm' },
      ...opts.options.map(o => {
        const op = el('option', { value: o }, o);
        if (String(o) === String(opts.value ?? '')) op.setAttribute('selected', 'true');
        return op;
      }));
  } else if (opts.type === 'textarea') {
    input = el('textarea', { id, name, rows: opts.rows || 2, class: 'w-full border rounded px-2 py-1 text-sm' }, opts.value ?? '');
  } else {
    const a = { id, name, type: opts.type || 'text', class: 'w-full border rounded px-2 py-1 text-sm', value: opts.value ?? '' };
    if (opts.required) a.required = 'true';
    if (opts.step) a.step = opts.step;
    if (opts.min != null) a.min = opts.min;
    input = el('input', a);
  }
  return el('div', {}, lab, input);
}

// ===== 林農端：修枝申請 =====
export async function renderHarvestApply(project) {
  bindFb();
  const list = $('#harvestapply-list');
  if (!list) return;

  // v2.11.57：修 stale closure — 改用 state.project 動態取現值，避免「初次 render → 編輯專案升級邊界
  //   → 點＋按鈕仍開到舊 project」的 picker 失效 bug。_bound flag 保留，但 closure 內讀 state.project。
  const newBtn = $('#btn-new-permit');
  if (newBtn && !newBtn._bound) {
    newBtn._bound = true;
    newBtn.addEventListener('click', () => openHarvestPermitForm(state.project));
  }

  // v2.11.57：監聽 project-updated → 自動 re-render，讓編輯專案後 picker 立刻拿最新 project
  if (!state.__harvestApplyListenerAttached) {
    state.__harvestApplyListenerAttached = true;
    window.addEventListener('forestmrv:project-updated', () => {
      const visible = document.querySelector('[data-tab-content="harvestapply"]')?.classList.contains('hidden') === false;
      if (visible && state.project) renderHarvestApply(state.project);
    });
  }

  list.innerHTML = '<div class="text-sm text-stone-500 p-4">載入中…</div>';
  let permits;
  try {
    permits = await loadPermits(project.id);
  } catch (e) {
    list.innerHTML = `<div class="text-sm text-red-600 p-4">載入失敗：${e.message}</div>`;
    return;
  }

  const uid = state.user.uid;
  const seeAll = isPi() || isSystemAdmin();
  const mine = seeAll ? permits : permits.filter(p => p.createdBy === uid);

  if (mine.length === 0) {
    list.innerHTML = '<div class="text-sm text-stone-500 p-4">尚無修枝申請。點上方「＋ 新修枝申請」開始。</div>';
    return;
  }
  list.innerHTML = '';
  mine.forEach(p => list.appendChild(permitCard(state.project, p, false)));  // v2.11.57：永遠用 state.project
}

// ===== 林農端：葉片採收回報及結案（v2.11.39）=====
// 核准後「實際葉片採收量的填報」與「結案」統一在此分頁，使資訊架構對應真實流程：
//   申請 → 審核 → 【葉片採收回報及結案】 → 彙整。只列該林農 approved/harvesting/completed 的案。
//   - approved 尚未回報 → 紅幅明示「務必回報」（G2）
//   - 可分批多次「＋ 填報葉片採收量」；即時顯示已回報累計（v2.11.69 起不再對照核准量/算達成率）
//   - 「✅ 回報完畢並結案」＝明確閘門（G1：closePermit 客戶端 + firestore.rules 雙擋零回報結案）
function reportLogsTable(logs) {
  return el('table', { class: 'w-full text-xs border-collapse mt-1' },
    el('thead', {}, el('tr', { class: 'bg-stone-100' },
      ...['採收日', '鮮重(kg)', '乾重(kg)', '含水率%', '批次'].map(h =>
        el('th', { class: 'border px-1 py-0.5 text-left' }, h)))),
    el('tbody', {}, ...(logs.length
      ? logs.map(l => el('tr', {},
          el('td', { class: 'border px-1 py-0.5' }, l.logDate || '—'),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.amount_kg_fresh)),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.amount_kg_dry)),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.moisture_pct)),
          el('td', { class: 'border px-1 py-0.5' }, l.batch || '—')))
      : [el('tr', {}, el('td', { class: 'border px-1 py-2 text-center text-stone-400', colspan: '5' }, '尚無回報紀錄'))]))
  );
}

function reportCard(project, p) {
  const isDone = p.status === 'completed';
  const logged = p.totalLogged_kg;
  const noReport = (logged == null || logged <= 0);

  const rows = [
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('span', { class: 'font-semibold' }, p.applicantName || '（未填申請人）'),
      hpBadge(p.status),
      p.permitNo ? el('span', { class: 'text-xs text-stone-500' }, `許可文號 ${p.permitNo}`) : null
    ),
    // v2.11.69：拿掉「核准葉片採收量」（許可不再預估上限）
    el('div', { class: 'text-sm text-stone-600' },
      `林地：${p.landParcel || '—'}`),
    el('div', { class: 'text-xs text-stone-500' },
      `效期：${p.validFrom || '—'} ~ ${p.validUntil || '—'}`)
  ];

  // v2.11.69：累計回報量單獨顯示，不再做核准量對照/達成率/超量
  rows.push(el('div', { class: 'text-sm mt-1 text-stone-700' },
    `已回報葉片採收累計：${fmtNum(logged || 0)} kg`));

  // G2：approved 尚未回報 → 紅幅明示「一定要回報」
  if (p.status === 'approved' && noReport) {
    rows.push(el('div', { class: 'text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded mt-1' },
      '⚠ 已核准・尚未回報任何葉片採收量 — 實際修枝後務必在此「＋ 填報葉片採收量」，回報完畢後方可結案。'));
  }
  if (isDone) {
    rows.push(el('div', { class: 'text-xs text-stone-500 bg-stone-100 px-2 py-1 rounded mt-1' },
      '✅ 已結案 — 葉片採收量已回報完畢、資料固定，供分署查核與合作社彙整。'));
  }

  const logsBox = el('div', { class: 'text-xs text-stone-400 mt-2' }, '已回報明細載入中…');
  rows.push(logsBox);
  loadLogs(project.id, p.id).then(logs => {
    logsBox.className = 'mt-2';
    logsBox.innerHTML = '';
    logsBox.appendChild(el('div', { class: 'text-xs font-medium text-stone-600' }, `已回報明細（共 ${logs.length} 筆）`));
    logsBox.appendChild(reportLogsTable(logs));
  }).catch(() => { logsBox.textContent = '已回報明細載入失敗'; });

  const actions = el('div', { class: 'flex gap-2 mt-3 flex-wrap' });
  if (p.status === 'approved' || p.status === 'harvesting') {
    actions.appendChild(el('button', {
      class: 'text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium',
      onClick: () => openHarvestLogForm(project, p)
    }, '＋ 填報葉片採收量'));
  }
  if (p.status === 'harvesting') {
    actions.appendChild(el('button', {
      class: 'text-sm bg-stone-700 hover:bg-stone-800 text-white px-3 py-1.5 rounded font-medium',
      onClick: () => closePermit(project, p)
    }, '✅ 回報完畢並結案'));
  }
  actions.appendChild(el('button', {
    class: 'text-sm border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded',
    onClick: () => openPermitDetail(project, p)
  }, '📄 採取許可單'));
  rows.push(actions);

  return el('div', {
    class: 'bg-white rounded-lg shadow p-4 mb-3' + (p.status === 'approved' && noReport ? ' ring-1 ring-red-200' : '')
  }, ...rows);
}

export async function renderHarvestReport(project) {
  bindFb();
  const list = $('#harvestreport-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm text-stone-500 p-4">載入中…</div>';
  let permits;
  try {
    permits = await loadPermits(project.id);
  } catch (e) {
    list.innerHTML = `<div class="text-sm text-red-600 p-4">載入失敗：${e.message}</div>`;
    return;
  }
  const uid = state.user.uid;
  const seeAll = isPi() || isSystemAdmin();
  const mineAll = seeAll ? permits : permits.filter(p => p.createdBy === uid);
  const mine = mineAll.filter(p => ['approved', 'harvesting', 'completed'].includes(p.status));
  if (mine.length === 0) {
    list.innerHTML = '<div class="text-sm text-stone-500 p-4">尚無已核准案件。經林業保育署臺中分署核准後，會在此填報實際葉片採收量並結案。</div>';
    return;
  }
  // approved（尚未回報）排最前、其次 harvesting；completed 收到「已結案」區
  const active = mine.filter(p => p.status === 'approved' || p.status === 'harvesting')
    .sort((a, b) => (a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1));
  const done = mine.filter(p => p.status === 'completed');

  list.innerHTML = '';
  list.appendChild(el('div', { class: 'text-xs text-stone-500 mb-2' },
    '流程：分署核准後 → 在此「＋ 填報葉片採收量」（可分批多次）→ 全數回報完畢後「✅ 回報完畢並結案」。結案後資料固定，合作社才能彙整。'));
  list.appendChild(el('h3', { class: 'font-semibold text-sm text-stone-700 mb-2' }, `待回報 / 修枝作業中（${active.length}）`));
  if (active.length === 0) {
    list.appendChild(el('div', { class: 'text-sm text-stone-500 mb-3' }, '目前沒有待回報案件。'));
  } else {
    active.forEach(p => list.appendChild(reportCard(project, p)));
  }
  if (done.length) {
    list.appendChild(el('h3', { class: 'font-semibold text-sm text-stone-500 mt-4 mb-2' }, `已結案（${done.length}）`));
    done.forEach(p => list.appendChild(reportCard(project, p)));
  }
}

export function openHarvestPermitForm(project, existing = null) {
  bindFb();
  const p = existing || {};
  // v2.11.55：picker 與 landParcel input 雙向聯動 — picker 選完 → 自動填 landParcel + 面積；user 仍可手動 override
  let pickedMeta = p.landParcelMeta || null;   // 提交時順帶寫進 Firestore，供 dropdown 回顯與報表用
  const landParcelInput = el('input', {
    id: 'hp-landParcel', name: 'landParcel', type: 'text',
    class: 'w-full border rounded px-2 py-1 text-sm', value: p.landParcel || '', required: 'true'
  });
  // v2.11.58：step='0.01' 擋掉契約面積 0.2544 等 4 位小數 → 改 step='0.0001'（= 1 m² 精度，符合
  //   台灣林業契約標準；公頃 × 10^-4 = m²）。先前 step=0.01 是抓股票 / 一般金額的習慣值，不適合林業。
  const areaInput = el('input', {
    id: 'hp-forestArea_ha', name: 'forestArea_ha', type: 'number', step: '0.0001', min: 0,
    class: 'w-full border rounded px-2 py-1 text-sm', value: p.forestArea_ha ?? ''
  });
  // v2.11.59：土肉桂修枝株數改為自動計算（申請面積 × 1800 株/ha），user 可手動覆蓋。
  //   密度 1800 株/ha 為合作社契約假設（user 5/30 拍板）；面積變更時即時連動，覆蓋既有值。
  //   若 user 已手動輸入想保留，編輯後再覆蓋即可（最後送出時值為主）。
  const CINNAMON_DENSITY_PER_HA = 1800;
  const treesInput = el('input', {
    id: 'hp-estTrees', name: 'estTrees', type: 'number', min: 0,
    class: 'w-full border rounded px-2 py-1 text-sm', value: p.estTrees ?? ''
  });
  function recalcTreesFromArea() {
    const a = parseFloat(areaInput.value);
    if (Number.isFinite(a) && a >= 0) {
      treesInput.value = Math.round(a * CINNAMON_DENSITY_PER_HA);
    }
  }
  areaInput.addEventListener('input', recalcTreesFromArea);
  // v2.11.63：申請人姓名 / 聯絡方式抽出為獨立 input — picker 選承租人時可自動填申請人姓名；聯絡方式改必填
  const applicantNameInput = el('input', {
    id: 'hp-applicantName', name: 'applicantName', type: 'text', required: 'true',
    class: 'w-full border rounded px-2 py-1 text-sm',
    value: p.applicantName || (state.userDoc?.displayName ?? '')
  });
  const contactInput = el('input', {
    id: 'hp-contact', name: 'contact', type: 'text', required: 'true',
    class: 'w-full border rounded px-2 py-1 text-sm',
    value: p.contact || '',
    placeholder: '電話或 email'
  });
  // v2.11.66：申請表單內嵌迷你地圖（picker 選作業單元 → 自動 zoom 預覽）
  const miniMap = buildApplicationMiniMap(project);
  const picker = buildWorkUnitPicker(project, p.landParcelMeta, (wu) => {
    if (!wu) {
      pickedMeta = null;
      miniMap.setSelectedUnit(null);
      return;
    }
    // v2.11.63：承租人已知（partial 或 full） → 自動覆蓋申請人姓名（user 5/30 拍板，承租人 = 申請人為原則）
    //   覆蓋既有值（即使是 displayName 預設或手動輸入）— user 期待承租人選擇為單一可信來源；
    //   若 user 想保留手填，最後手動再改即可。
    if (wu.lessee) applicantNameInput.value = wu.lessee;
    // 完整選擇（含作業單元）→ commit metadata + 帶入 landParcel + 面積（重複 onChange 不會錯）
    if (!wu.partial && wu.unitId) {
      pickedMeta = wu;
      if (wu.landParcelText) landParcelInput.value = wu.landParcelText;
      if (wu.area_ha != null && !areaInput.value) {
        areaInput.value = String(wu.area_ha);
        recalcTreesFromArea();   // v2.11.59：picker 帶入面積 → 順帶填株數
      }
    }
    // v2.11.66：每次 picker 變動同步更新地圖（partial 顯承租人所有圖塊；full 定位至單一作業單元）
    miniMap.setSelectedUnit(wu);
  });
  // v2.11.68：欄位順序調整 — 作業位置 picker / mini-map 移到最上面，
  //   讓使用者「先選作業位置 → 申請人姓名自動由承租人帶入 → 補聯絡方式」的順序更自然。
  //   原順序（申請人姓名 → 聯絡方式 → picker → mini-map → 林班/地號 …）違背了
  //   v2.11.63 picker 自動覆蓋申請人姓名的設計（user 還沒選承租人就先看到姓名欄、邏輯顛倒）。
  //   新順序：picker → mini-map → 申請人姓名 → 聯絡方式 → 林班/地號 → 面積 → 株數 → 方式 → 期間 → 備註 → 按鈕。
  const f = el('form', { class: 'space-y-2' },
    picker,
    miniMap.wrap,   // v2.11.66：地圖即時預覽 picker 選擇
    el('div', {},
      el('label', { for: 'hp-applicantName', class: 'block text-sm font-medium mb-0.5' },
        '申請人姓名', el('span', { class: 'text-red-600' }, ' *')),
      applicantNameInput,
      el('div', { class: 'text-xs text-stone-500 mt-0.5' }, '上方選承租人後會自動帶入；可手動編輯。')
    ),
    el('div', {},
      el('label', { for: 'hp-contact', class: 'block text-sm font-medium mb-0.5' },
        '聯絡方式（電話／email）', el('span', { class: 'text-red-600' }, ' *')),
      contactInput
    ),
    el('div', {},
      el('label', { for: 'hp-landParcel', class: 'block text-sm font-medium mb-0.5' },
        '林班 / 地號', el('span', { class: 'text-red-600' }, ' *')),
      landParcelInput,
      el('div', { class: 'text-xs text-stone-500 mt-0.5' }, '上方選完作業單元會自動帶入；可手動編輯。')
    ),
    el('div', {},
      el('label', { for: 'hp-forestArea_ha', class: 'block text-sm font-medium mb-0.5' }, '申請修枝面積 (ha)'),
      areaInput
    ),
    el('div', {},
      el('label', { for: 'hp-estTrees', class: 'block text-sm font-medium mb-0.5' }, '土肉桂修枝株數'),
      treesInput,
      el('div', { class: 'text-xs text-stone-500 mt-0.5' },
        `預設＝申請面積 × ${CINNAMON_DENSITY_PER_HA} 株/ha（合作社契約假設密度）；修改面積會即時連動，可手動覆蓋。`)
    ),
    fld('修枝方式', 'harvestMethod', { options: HARVEST_METHODS, value: p.harvestMethod || '修枝' }),
    // v2.11.59：修枝起迄日改為必填
    el('div', { class: 'grid grid-cols-2 gap-2' },
      fld('修枝起日', 'periodFrom', { type: 'date', required: true, value: p.periodFrom || '' }),
      fld('修枝迄日', 'periodTo', { type: 'date', required: true, value: p.periodTo || '' })
    ),
    fld('備註', 'note', { type: 'textarea', value: p.note || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', value: 'draft', class: 'flex-1 bg-stone-200 hover:bg-stone-300 text-stone-800 px-3 py-2 rounded text-sm font-medium' }, '💾 儲存草稿'),
      el('button', { type: 'submit', value: 'submitted', class: 'flex-1 bg-forest-700 text-white px-3 py-2 rounded text-sm font-medium' }, '📤 送出申請')
    )
  );

  let intent = 'draft';
  f.querySelectorAll('button[type=submit]').forEach(b =>
    b.addEventListener('click', () => { intent = b.value; }));

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const data = {
      applicantName: (fd.get('applicantName') || '').trim(),
      contact: (fd.get('contact') || '').trim(),
      landParcel: (fd.get('landParcel') || '').trim(),
      // v2.11.55：picker 帶出的結構化 metadata（彙整/報表/許可單可用結構化欄位，不必再 parse 自由字串）
      //   若 user 沒用 picker 或手填覆蓋了 landParcel → 仍保留 picker 上次選擇的 meta（pickedMeta）給溯源
      landParcelMeta: pickedMeta || null,
      forestArea_ha: num(fd.get('forestArea_ha')),
      estTrees: num(fd.get('estTrees')),
      harvestMethod: fd.get('harvestMethod'),
      periodFrom: fd.get('periodFrom') || '',
      periodTo: fd.get('periodTo') || '',
      note: (fd.get('note') || '').trim(),
      status: intent,
      updatedAt: serverTimestamp()
    };
    if (!data.applicantName || !data.landParcel) {
      toast('請填申請人、林班/地號');
      return;
    }
    // v2.11.63：聯絡方式必填（送出公文/許可單需有可聯絡途徑）
    if (!data.contact) {
      toast('請填聯絡方式（電話或 email）');
      return;
    }
    // v2.11.59：修枝起迄日必填 + 順序檢查（草稿亦擋，避免不完整資料散落 Firestore）
    if (!data.periodFrom || !data.periodTo) {
      toast('請填修枝起日與修枝迄日');
      return;
    }
    if (data.periodFrom > data.periodTo) {
      toast('修枝迄日不可早於修枝起日');
      return;
    }
    if (intent === 'submitted') data.submittedAt = serverTimestamp();
    // v2.11.61：送出時若尚未配發發文字號 → runTransaction 原子遞增 counters/applicantSeq、產生申請字號。
    //   只在 draft/revision → submitted 的瞬間配發一次；已配發的（含被退回再送、編輯）不重新編號。
    //   counter 失敗 → 整個提交中止（避免送出無號狀態混淆）。
    if (intent === 'submitted' && !existing?.applicantSeq) {
      try {
        const counterRef = doc(db, 'projects', project.id, 'counters', 'applicantSeq');
        const newSeq = await runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef);
          const cur = snap.exists() ? (snap.data().value || 0) : 0;
          const next = cur + 1;
          tx.set(counterRef, { value: next, updatedAt: serverTimestamp() });
          return next;
        });
        data.applicantSeq = newSeq;
        data.applicantDocNo = buildApplicantDocNo(newSeq);
      } catch (err) {
        console.error('[applicantSeq tx] failed', err);
        toast('產生發文字號失敗：' + err.message);
        return;
      }
    }
    try {
      if (existing) {
        await updateDoc(doc(db, 'projects', project.id, 'harvestPermits', existing.id), data);
      } else {
        data.applicantUid = state.user.uid;
        data.createdBy = state.user.uid;
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, 'projects', project.id, 'harvestPermits'), data);
      }
      closeModal();
      toast(intent === 'submitted' ? '✅ 已送出申請，待林保署審核' : '已儲存草稿');
      renderHarvestApply(project);
    } catch (err) {
      console.error('harvestPermit save 失敗', err);
      toast('儲存失敗：' + err.message);
    }
  });
  openModal(existing ? '編輯修枝申請' : '修枝申請（土肉桂）', f);
  // v2.11.66：modal 顯示後 Leaflet 才能正確量 container 大小 — 微任務後 invalidateSize
  //   若 form 是編輯既有申請、landParcelMeta 已預選 → 預設高亮已選作業單元
  queueMicrotask(() => {
    miniMap.invalidateSize();
    if (p.landParcelMeta?.zone || p.landParcelMeta?.lessee) {
      miniMap.setSelectedUnit(p.landParcelMeta);
    }
  });
}

async function submitPermit(project, p) {
  if (!confirm(
    `確定送出此申請給林業保育署臺中分署審核？\n\n` +
    `申請人：${p.applicantName}\n林地：${p.landParcel}\n\n` +
    `送出後將無法編輯，需待審核結果。`
  )) return;
  try {
    await updateDoc(doc(db, 'projects', project.id, 'harvestPermits', p.id), {
      status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    toast('✅ 已送出，待審核');
    renderHarvestApply(project);
  } catch (e) {
    toast('送出失敗：' + e.message);
  }
}

// v2.11.62：刪除申請案 — 含 cascade（先刪 logs 子集合再刪 doc）+ 警告對話框列出案件摘要
//   開放對象：草稿 owner（保留舊行為）/ PI / admin（任何狀態）。
//   warning 文字依案件狀態組裝，已核准/已採收的案件特別標示「將同時失效」與「累計回報量」。
async function deletePermit(project, p) {
  const statusLabel = HP_STATUS[p.status]?.label || p.status;
  const hasLogs = (p.totalLogged_kg || 0) > 0;
  const lines = [
    '確定刪除此修枝申請？',
    '',
    `申請人：${p.applicantName || '—'}`,
    `林地：${p.landParcel || '—'}`,
    `狀態：${statusLabel}`,
  ];
  if (p.applicantDocNo) lines.push(`發文字號：${p.applicantDocNo}`);
  if (p.permitNo) lines.push(`⚠ 法定許可文號：${p.permitNo}（將同時失效）`);
  if (hasLogs) lines.push(`⚠ 已有採收回報累計 ${p.totalLogged_kg} kg，將連同子集合一併刪除`);
  lines.push('', '刪除後無法恢復。');
  if (!confirm(lines.join('\n'))) return;
  try {
    // 1. 子集合 logs 先刪（草稿/已送出/已駁回案多半為空集合）
    const logsRef = collection(db, 'projects', project.id, 'harvestPermits', p.id, 'logs');
    const logsSnap = await getDocs(logsRef);
    if (logsSnap.size > 0) {
      await Promise.all(logsSnap.docs.map(d => deleteDoc(d.ref)));
    }
    // 2. 刪 permit doc
    await deleteDoc(doc(db, 'projects', project.id, 'harvestPermits', p.id));
    toast(`已刪除（${p.applicantName || '—'} / ${statusLabel}）`);
    renderHarvestApply(state.project);
  } catch (e) {
    console.error('deletePermit failed', e);
    toast('刪除失敗：' + e.message);
  }
}

// ===== 分署端：修枝審核 =====
export async function renderHarvestReview(project) {
  bindFb();
  const list = $('#harvestreview-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm text-stone-500 p-4">載入中…</div>';
  let permits;
  try {
    permits = await loadPermits(project.id);
  } catch (e) {
    list.innerHTML = `<div class="text-sm text-red-600 p-4">載入失敗：${e.message}</div>`;
    return;
  }

  const pending = permits.filter(p => p.status === 'submitted' || p.status === 'under_review');
  const decided = permits.filter(p => p.status === 'approved' || p.status === 'rejected' || p.status === 'revision');

  const cnt = $('#harvestreview-count');
  if (cnt) cnt.textContent = pending.length ? String(pending.length) : '';

  list.innerHTML = '';
  list.appendChild(el('h3', { class: 'font-semibold mb-2' }, `待審核（${pending.length}）`));
  if (pending.length === 0) {
    list.appendChild(el('div', { class: 'text-sm text-stone-500 mb-4' }, '目前無待審核申請。'));
  } else {
    pending.forEach(p => list.appendChild(permitCard(project, p, true)));
  }
  if (decided.length) {
    list.appendChild(el('h3', { class: 'font-semibold mt-4 mb-2 text-stone-600' }, `已處理（${decided.length}）`));
    decided.forEach(p => list.appendChild(permitCard(project, p, false)));
  }
}

// ===== 林業合作社：唯讀彙整（掌握申請資訊 + 共同銷售葉片採收彙整）=====
// 唯讀：rules 天然鎖死（coop 非 canCollect / 非 harvest_authority / 非 owner）→ 此頁不放任何寫入。
// 僅顯示已送出（含）起的案件（排除林農私人草稿）。葉片採收累計直接讀 permit.totalLogged_kg（P2 已 denormalized）。
// v2.11.41：申請階段移除預估產量/用途（林農對預估落差有顧慮、無估計機制），彙整改以實際回報葉片採收量為主。

export async function renderCoopView(project) {
  bindFb();
  const box = $('#coop-view');
  if (!box) return;
  box.innerHTML = '<div class="text-sm text-stone-500 p-4">載入中…</div>';
  let permits;
  try {
    permits = await loadPermits(project.id);
  } catch (e) {
    box.innerHTML = `<div class="text-sm text-red-600 p-4">載入失敗：${e.message}</div>`;
    return;
  }
  const list = permits.filter(p => p.status !== 'draft');
  if (list.length === 0) {
    box.innerHTML = '<div class="text-sm text-stone-500 p-4">目前沒有已送出的修枝申請。</div>';
    return;
  }

  // 總覽統計
  const statusCount = {};
  list.forEach(p => { statusCount[p.status] = (statusCount[p.status] || 0) + 1; });
  const approvedish = list.filter(p => ['approved', 'harvesting', 'completed'].includes(p.status));
  const realizedKg = list.reduce((s, p) => s + (p.totalLogged_kg || 0), 0);

  // 依林農彙整（v2.11.41：申請階段不再預估產量/用途，彙整以實際回報葉片採收量為主）
  const byFarmer = {};
  list.forEach(p => {
    const k = p.applicantName || '（未填申請人）';
    const f = byFarmer[k] || (byFarmer[k] = { name: k, cases: 0, realized: 0 });
    f.cases++;
    f.realized += (p.totalLogged_kg || 0);
  });
  const farmers = Object.values(byFarmer).sort((a, b) => b.realized - a.realized);

  box.innerHTML = '';

  // 1) 專區總覽
  box.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' },
    el('h3', { class: 'font-semibold mb-2' }, '📋 專區總覽'),
    el('div', { class: 'text-sm space-y-1' },
      el('div', {}, `申請案（已送出起）：${list.length} 件　已核准/修枝作業中/結案：${approvedish.length} 件`),
      el('div', {}, '狀態分布：' + Object.entries(statusCount)
        .map(([s, n]) => `${(HP_STATUS[s] || { label: s }).label} ${n}`).join('　') ),
      el('div', { class: 'text-emerald-700 font-medium' },
        `已回報葉片採收量（事後實際累計）：${realizedKg.toFixed(1)} kg`)
    )
  ));

  // 2) 依林農葉片採收彙整（共同銷售）
  const tbl = el('table', { class: 'w-full text-xs border-collapse' },
    el('thead', {}, el('tr', { class: 'bg-stone-100' },
      ...['林農', '案件數', '已回報葉片採收量(kg)'].map(h =>
        el('th', { class: 'border px-2 py-1 text-left' }, h)))),
    el('tbody', {}, ...farmers.map(f => el('tr', {},
      el('td', { class: 'border px-2 py-1' }, f.name),
      el('td', { class: 'border px-2 py-1' }, String(f.cases)),
      el('td', { class: 'border px-2 py-1 font-medium text-emerald-700' }, f.realized.toFixed(1))
    )))
  );
  box.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' },
    el('h3', { class: 'font-semibold mb-2' }, '🤝 依林農葉片採收彙整（共同銷售）'),
    el('div', { class: 'overflow-x-auto' }, tbl),
    el('div', { class: 'text-xs text-stone-500 mt-2' },
      '「已回報葉片採收量」＝核准後實際葉片採收回報累計（修枝作業中/已結案），即可投入共同銷售之數量（鮮葉重）。')
  ));

  // 3) 各申請案（唯讀，核准後可檢視許可單）
  const cases = el('div', { class: 'space-y-2' });
  list
    .slice()
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .forEach(p => {
      const canView = ['approved', 'harvesting', 'completed'].includes(p.status);
      cases.appendChild(el('div', {
        class: 'bg-white rounded-lg shadow p-3 flex items-center justify-between gap-2 flex-wrap'
      },
        el('div', { class: 'text-sm' },
          el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('span', { class: 'font-medium' }, p.applicantName || '（未填申請人）'),
            hpBadge(p.status),
            p.permitNo ? el('span', { class: 'text-xs text-stone-500' }, `文號 ${p.permitNo}`) : null),
          el('div', { class: 'text-xs text-stone-500' },
            `林地 ${p.landParcel || '—'}　已回報葉片採收 ${fmtNum(p.totalLogged_kg)} kg`)
        ),
        canView
          ? el('button', {
              class: 'text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded',
              onClick: () => openPermitDetail(project, p)
            }, '📄 採取許可單')
          : null
      ));
    });
  box.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-4' },
    el('h3', { class: 'font-semibold mb-2' }, '📑 各申請案（唯讀）'),
    cases
  ));
}

function openDecisionModal(project, p, action) {
  const isApprove = action === 'approve';
  const title = { approve: '核准修枝申請', revision: '要求補件', reject: '駁回修枝申請' }[action];
  const body = el('div', { class: 'space-y-2' });
  body.appendChild(el('div', { class: 'text-sm text-stone-600' },
    `申請人：${p.applicantName}　林地：${p.landParcel}　修枝面積：${fmtNum(p.forestArea_ha)} ha　修枝株數：${fmtNum(p.estTrees)}`));

  // v2.11.69：核准 modal 拿掉「核准葉片採收量 (kg)」欄位 — 業務拍板：許可只許可修枝作業、
  //   不預估/限制採收量；採收量以實際回報為準。承辦人只需填效期與選填審核附註。
  let fromInput, untilInput;
  if (isApprove) {
    fromInput = el('input', { type: 'date', value: p.periodFrom || '', class: 'w-full border rounded px-2 py-1 text-sm' });
    untilInput = el('input', { type: 'date', value: p.periodTo || '', class: 'w-full border rounded px-2 py-1 text-sm' });
    body.appendChild(el('div', { class: 'text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded px-2 py-1.5' },
      '本案核准後即許可進行修枝作業；所採取葉片重量由林農於 ForestMRV 線上系統實際回報，不設預估上限。'));
    body.appendChild(el('div', { class: 'grid grid-cols-2 gap-2' },
      el('div', {}, el('label', { class: 'block text-sm font-medium mb-0.5' }, '效期起日'), fromInput),
      el('div', {}, el('label', { class: 'block text-sm font-medium mb-0.5' }, '效期迄日'), untilInput)
    ));
  }
  const commentInput = el('textarea', {
    rows: 3, class: 'w-full border rounded px-2 py-1 text-sm',
    placeholder: isApprove ? '審核附註（選填）' : '請填寫理由（必填）'
  });
  body.appendChild(el('div', {},
    el('label', { class: 'block text-sm font-medium mb-0.5' },
      isApprove ? '審核附註' : '理由', isApprove ? null : el('span', { class: 'text-red-600' }, ' *')),
    commentInput));

  const confirmBtn = el('button', {
    class: `w-full px-3 py-2 rounded text-sm font-medium text-white ${isApprove ? 'bg-emerald-600' : action === 'revision' ? 'bg-orange-500' : 'bg-red-600'}`
  }, isApprove ? '✅ 確認核准' : action === 'revision' ? '↩️ 退回補件' : '✕ 確認駁回');
  body.appendChild(confirmBtn);

  confirmBtn.addEventListener('click', async () => {
    const comment = commentInput.value.trim();
    if (!isApprove && !comment) { toast('請填寫理由'); return; }
    confirmBtn.disabled = true;
    try {
      if (isApprove) {
        const permitRef = doc(db, 'projects', project.id, 'harvestPermits', p.id);
        const counterRef = doc(db, 'projects', project.id, 'counters', 'harvestPermit');
        // 法定許可文號不可重號 → Firestore transaction 原子遞增（解 treeCode 非原子同類問題）
        const assignedNo = await runTransaction(db, async (tx) => {
          const cSnap = await tx.get(counterRef);
          const next = (cSnap.exists() ? (cSnap.data().seq || 0) : 0) + 1;
          const permitNo = buildPermitNo(next);
          tx.set(counterRef, { seq: next }, { merge: true });
          tx.update(permitRef, {
            status: 'approved',
            // v2.11.69：approvedAmount_kg 一律寫 null（schema 保留向後相容；UI 全藏；
            //   業務上不再預估/限制採收量，採收以實際回報為準）
            approvedAmount_kg: null,
            validFrom: fromInput.value || '',
            validUntil: untilInput.value || '',
            permitNo,
            permitSeq: next,
            reviewedBy: state.user.uid,
            reviewedAt: serverTimestamp(),
            reviewComment: comment,
            updatedAt: serverTimestamp()
          });
          return permitNo;
        });
        closeModal();
        toast(`✅ 已核准，許可文號 ${assignedNo}`, 4000);
      } else {
        await updateDoc(doc(db, 'projects', project.id, 'harvestPermits', p.id), {
          status: action === 'revision' ? 'revision' : 'rejected',
          reviewedBy: state.user.uid,
          reviewedAt: serverTimestamp(),
          reviewComment: comment,
          updatedAt: serverTimestamp()
        });
        closeModal();
        toast(action === 'revision' ? '已退回補件' : '已駁回');
      }
      renderHarvestReview(project);
    } catch (e) {
      confirmBtn.disabled = false;
      console.error('decision 失敗', e);
      toast('操作失敗：' + e.message);
    }
  });
  openModal(title, body);
}

// ===== 葉片採收量登錄（林農端，許可單 approved/harvesting 時）=====
export function openHarvestLogForm(project, permit) {
  bindFb();
  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'text-sm text-stone-600' },
      // v2.11.69：拿掉「核准量」對照，只顯示許可文號 + 已回報累計
      `許可文號 ${permit.permitNo || '—'}　已回報累計 ${fmtNum(permit.totalLogged_kg)} kg`),
    fld('採收日期', 'logDate', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
    fld('實際鮮葉重 (kg)', 'amount_kg_fresh', { type: 'number', step: '0.1', min: 0, required: true }),
    fld('乾燥後重 (kg)', 'amount_kg_dry', { type: 'number', step: '0.1', min: 0 }),
    fld('含水率 (%)', 'moisture_pct', { type: 'number', step: '0.1', min: 0, max: 100 }),
    fld('批次標示', 'batch', {}),
    fld('備註', 'note', { type: 'textarea' }),
    el('button', { type: 'submit', class: 'w-full bg-emerald-600 text-white px-3 py-2 rounded text-sm font-medium' }, '＋ 新增葉片採收紀錄')
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const fresh = num(fd.get('amount_kg_fresh'));
    if (!fd.get('logDate') || fresh == null) { toast('請填採收日期與鮮葉重'); return; }
    const data = {
      logDate: fd.get('logDate'),
      amount_kg_fresh: fresh,
      amount_kg_dry: num(fd.get('amount_kg_dry')),
      moisture_pct: num(fd.get('moisture_pct')),
      batch: (fd.get('batch') || '').trim(),
      note: (fd.get('note') || '').trim(),
      createdBy: state.user.uid,
      loggedBy: state.user.uid,
      loggedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    };
    try {
      await addDoc(collection(db, 'projects', project.id, 'harvestPermits', permit.id, 'logs'), data);
      // 重新加總並回寫許可單（denormalized → 卡片即時可見；同步推進 approved→harvesting）
      const logs = await loadLogs(project.id, permit.id);
      const total = Math.round(logs.reduce((s, l) => s + (l.amount_kg_fresh || 0), 0) * 100) / 100;
      const upd = { totalLogged_kg: total, updatedAt: serverTimestamp() };
      if (permit.status === 'approved') {
        upd.status = 'harvesting';
        upd.harvestingStartedAt = serverTimestamp();
      }
      await updateDoc(doc(db, 'projects', project.id, 'harvestPermits', permit.id), upd);
      closeModal();
      // v2.11.69：拿掉超量警告（許可不再設預估上限）
      toast(`✅ 已回報，累計 ${total} kg`, 4000);
      renderHarvestReport(project);
    } catch (err) {
      console.error('log save 失敗', err);
      toast('登錄失敗：' + err.message);
    }
  });
  openModal('登錄葉片採收量（土肉桂鮮葉）', f);
}

// ===== 回報完畢並結案（harvesting → completed）=====
// v2.11.39 (G1/G2)：結案＝「回報完畢」明確閘門。
//   - G1 客戶端硬擋：totalLogged_kg 為空/≤0（從未回報）→ 擋下，要求先填報；
//     伺服器 firestore.rules clause C 同步擋（治本，不靠 UI）。
//   - G2：確認框明列累計回報 vs 核准量，講清楚「結案＝葉片採收量已全數回報、不再新增」。
async function closePermit(project, permit) {
  const logged = permit.totalLogged_kg;
  if (logged == null || logged <= 0) {
    toast('尚未回報任何葉片採收量 — 請先「＋ 填報葉片採收量」，回報完畢後才能結案', 4000);
    return;
  }
  // v2.11.69：拿掉核准量對照（許可不再預估上限）
  if (!confirm(
    `確定「回報完畢並結案」此林產物採取許可？\n\n` +
    `許可文號：${permit.permitNo || '—'}\n` +
    `累計回報葉片採收量：${fmtNum(logged)} kg\n\n` +
    `結案代表本案實際葉片採收量已全數回報完畢、不再新增。\n` +
    `結案後不可再填報，狀態固定供分署/合作社查核與彙整。`
  )) return;
  try {
    await updateDoc(doc(db, 'projects', project.id, 'harvestPermits', permit.id), {
      status: 'completed', completedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    toast('✅ 已回報完畢並結案');
    renderHarvestReport(project);
  } catch (e) {
    toast('結案失敗：' + e.message);
  }
}

// ===== 林產物採取許可單／葉片採收總結（雙方檢視 + 列印）=====
async function openPermitDetail(project, permit) {
  const body = el('div', { class: 'space-y-3' });
  body.appendChild(el('div', { class: 'text-sm space-y-0.5' },
    el('div', {}, el('b', {}, '林產物採取許可單（土肉桂修枝及枝葉採取）')),
    el('div', {}, `許可文號：${permit.permitNo || '（未生成）'}`),
    el('div', {}, `申請人：${permit.applicantName || '—'}　聯絡：${permit.contact || '—'}`),
    el('div', {}, `林地：${permit.landParcel || '—'}（${fmtNum(permit.forestArea_ha)} ha）`),
    el('div', {}, `修枝方式：${permit.harvestMethod || '—'}　修枝株數：${fmtNum(permit.estTrees)}`),
    // v2.11.69：拿掉「核准葉片採收量」整行 + 加一句宣告（業務拍板：許可只許可修枝作業、不預估上限）
    el('div', {}, `效期：${permit.validFrom || '—'} ~ ${permit.validUntil || '—'}`),
    el('div', { class: 'text-xs text-stone-500 mt-1' },
      '本許可只許可修枝作業；所採取葉片重量以實際回報為準、不設預估上限。'),
    permit.reviewComment ? el('div', {}, `審核附註：${permit.reviewComment}`) : null
  ));
  const logsBox = el('div', { class: 'text-sm text-stone-500' }, '載入葉片採收紀錄…');
  body.appendChild(logsBox);
  const printBtn = el('button', { class: 'w-full bg-stone-700 text-white px-3 py-2 rounded text-sm' }, '🖨️ 列印林產物採取許可單');
  body.appendChild(printBtn);
  openModal('林產物採取許可單／葉片採收總結', body);

  let logs = [];
  try { logs = await loadLogs(project.id, permit.id); } catch {}
  const total = logs.reduce((s, l) => s + (l.amount_kg_fresh || 0), 0);

  logsBox.className = 'text-sm';
  logsBox.innerHTML = '';
  logsBox.appendChild(el('div', { class: 'font-medium mb-1' }, `葉片採收紀錄（共 ${logs.length} 筆）`));
  logsBox.appendChild(el('table', { class: 'w-full text-xs border-collapse' },
    el('thead', {}, el('tr', { class: 'bg-stone-100' },
      ...['採收日', '鮮重(kg)', '乾重(kg)', '含水率%', '批次'].map(h =>
        el('th', { class: 'border px-1 py-0.5 text-left' }, h)))),
    el('tbody', {}, ...(logs.length
      ? logs.map(l => el('tr', {},
          el('td', { class: 'border px-1 py-0.5' }, l.logDate || '—'),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.amount_kg_fresh)),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.amount_kg_dry)),
          el('td', { class: 'border px-1 py-0.5' }, fmtNum(l.moisture_pct)),
          el('td', { class: 'border px-1 py-0.5' }, l.batch || '—')))
      : [el('tr', {}, el('td', { class: 'border px-1 py-2 text-center text-stone-400', colspan: '5' }, '尚無葉片採收紀錄'))]))
  ));
  // v2.11.69：拿掉「核准量對照 + 超量警告」，只顯示累計鮮葉採收量
  logsBox.appendChild(el('div', { class: 'mt-1 text-stone-700 font-medium' },
    `累計鮮葉採收量：${total.toFixed(1)} kg`));

  printBtn.addEventListener('click', () => printPermit(permit, logs, total));
}

function printPermit(permit, logs, total) {
  const roc = new Date().getFullYear() - 1911;
  const esc = s => String(s ?? '—').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const rowsHtml = logs.length
    ? logs.map(l => `<tr><td>${esc(l.logDate)}</td><td style="text-align:right">${esc(l.amount_kg_fresh)}</td><td style="text-align:right">${esc(l.amount_kg_dry)}</td><td style="text-align:right">${esc(l.moisture_pct)}</td><td>${esc(l.batch)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#999">尚無葉片採收紀錄</td></tr>';
  // v2.11.69：拿掉「核准葉片採收量」row 與「核准量對照/超量警告」；改為一句宣告
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>林產物採取許可單 ${esc(permit.permitNo)}</title>
<style>body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;margin:32px;color:#222;font-size:13px}
h1{text-align:center;font-size:20px;margin:0 0 4px}.sub{text-align:center;color:#666;margin-bottom:18px}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #888;padding:4px 8px}
th{background:#eee}.kv{margin:3px 0}.box{border:1px solid #888;padding:14px 18px;margin-bottom:16px}
.declare{font-size:12px;color:#666;margin-top:6px;padding-top:6px;border-top:1px dashed #ccc}
.total{margin-top:10px;font-weight:bold}
.sign{margin-top:40px;display:flex;justify-content:space-between}
.noprint{background:#f3f4f6;border:1px solid #ccc;border-radius:6px;padding:8px;margin-bottom:16px;display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.noprint .hint{flex:1;font-size:12px;color:#666;min-width:140px}
.noprint button{border:0;padding:9px 16px;border-radius:6px;font-size:15px;color:#fff;cursor:pointer}
@media print{.noprint{display:none!important}}</style>
</head><body>
<div class="noprint">
<span class="hint">列印或存成 PDF 後，點「關閉並返回」回到系統。</span>
<button style="background:#15803d" onclick="window.print()">🖨️ 列印 / 存 PDF</button>
<button style="background:#555" onclick="window.close()">✕ 關閉並返回</button>
</div>
<h1>林產物採取許可單(土肉桂修枝及枝葉採取)</h1>
<div class="sub">林業及自然保育署臺中分署　中華民國 ${roc} 年</div>
<div class="box">
<div class="kv"><b>許可文號：</b>${esc(permit.permitNo)}</div>
<div class="kv"><b>申請人：</b>${esc(permit.applicantName)}　<b>聯絡方式：</b>${esc(permit.contact)}</div>
<div class="kv"><b>林地(林班/地號)：</b>${esc(permit.landParcel)}　<b>面積：</b>${esc(permit.forestArea_ha)} ha</div>
<div class="kv"><b>修枝方式：</b>${esc(permit.harvestMethod)}　<b>土肉桂修枝株數：</b>${esc(permit.estTrees)}</div>
<div class="kv"><b>效期：</b>${esc(permit.validFrom)} ~ ${esc(permit.validUntil)}</div>
${permit.reviewComment ? `<div class="kv"><b>審核附註：</b>${esc(permit.reviewComment)}</div>` : ''}
<div class="declare">本許可只許可於上述林地進行土肉桂修枝作業；所採取葉片重量以申請人於 ForestMRV 線上系統實際回報為準，不設預估上限。</div>
</div>
<b>葉片採收量登錄紀錄</b>
<table><thead><tr><th>採收日</th><th>鮮重(kg)</th><th>乾重(kg)</th><th>含水率%</th><th>批次</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class="total">累計鮮葉採收量：${total.toFixed(1)} kg</div>
<div class="sign"><div>申請人簽章：________________</div><div>分署核章：________________</div></div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器封鎖彈出視窗，請允許後重試'); return; }
  w.document.write(html);
  w.document.close();
}

// ===== v2.11.67：自製 SVG 作業位置圖（給申請公文稿附件區嵌入）=====
//   設計選擇：用 SVG inline（非 leaflet-image / html2canvas）— 無 CORS 問題、無外部依賴、
//   black/white 印表友善、確定性高。
//   邏輯：
//     1. 從 project.boundaryGeoJsonStr (FC) 找出 unitId 對應作業單元（紅色高亮）
//     2. 收集 bbox 1.5× 範圍內的鄰近作業單元（灰色當 context）
//     3. 緯度補償 (lon * cos(lat))，保留正確 aspect ratio
//     4. 等比例縮放置中到 width × height 視窗
//     5. 加 N 北方箭頭 + 中央 unitId 標籤
function buildLocationSvg(project, meta, opts = {}) {
  const width = opts.width || 420;
  const height = opts.height || 300;
  const padding = 12;
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  if (!project?.boundaryGeoJsonStr || !meta?.unitId) return null;
  let geo;
  try { geo = JSON.parse(project.boundaryGeoJsonStr); }
  catch { return null; }
  if (geo?.type !== 'FeatureCollection') return null;

  // helpers
  const collectCoords = (g, out) => {
    if (!g) return;
    if (g.type === 'Polygon') g.coordinates.forEach(ring => ring.forEach(c => out.push(c)));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(ring => ring.forEach(c => out.push(c))));
  };
  const featureBbox = (f) => {
    const cs = [];
    collectCoords(f.geometry, cs);
    if (cs.length === 0) return null;
    let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
    for (const [x, y] of cs) {
      if (x<mnX)mnX=x; if (x>mxX)mxX=x; if (y<mnY)mnY=y; if (y>mxY)mxY=y;
    }
    return { minX: mnX, maxX: mxX, minY: mnY, maxY: mxY };
  };
  const expandBbox = (b, factor) => {
    const w = (b.maxX - b.minX) || 0.0001;
    const h = (b.maxY - b.minY) || 0.0001;
    return { minX: b.minX - w*factor, maxX: b.maxX + w*factor, minY: b.minY - h*factor, maxY: b.maxY + h*factor };
  };
  const bboxIntersects = (a, b) =>
    !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);

  // 找目標作業單元
  const targets = geo.features.filter(f => {
    const code = f.properties?.['作業區'] || f.properties?.['標示'];
    return code === meta.unitId;
  });
  if (targets.length === 0) return null;

  // 合併目標 bbox
  let tBbox = null;
  for (const t of targets) {
    const b = featureBbox(t);
    if (!b) continue;
    if (!tBbox) tBbox = { ...b };
    else {
      tBbox.minX = Math.min(tBbox.minX, b.minX); tBbox.maxX = Math.max(tBbox.maxX, b.maxX);
      tBbox.minY = Math.min(tBbox.minY, b.minY); tBbox.maxY = Math.max(tBbox.maxY, b.maxY);
    }
  }
  if (!tBbox) return null;

  // 鄰近作業單元（1.5× target bbox 內）為 context
  const ctxBbox = expandBbox(tBbox, 1.5);
  const ctxs = geo.features.filter(f => {
    if (targets.includes(f)) return false;
    const b = featureBbox(f);
    return b && bboxIntersects(b, ctxBbox);
  });

  // 視窗 bbox = ctxBbox 再加 5% 視覺 padding
  const vBbox = expandBbox(ctxBbox, 0.05);

  // 緯度補償：lon * cos(lat_center)
  const latCenter = (vBbox.minY + vBbox.maxY) / 2;
  const lonScale = Math.cos(latCenter * Math.PI / 180);
  const dataW = (vBbox.maxX - vBbox.minX) * lonScale;
  const dataH = vBbox.maxY - vBbox.minY;
  const viewW = width - 2*padding, viewH = height - 2*padding;
  const dataAspect = dataW / dataH;
  const viewAspect = viewW / viewH;
  let scale, offsetX, offsetY;
  if (dataAspect > viewAspect) {
    scale = viewW / dataW;
    offsetX = padding;
    offsetY = padding + (viewH - dataH * scale) / 2;
  } else {
    scale = viewH / dataH;
    offsetX = padding + (viewW - dataW * scale) / 2;
    offsetY = padding;
  }
  const toX = (lon) => offsetX + (lon - vBbox.minX) * lonScale * scale;
  const toY = (lat) => offsetY + (vBbox.maxY - lat) * scale;

  const geomToPath = (g) => {
    const polys = [];
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => polys.push(p));
    return polys.map(rings =>
      rings.map(ring =>
        'M ' + ring.map(([lon, lat]) => `${toX(lon).toFixed(1)},${toY(lat).toFixed(1)}`).join(' L ') + ' Z'
      ).join(' ')
    ).join(' ');
  };

  const ctxPaths = ctxs.map(f => `<path d="${geomToPath(f.geometry)}" fill="#e5e7eb" stroke="#6b7280" stroke-width="0.5" opacity="0.85"/>`).join('');
  const tgtPaths = targets.map(f => `<path d="${geomToPath(f.geometry)}" fill="#fecaca" stroke="#991b1b" stroke-width="1.5"/>`).join('');

  // 標籤：目標 unitId（粗體紅）+ 鄰近作業單元小灰標籤
  const tLabel = (() => {
    const cx = (tBbox.minX + tBbox.maxX) / 2;
    const cy = (tBbox.minY + tBbox.maxY) / 2;
    return `<text x="${toX(cx).toFixed(1)}" y="${(toY(cy) + 3).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#7f1d1d">${esc(meta.unitId)}</text>`;
  })();
  const ctxLabels = ctxs.map(f => {
    const code = f.properties?.['作業區'] || f.properties?.['標示'] || '';
    if (!code) return '';
    const b = featureBbox(f);
    if (!b) return '';
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return `<text x="${toX(cx).toFixed(1)}" y="${(toY(cy) + 2).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="7" fill="#4b5563">${esc(code)}</text>`;
  }).join('');

  // 北方箭頭（右上）
  const northArrow = `
    <g transform="translate(${width - 22},${22})">
      <polygon points="0,-12 -5,-2 0,-5 5,-2" fill="#111827" stroke="none"/>
      <line x1="0" y1="-5" x2="0" y2="8" stroke="#111827" stroke-width="1"/>
      <text x="0" y="-15" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#111827">N</text>
    </g>`;

  // 邊框
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#f9fafb;border:1px solid #6b7280;">
    ${ctxPaths}
    ${ctxLabels}
    ${tgtPaths}
    ${tLabel}
    ${northArrow}
  </svg>`;
}

// ===== 申請公文「函」稿（林農端，紙本正式發文用；與線上記錄同一資料來源）=====
//   v2.11.67：accept project 參數，呼叫 buildLocationSvg 嵌入位置圖
function printApplicationLetter(permit, project = null) {
  const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const today = new Date();
  const rocFull = d => `中華民國 ${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const rocYmd = s => {
    if (!s) return '＿＿＿年＿＿月＿＿日';
    const d = new Date(s);
    if (isNaN(d)) return esc(s);
    return `${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  };
  const v = x => (x == null || x === '') ? '—' : esc(x);
  // v2.11.67：嘗試產生作業位置 SVG（需 project + permit.landParcelMeta.unitId）；失敗則 locationSvg=null
  const locationSvg = (project && permit?.landParcelMeta?.unitId)
    ? buildLocationSvg(project, permit.landParcelMeta, { width: 420, height: 300 })
    : null;
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>土肉桂修枝申請函 ${v(permit.applicantName)}</title>
<style>
body{font-family:"DFKai-SB","BiauKai","標楷體","Microsoft JhengHei",serif;color:#000;margin:2.5cm 2.2cm;font-size:16px;line-height:1.9}
.title{text-align:center;font-size:22px;font-weight:bold;letter-spacing:4px;margin-bottom:18px}
.row{margin:2px 0}.lbl{display:inline-block;min-width:5em}
.subject{margin:14px 0;font-size:17px}.subject b{letter-spacing:2px}
ol{margin:4px 0 4px 0;padding-left:1.8em}ol li{margin:4px 0}
.tbl{border-collapse:collapse;width:100%;margin:8px 0}
.tbl th,.tbl td{border:1px solid #000;padding:5px 8px;font-size:15px}
.tbl th{background:#f0f0f0;width:9em;text-align:left}
.foot{margin-top:26px}.sign{margin-top:30px;text-align:right;line-height:2.4}
.recv{margin-top:26px;border:1px solid #000;padding:8px 12px;font-size:14px}
.recv .h{font-weight:bold;margin-bottom:6px}
.line{display:inline-block;border-bottom:1px solid #000;min-width:8em}
/* v2.11.67：作業位置示意圖 */
.loc-map{margin:14px 0;padding:8px;border:1px solid #000;page-break-inside:avoid}
.loc-map-title{font-weight:bold;font-size:15px;margin-bottom:4px}
.loc-map-sub{font-size:12px;color:#374151;margin-bottom:6px;line-height:1.4}
.loc-map-svg{text-align:center;margin:6px 0}
.loc-map-svg svg{max-width:100%;height:auto}
.loc-map-meta{font-size:13px;margin-top:6px;border-top:1px dashed #6b7280;padding-top:4px}
.noprint{background:#f3f4f6;border:1px solid #ccc;border-radius:6px;padding:8px;margin:-1cm -1cm 18px;display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;font-family:"Microsoft JhengHei",sans-serif}
.noprint .hint{flex:1;font-size:12px;color:#666;min-width:140px}
.noprint button{border:0;padding:9px 16px;border-radius:6px;font-size:15px;color:#fff;cursor:pointer}
@media print{body{margin:2cm}.noprint{display:none!important}}
</style></head><body>
<div class="noprint">
<span class="hint">列印或存成 PDF 後，點「關閉並返回」回到系統。</span>
<button style="background:#15803d" onclick="window.print()">🖨️ 列印 / 存 PDF</button>
<button style="background:#555" onclick="window.close()">✕ 關閉並返回</button>
</div>
<div class="title">土肉桂修枝申請函</div>
<div class="row"><span class="lbl">受文者：</span>林業及自然保育署臺中分署</div>
<div class="row"><span class="lbl">發文日期：</span>${rocFull(today)}</div>
<div class="row"><span class="lbl">發文字號：</span>${permit.applicantDocNo ? esc(permit.applicantDocNo) : '<span class="line">&nbsp;</span>（送出申請後自動編號）'}</div>
<div class="row"><span class="lbl">速別：</span>普通件　　<span class="lbl">密等：</span>普通</div>
<div class="row"><span class="lbl">附件：</span>地籍圖、現場照片等（如附）</div>
<div class="subject"><b>主　旨：</b>申請於下列林地進行土肉桂修枝及枝葉採取乙案，請　核准。</div>
<div><b>說　明：</b></div>
<ol>
<li>本案係基於土肉桂林木撫育管理及林分通風透光改善之需要，擬辦理適度修枝作業，並採取修枝後之枝葉作為後續利用。</li>
<li>本次作業將依不損及林木生長、不影響林地保育功能及避免過度修剪之原則辦理，作業過程並將注意現地環境維護及林木後續生長狀況。</li>
<li>申請作業之範圍、數量、期間及相關內容，詳如本函表列資料及所附文件，敬請惠予審核。</li>
<li>${permit.status === 'submitted' || permit.status === 'under_review' || permit.status === 'approved' || permit.status === 'harvesting' || permit.status === 'completed' ? '本案已於 ForestMRV 線上系統完成登錄送出，紙本文件內容與線上紀錄相符，併請查照。' : '本案目前於 ForestMRV 線上系統為草稿狀態（尚未送出），紙本文件內容與線上紀錄相符，併請查照。'}</li>
</ol>
<table class="tbl">
<tr><th>申請人</th><td>${v(permit.applicantName)}</td><th>聯絡方式</th><td>${v(permit.contact)}</td></tr>
<tr><th>林班／地號</th><td colspan="3">${v(permit.landParcel)}</td></tr>
<tr><th>修枝面積</th><td>${v(permit.forestArea_ha)} ha</td><th>土肉桂修枝株數</th><td>${v(permit.estTrees)}</td></tr>
<tr><th>修枝方式</th><td colspan="3">${v(permit.harvestMethod) || '修枝'}</td></tr>
<tr><th>修枝作業期間</th><td colspan="3">${permit.periodFrom ? esc(permit.periodFrom) : '—'} ~ ${permit.periodTo ? esc(permit.periodTo) : '—'}</td></tr>
<tr><th>備註</th><td colspan="3">${v(permit.note)}</td></tr>
</table>
${locationSvg ? `<div class="loc-map">
  <div class="loc-map-title">附圖：作業位置示意圖</div>
  <div class="loc-map-sub">紅色實心區域為本次申請修枝作業單元；灰色為鄰近作業單元（context）。圖面上方為地理北方。</div>
  <div class="loc-map-svg">${locationSvg}</div>
  <div class="loc-map-meta">作業單元代碼：<b>${v(permit.landParcelMeta?.unitId)}</b>　│　專區：${v(permit.landParcelMeta?.zone)}　│　承租人：${v(permit.landParcelMeta?.lessee)}</div>
</div>` : ''}
<div class="sign">申請人：________________（簽章）<br>身分證／統一編號：________________<br>申請日期：${rocFull(today)}</div>
<div class="recv">
<div class="h">（以下由林業及自然保育署臺中分署收件填用）</div>
收文日期：____________　收文文號：____________　承辦人：____________
</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器封鎖彈出視窗，請允許後重試'); return; }
  w.document.write(html);
  w.document.close();
}
