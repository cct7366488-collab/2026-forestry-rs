// js/harvest-permits.js — 土肉桂葉片採收：林產物採取許可電子化（全鏈路 + 公文稿 + 合作社彙整，v2.11.37）
//
// 行政流程（依《森林法》第 15 條 / 林產物處分相關規定）：
//   林農申請 → 林保署核准（生法定許可文號）→ 收穫量登錄（累計 vs 核准量）→ 結案
//   雙軌：申請端可印「申請公文函稿」、核准端可印「採收許可單」（皆即時由線上記錄產生，不另存副本）
//
// 狀態機：
//   draft ─送出→ submitted ─分署─┬─核准（transaction 生許可文號）→ approved
//                                ├─駁回→ rejected（終結）
//                                └─補件→ revision ─補正再送→ submitted
//   approved ─首筆收穫登錄→ harvesting ─結案→ completed
//
// 權限分流（與 firestore.rules 對齊）：
//   林農端（pi/surveyor/admin，canCollect）：申請/編輯草稿/送出/刪草稿、收穫量登錄/結案
//   分署端（harvest_authority/admin）：僅 submitted 時核准/駁回/補件，受限只能寫狀態+審核欄位+文號
//   合作社（coop/admin）：唯讀觀察者 — 採收彙整分頁（總覽 + 依林農收穫彙整供共同銷售）；無寫入權
//   許可文號：counters/harvestPermit 原子流水號（runTransaction，法定編號不可重號）
//
// 注意：本模組所有 import 的 ?v= 須與 index.html / app.js 一致（ESM 單實例，見 SW v2.10.2 雷）

import { fb, $, el, toast, openModal, closeModal, state, isPi, isSystemAdmin } from './app.js?v=21143';

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
  harvesting:   { label: '採收中',       cls: 'bg-teal-100 text-teal-800' },
  completed:    { label: '已結案',       cls: 'bg-slate-200 text-slate-700' },
  rejected:     { label: '已駁回',       cls: 'bg-red-100 text-red-800' }
};

const HARVEST_METHODS = ['修枝採葉', '截幹採葉', '其他'];
const USE_OPTS = ['精油萃取', '乾燥食用', '兩者皆有', '其他'];

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
  return `林保中-土肉桂採葉-${roc}-${String(seq).padStart(3, '0')}`;
}

// 累計收穫 vs 核准量（denormalized 在許可單上，卡片即時顯示）
function quotaInfo(p) {
  const approved = p.approvedAmount_kg;
  const used = p.totalLogged_kg;
  if (approved == null || used == null) return null;
  const pct = approved > 0 ? (used / approved) * 100 : 0;
  let cls = 'text-stone-600';
  if (pct > 100) cls = 'text-red-700 font-semibold';
  else if (pct > 90) cls = 'text-amber-700 font-medium';
  return { text: `已回報 ${used} / 核准 ${approved} kg（${pct.toFixed(0)}%）`, cls, over: pct > 100 };
}

// ===== 共用：申請卡片 =====
function permitCard(project, p, reviewMode) {
  const mineOrManager = p.createdBy === state.user.uid || isPi() || isSystemAdmin();
  const canEdit = mineOrManager && (p.status === 'draft' || p.status === 'revision');
  // v2.11.39：填報/結案改至「🌾 採收回報及結案」分頁（renderHarvestReport），申請卡僅指路
  const needsReport = mineOrManager && (p.status === 'approved' || p.status === 'harvesting');
  const hasPermitDoc = p.status === 'approved' || p.status === 'harvesting' || p.status === 'completed';

  const rows = [
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('span', { class: 'font-semibold' }, p.applicantName || '（未填申請人）'),
      hpBadge(p.status),
      p.permitNo ? el('span', { class: 'text-xs text-stone-500' }, `許可文號 ${p.permitNo}`) : null
    ),
    el('div', { class: 'text-sm text-stone-600' },
      `林地：${p.landParcel || '—'}　面積：${fmtNum(p.forestArea_ha)} ha　申請鮮葉量：${fmtNum(p.estAmount_kg)} kg`),
    el('div', { class: 'text-xs text-stone-500' },
      `採法：${p.harvestMethod || '—'}　期間：${p.periodFrom || '—'} ~ ${p.periodTo || '—'}　用途：${p.uses || '—'}`)
  ];
  if (hasPermitDoc) {
    rows.push(el('div', { class: 'text-xs text-emerald-700 mt-1' },
      `核准量 ${fmtNum(p.approvedAmount_kg)} kg　效期 ${p.validFrom || '—'} ~ ${p.validUntil || '—'}`));
    const q = quotaInfo(p);
    if (q) rows.push(el('div', { class: `text-xs mt-0.5 ${q.cls}` },
      q.text + (q.over ? '　⚠ 已超過核准量' : '')));
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
        onClick: () => openHarvestPermitForm(project, p)
      }, '✏️ 編輯'));
      actions.appendChild(el('button', {
        class: 'text-xs bg-forest-700 text-white px-2 py-1 rounded',
        onClick: () => submitPermit(project, p)
      }, '📤 送出申請'));
    }
    if (needsReport) {
      // v2.11.39：填報實際採收量與結案統一在「🌾 採收回報及結案」分頁；申請卡僅指路
      actions.appendChild(el('div', {
        class: 'w-full text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded'
      }, '✅ 已核准 → 請至「🌾 採收回報及結案」分頁填報實際採收量，回報完畢後結案'));
    }
    if (p.status === 'draft' && mineOrManager) {
      actions.appendChild(el('button', {
        class: 'text-xs text-red-600 hover:text-red-800 underline',
        onClick: () => deletePermit(project, p)
      }, '✕ 刪除草稿'));
    }
    // 申請公文「函」稿 — 草稿/送出後皆可下載，供紙本正式發文（電子＋文書雙軌同步）
    if (mineOrManager) {
      actions.appendChild(el('button', {
        class: 'text-xs border border-stone-400 text-stone-700 hover:bg-stone-50 px-2 py-1 rounded',
        onClick: () => printApplicationLetter(p)
      }, '📄 申請公文稿'));
    }
  }
  // 採收許可單／收穫總結 — 核准後雙方（林農 + 分署）皆可檢視與列印
  if (hasPermitDoc) {
    actions.appendChild(el('button', {
      class: 'text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded',
      onClick: () => openPermitDetail(project, p)
    }, '📄 採收許可單'));
  }
  rows.push(actions);
  return el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' }, ...rows);
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

// ===== 林農端：採收申請 =====
export async function renderHarvestApply(project) {
  bindFb();
  const list = $('#harvestapply-list');
  if (!list) return;

  const newBtn = $('#btn-new-permit');
  if (newBtn && !newBtn._bound) {
    newBtn._bound = true;
    newBtn.addEventListener('click', () => openHarvestPermitForm(project));
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
    list.innerHTML = '<div class="text-sm text-stone-500 p-4">尚無採收申請。點上方「＋ 新採收申請」開始。</div>';
    return;
  }
  list.innerHTML = '';
  mine.forEach(p => list.appendChild(permitCard(project, p, false)));
}

// ===== 林農端：採收回報及結案（v2.11.39）=====
// 核准後「實際採收量的填報」與「結案」統一在此分頁，使資訊架構對應真實流程：
//   申請 → 審核 → 【採收回報及結案】 → 彙整。只列該林農 approved/harvesting/completed 的案。
//   - approved 尚未回報 → 紅幅明示「務必回報」（G2）
//   - 可分批多次「＋ 填報採收量」；即時顯示 已回報累計 vs 核准量 + 達成率/超量
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
  const approved = p.approvedAmount_kg;
  const noReport = (logged == null || logged <= 0);

  const rows = [
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('span', { class: 'font-semibold' }, p.applicantName || '（未填申請人）'),
      hpBadge(p.status),
      p.permitNo ? el('span', { class: 'text-xs text-stone-500' }, `許可文號 ${p.permitNo}`) : null
    ),
    el('div', { class: 'text-sm text-stone-600' },
      `林地：${p.landParcel || '—'}　申請鮮葉量：${fmtNum(p.estAmount_kg)} kg　核准量：${fmtNum(approved)} kg`),
    el('div', { class: 'text-xs text-stone-500' },
      `用途：${p.uses || '—'}　效期：${p.validFrom || '—'} ~ ${p.validUntil || '—'}`)
  ];

  const q = quotaInfo(p);
  rows.push(q
    ? el('div', { class: `text-sm mt-1 ${q.cls}` },
        '已回報累計：' + q.text + (q.over ? '　⚠ 已超過核准量' : ''))
    : el('div', { class: 'text-sm mt-1 text-stone-600' },
        `已回報累計：${fmtNum(logged || 0)} kg ／ 核准 ${fmtNum(approved)} kg`));

  // G2：approved 尚未回報 → 紅幅明示「一定要回報」
  if (p.status === 'approved' && noReport) {
    rows.push(el('div', { class: 'text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded mt-1' },
      '⚠ 已核准・尚未回報任何採收量 — 實際採收後務必在此「＋ 填報採收量」，回報完畢後方可結案。'));
  }
  if (isDone) {
    rows.push(el('div', { class: 'text-xs text-stone-500 bg-stone-100 px-2 py-1 rounded mt-1' },
      '✅ 已結案 — 採收量已回報完畢、資料固定，供分署查核與合作社彙整。'));
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
    }, '＋ 填報採收量'));
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
  }, '📄 採收許可單'));
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
    list.innerHTML = '<div class="text-sm text-stone-500 p-4">尚無已核准案件。經林業保育署臺中分署核准後，會在此填報實際採收量並結案。</div>';
    return;
  }
  // approved（尚未回報）排最前、其次 harvesting；completed 收到「已結案」區
  const active = mine.filter(p => p.status === 'approved' || p.status === 'harvesting')
    .sort((a, b) => (a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1));
  const done = mine.filter(p => p.status === 'completed');

  list.innerHTML = '';
  list.appendChild(el('div', { class: 'text-xs text-stone-500 mb-2' },
    '流程：分署核准後 → 在此「＋ 填報採收量」（可分批多次）→ 全數回報完畢後「✅ 回報完畢並結案」。結案後資料固定，合作社才能彙整。'));
  list.appendChild(el('h3', { class: 'font-semibold text-sm text-stone-700 mb-2' }, `待回報 / 採收中（${active.length}）`));
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
  const f = el('form', { class: 'space-y-2' },
    fld('申請人姓名', 'applicantName', { required: true, value: p.applicantName || (state.userDoc?.displayName ?? '') }),
    fld('聯絡方式（電話／email）', 'contact', { value: p.contact || '' }),
    fld('林班 / 地號', 'landParcel', { required: true, value: p.landParcel || '' }),
    fld('申請採收面積 (ha)', 'forestArea_ha', { type: 'number', step: '0.01', min: 0, value: p.forestArea_ha ?? '' }),
    fld('估計土肉桂株數', 'estTrees', { type: 'number', min: 0, value: p.estTrees ?? '' }),
    fld('採收方式', 'harvestMethod', { options: HARVEST_METHODS, value: p.harvestMethod || '修枝採葉' }),
    fld('預計鮮葉採收量 (kg)', 'estAmount_kg', { type: 'number', step: '0.1', min: 0, required: true, value: p.estAmount_kg ?? '' }),
    el('div', { class: 'grid grid-cols-2 gap-2' },
      fld('採收起日', 'periodFrom', { type: 'date', value: p.periodFrom || '' }),
      fld('採收迄日', 'periodTo', { type: 'date', value: p.periodTo || '' })
    ),
    fld('用途', 'uses', { options: USE_OPTS, value: p.uses || '精油萃取' }),
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
      forestArea_ha: num(fd.get('forestArea_ha')),
      estTrees: num(fd.get('estTrees')),
      harvestMethod: fd.get('harvestMethod'),
      estAmount_kg: num(fd.get('estAmount_kg')),
      periodFrom: fd.get('periodFrom') || '',
      periodTo: fd.get('periodTo') || '',
      uses: fd.get('uses'),
      note: (fd.get('note') || '').trim(),
      status: intent,
      updatedAt: serverTimestamp()
    };
    if (!data.applicantName || !data.landParcel || data.estAmount_kg == null) {
      toast('請填申請人、林班/地號、預計採收量');
      return;
    }
    if (intent === 'submitted') data.submittedAt = serverTimestamp();
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
  openModal(existing ? '編輯採收申請' : '新採收申請（土肉桂葉片）', f);
}

async function submitPermit(project, p) {
  if (!confirm(
    `確定送出此申請給林業保育署臺中分署審核？\n\n` +
    `申請人：${p.applicantName}\n林地：${p.landParcel}\n預計採收：${p.estAmount_kg} kg\n\n` +
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

async function deletePermit(project, p) {
  if (!confirm('確定刪除此草稿？此操作無法復原。')) return;
  try {
    await deleteDoc(doc(db, 'projects', project.id, 'harvestPermits', p.id));
    toast('已刪除草稿');
    renderHarvestApply(project);
  } catch (e) {
    toast('刪除失敗：' + e.message);
  }
}

// ===== 分署端：採收審核 =====
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

// ===== 林業合作社：唯讀彙整（掌握申請資訊 + 共同銷售收穫彙整）=====
// 唯讀：rules 天然鎖死（coop 非 canCollect / 非 harvest_authority / 非 owner）→ 此頁不放任何寫入。
// 僅顯示已送出（含）起的案件（排除林農私人草稿）。收穫累計直接讀 permit.totalLogged_kg（P2 已 denormalized）。
// v2.11.39 (G3)：彙整改以「申請當時量 vs 事後實際回報量 + 達成率」為主軸（取代舊 Pipeline 估算）。

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
    box.innerHTML = '<div class="text-sm text-stone-500 p-4">目前沒有已送出的採收申請。</div>';
    return;
  }

  // 總覽統計
  const statusCount = {};
  list.forEach(p => { statusCount[p.status] = (statusCount[p.status] || 0) + 1; });
  const approvedish = list.filter(p => ['approved', 'harvesting', 'completed'].includes(p.status));
  const realizedKg = list.reduce((s, p) => s + (p.totalLogged_kg || 0), 0);
  // v2.11.39 (G3)：申請當時的量（預計鮮葉量）vs 事後實際回報量，並列供合作社判斷達成率
  const requestedKg = list.reduce((s, p) => s + (p.estAmount_kg || 0), 0);

  // 依林農彙整
  const byFarmer = {};
  list.forEach(p => {
    const k = p.applicantName || '（未填申請人）';
    const f = byFarmer[k] || (byFarmer[k] = { name: k, cases: 0, requested: 0, realized: 0, uses: {} });
    f.cases++;
    f.requested += (p.estAmount_kg || 0);
    f.realized += (p.totalLogged_kg || 0);
    const u = p.uses || '其他';
    f.uses[u] = (f.uses[u] || 0) + (p.totalLogged_kg || 0);
  });
  const pctStr = (num, den) => den > 0 ? `${(num / den * 100).toFixed(0)}%` : '—';
  const farmers = Object.values(byFarmer).sort((a, b) => b.realized - a.realized);

  box.innerHTML = '';

  // 1) 專區總覽
  box.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' },
    el('h3', { class: 'font-semibold mb-2' }, '📋 專區總覽'),
    el('div', { class: 'text-sm space-y-1' },
      el('div', {}, `申請案（已送出起）：${list.length} 件　已核准/採收中/結案：${approvedish.length} 件`),
      el('div', {}, '狀態分布：' + Object.entries(statusCount)
        .map(([s, n]) => `${(HP_STATUS[s] || { label: s }).label} ${n}`).join('　') ),
      el('div', { class: 'text-stone-600' },
        `申請總量（申請當時預計）：${requestedKg.toFixed(1)} kg`),
      el('div', { class: 'text-emerald-700 font-medium' },
        `已回報採收量（事後實際累計）：${realizedKg.toFixed(1)} kg　達成率 ${pctStr(realizedKg, requestedKg)}`)
    )
  ));

  // 2) 依林農收穫彙整（共同銷售）
  const tbl = el('table', { class: 'w-full text-xs border-collapse' },
    el('thead', {}, el('tr', { class: 'bg-stone-100' },
      ...['林農', '案件數', '申請量(kg)', '已回報(kg)', '達成率', '用途分布(kg)'].map(h =>
        el('th', { class: 'border px-2 py-1 text-left' }, h)))),
    el('tbody', {}, ...farmers.map(f => el('tr', {},
      el('td', { class: 'border px-2 py-1' }, f.name),
      el('td', { class: 'border px-2 py-1' }, String(f.cases)),
      el('td', { class: 'border px-2 py-1 text-stone-600' }, f.requested.toFixed(1)),
      el('td', { class: 'border px-2 py-1 font-medium text-emerald-700' }, f.realized.toFixed(1)),
      el('td', { class: 'border px-2 py-1' }, pctStr(f.realized, f.requested)),
      el('td', { class: 'border px-2 py-1' },
        Object.entries(f.uses).map(([u, kg]) => `${u} ${kg.toFixed(1)}`).join('；') || '—')
    )))
  );
  box.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-4 mb-3' },
    el('h3', { class: 'font-semibold mb-2' }, '🤝 依林農收穫彙整（共同銷售）'),
    el('div', { class: 'overflow-x-auto' }, tbl),
    el('div', { class: 'text-xs text-stone-500 mt-2' },
      '「申請量」＝申請當時預計鮮葉量；「已回報」＝核准後實際採收回報累計（採收中/已結案），即可投入共同銷售之數量；達成率＝已回報 ÷ 申請量。')
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
            `林地 ${p.landParcel || '—'}　申請 ${fmtNum(p.estAmount_kg)} kg　已回報 ${fmtNum(p.totalLogged_kg)} kg　用途 ${p.uses || '—'}`)
        ),
        canView
          ? el('button', {
              class: 'text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded',
              onClick: () => openPermitDetail(project, p)
            }, '📄 採收許可單')
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
  const title = { approve: '核准採收申請', revision: '要求補件', reject: '駁回採收申請' }[action];
  const body = el('div', { class: 'space-y-2' });
  body.appendChild(el('div', { class: 'text-sm text-stone-600' },
    `申請人：${p.applicantName}　林地：${p.landParcel}　申請量：${fmtNum(p.estAmount_kg)} kg`));

  let approvedInput, fromInput, untilInput;
  if (isApprove) {
    approvedInput = el('input', { type: 'number', step: '0.1', min: 0, value: p.estAmount_kg ?? '', class: 'w-full border rounded px-2 py-1 text-sm' });
    fromInput = el('input', { type: 'date', value: p.periodFrom || '', class: 'w-full border rounded px-2 py-1 text-sm' });
    untilInput = el('input', { type: 'date', value: p.periodTo || '', class: 'w-full border rounded px-2 py-1 text-sm' });
    body.appendChild(el('div', {}, el('label', { class: 'block text-sm font-medium mb-0.5' }, '核准採收量 (kg)'), approvedInput));
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
        const amt = parseFloat(approvedInput.value);
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
            approvedAmount_kg: isNaN(amt) ? (p.estAmount_kg ?? null) : amt,
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

// ===== 收穫量登錄（林農端，許可單 approved/harvesting 時）=====
export function openHarvestLogForm(project, permit) {
  bindFb();
  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'text-sm text-stone-600' },
      `許可文號 ${permit.permitNo || '—'}　核准量 ${fmtNum(permit.approvedAmount_kg)} kg　已回報 ${fmtNum(permit.totalLogged_kg)} kg`),
    fld('採收日期', 'logDate', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
    fld('實際鮮葉重 (kg)', 'amount_kg_fresh', { type: 'number', step: '0.1', min: 0, required: true }),
    fld('乾燥後重 (kg)', 'amount_kg_dry', { type: 'number', step: '0.1', min: 0 }),
    fld('含水率 (%)', 'moisture_pct', { type: 'number', step: '0.1', min: 0, max: 100 }),
    fld('批次標示', 'batch', {}),
    fld('備註', 'note', { type: 'textarea' }),
    el('button', { type: 'submit', class: 'w-full bg-emerald-600 text-white px-3 py-2 rounded text-sm font-medium' }, '＋ 新增收穫紀錄')
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
      const over = permit.approvedAmount_kg != null && total > permit.approvedAmount_kg;
      toast(over
        ? `⚠ 已回報，累計 ${total} kg 已超過核准量 ${permit.approvedAmount_kg} kg`
        : `✅ 已回報，累計 ${total} kg`, 4000);
      renderHarvestReport(project);
    } catch (err) {
      console.error('log save 失敗', err);
      toast('登錄失敗：' + err.message);
    }
  });
  openModal('登錄收穫量（土肉桂鮮葉）', f);
}

// ===== 回報完畢並結案（harvesting → completed）=====
// v2.11.39 (G1/G2)：結案＝「回報完畢」明確閘門。
//   - G1 客戶端硬擋：totalLogged_kg 為空/≤0（從未回報）→ 擋下，要求先填報；
//     伺服器 firestore.rules clause C 同步擋（治本，不靠 UI）。
//   - G2：確認框明列累計回報 vs 核准量，講清楚「結案＝採收量已全數回報、不再新增」。
async function closePermit(project, permit) {
  const logged = permit.totalLogged_kg;
  if (logged == null || logged <= 0) {
    toast('尚未回報任何採收量 — 請先「＋ 填報採收量」，回報完畢後才能結案', 4000);
    return;
  }
  const over = permit.approvedAmount_kg != null && logged > permit.approvedAmount_kg;
  if (!confirm(
    `確定「回報完畢並結案」此採收許可？\n\n` +
    `許可文號：${permit.permitNo || '—'}\n` +
    `累計回報採收量：${fmtNum(logged)} kg ／ 核准 ${fmtNum(permit.approvedAmount_kg)} kg` +
    (over ? '（⚠ 已超過核准量）' : '') + `\n\n` +
    `結案代表本案實際採收量已全數回報完畢、不再新增。\n` +
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

// ===== 採收許可單／收穫總結（雙方檢視 + 列印）=====
async function openPermitDetail(project, permit) {
  const body = el('div', { class: 'space-y-3' });
  body.appendChild(el('div', { class: 'text-sm space-y-0.5' },
    el('div', {}, el('b', {}, '採收許可單（土肉桂葉片）')),
    el('div', {}, `許可文號：${permit.permitNo || '（未生成）'}`),
    el('div', {}, `申請人：${permit.applicantName || '—'}　聯絡：${permit.contact || '—'}`),
    el('div', {}, `林地：${permit.landParcel || '—'}（${fmtNum(permit.forestArea_ha)} ha）`),
    el('div', {}, `採收方式：${permit.harvestMethod || '—'}　用途：${permit.uses || '—'}`),
    el('div', {}, `核准採收量：${fmtNum(permit.approvedAmount_kg)} kg`),
    el('div', {}, `效期：${permit.validFrom || '—'} ~ ${permit.validUntil || '—'}`),
    permit.reviewComment ? el('div', {}, `審核附註：${permit.reviewComment}`) : null
  ));
  const logsBox = el('div', { class: 'text-sm text-stone-500' }, '載入收穫紀錄…');
  body.appendChild(logsBox);
  const printBtn = el('button', { class: 'w-full bg-stone-700 text-white px-3 py-2 rounded text-sm' }, '🖨️ 列印採收許可單');
  body.appendChild(printBtn);
  openModal('採收許可單／收穫總結', body);

  let logs = [];
  try { logs = await loadLogs(project.id, permit.id); } catch {}
  const total = logs.reduce((s, l) => s + (l.amount_kg_fresh || 0), 0);
  const approved = permit.approvedAmount_kg;
  const over = approved != null && total > approved;

  logsBox.className = 'text-sm';
  logsBox.innerHTML = '';
  logsBox.appendChild(el('div', { class: 'font-medium mb-1' }, `收穫紀錄（共 ${logs.length} 筆）`));
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
      : [el('tr', {}, el('td', { class: 'border px-1 py-2 text-center text-stone-400', colspan: '5' }, '尚無收穫紀錄'))]))
  ));
  logsBox.appendChild(el('div', { class: `mt-1 ${over ? 'text-red-700 font-semibold' : 'text-stone-700'}` },
    `累計鮮葉 ${total.toFixed(1)} kg ／ 核准 ${fmtNum(approved)} kg` + (over ? '　⚠ 已超過核准量' : '')));

  printBtn.addEventListener('click', () => printPermit(permit, logs, total));
}

function printPermit(permit, logs, total) {
  const roc = new Date().getFullYear() - 1911;
  const esc = s => String(s ?? '—').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const rowsHtml = logs.length
    ? logs.map(l => `<tr><td>${esc(l.logDate)}</td><td style="text-align:right">${esc(l.amount_kg_fresh)}</td><td style="text-align:right">${esc(l.amount_kg_dry)}</td><td style="text-align:right">${esc(l.moisture_pct)}</td><td>${esc(l.batch)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#999">尚無收穫紀錄</td></tr>';
  const over = permit.approvedAmount_kg != null && total > permit.approvedAmount_kg;
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>採收許可單 ${esc(permit.permitNo)}</title>
<style>body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;margin:32px;color:#222;font-size:13px}
h1{text-align:center;font-size:20px;margin:0 0 4px}.sub{text-align:center;color:#666;margin-bottom:18px}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #888;padding:4px 8px}
th{background:#eee}.kv{margin:3px 0}.box{border:1px solid #888;padding:14px 18px;margin-bottom:16px}
.total{margin-top:10px;font-weight:bold}.over{color:#c00}
.sign{margin-top:40px;display:flex;justify-content:space-between}</style>
</head><body>
<h1>林產物採取許可單（土肉桂葉片）</h1>
<div class="sub">林業及自然保育署臺中分署　中華民國 ${roc} 年</div>
<div class="box">
<div class="kv"><b>許可文號：</b>${esc(permit.permitNo)}</div>
<div class="kv"><b>申請人：</b>${esc(permit.applicantName)}　<b>聯絡方式：</b>${esc(permit.contact)}</div>
<div class="kv"><b>林地（林班/地號）：</b>${esc(permit.landParcel)}　<b>面積：</b>${esc(permit.forestArea_ha)} ha</div>
<div class="kv"><b>採收方式：</b>${esc(permit.harvestMethod)}　<b>用途：</b>${esc(permit.uses)}</div>
<div class="kv"><b>核准採收量：</b>${esc(permit.approvedAmount_kg)} kg　<b>效期：</b>${esc(permit.validFrom)} ~ ${esc(permit.validUntil)}</div>
${permit.reviewComment ? `<div class="kv"><b>審核附註：</b>${esc(permit.reviewComment)}</div>` : ''}
</div>
<b>收穫量登錄紀錄</b>
<table><thead><tr><th>採收日</th><th>鮮重(kg)</th><th>乾重(kg)</th><th>含水率%</th><th>批次</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class="total ${over ? 'over' : ''}">累計鮮葉採收量：${total.toFixed(1)} kg ／ 核准量：${esc(permit.approvedAmount_kg)} kg${over ? '　⚠ 已超過核准量' : ''}</div>
<div class="sign"><div>申請人簽章：________________</div><div>分署核章：________________</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器封鎖彈出視窗，請允許後重試'); return; }
  w.document.write(html);
  w.document.close();
}

// ===== 申請公文「函」稿（林農端，紙本正式發文用；與線上記錄同一資料來源）=====
function printApplicationLetter(permit) {
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
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>土肉桂葉片採取申請函 ${v(permit.applicantName)}</title>
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
@media print{body{margin:2cm}}
</style></head><body>
<div class="title">土肉桂葉片採取申請函</div>
<div class="row"><span class="lbl">受文者：</span>林業及自然保育署臺中分署</div>
<div class="row"><span class="lbl">發文日期：</span>${rocFull(today)}</div>
<div class="row"><span class="lbl">發文字號：</span><span class="line">&nbsp;</span>（申請人自編／免填）</div>
<div class="row"><span class="lbl">速別：</span>普通件　　<span class="lbl">密等：</span>普通</div>
<div class="row"><span class="lbl">附件：</span>地籍圖、現場照片等（如附）</div>
<div class="subject"><b>主　旨：</b>申請於下列林地採取土肉桂葉片乙案，請　核准。</div>
<div><b>說　明：</b></div>
<ol>
<li>申請人：${v(permit.applicantName)}（聯絡方式：${v(permit.contact)}）。</li>
<li>林地坐落及權屬：${v(permit.landParcel)}，面積 ${v(permit.forestArea_ha)} 公頃。</li>
<li>採取標的：土肉桂葉片；採取方式：${v(permit.harvestMethod) || '修枝採葉'}；估計母樹 ${v(permit.estTrees)} 株。</li>
<li>預計採取數量：鮮葉 ${v(permit.estAmount_kg)} 公斤。</li>
<li>採取期間：自民國 ${rocYmd(permit.periodFrom)} 起至 ${rocYmd(permit.periodTo)} 止。</li>
<li>用途：${v(permit.uses)}。</li>
<li>本案已於 ForestMRV 線上系統登錄${permit.status === 'submitted' || permit.status === 'under_review' || permit.status === 'approved' || permit.status === 'harvesting' || permit.status === 'completed' ? '並送出' : '（草稿）'}，本函為紙本正式送件文件，內容與線上記錄一致。</li>
<li>檢附相關文件如附件，請　查照核辦。</li>
</ol>
<table class="tbl">
<tr><th>申請人</th><td>${v(permit.applicantName)}</td><th>聯絡方式</th><td>${v(permit.contact)}</td></tr>
<tr><th>林班／地號</th><td colspan="3">${v(permit.landParcel)}</td></tr>
<tr><th>採收面積</th><td>${v(permit.forestArea_ha)} ha</td><th>估計株數</th><td>${v(permit.estTrees)}</td></tr>
<tr><th>採收方式</th><td>${v(permit.harvestMethod) || '修枝採葉'}</td><th>預計鮮葉量</th><td>${v(permit.estAmount_kg)} kg</td></tr>
<tr><th>採收期間</th><td colspan="3">${permit.periodFrom ? esc(permit.periodFrom) : '—'} ~ ${permit.periodTo ? esc(permit.periodTo) : '—'}</td></tr>
<tr><th>用途</th><td colspan="3">${v(permit.uses)}</td></tr>
<tr><th>備註</th><td colspan="3">${v(permit.note)}</td></tr>
</table>
<div class="sign">申請人：________________（簽章）<br>身分證／統一編號：________________<br>申請日期：${rocFull(today)}</div>
<div class="recv">
<div class="h">（以下由林業及自然保育署臺中分署收件填用）</div>
收文日期：____________　收文文號：____________　承辦人：____________
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器封鎖彈出視窗，請允許後重試'); return; }
  w.document.write(html);
  w.document.close();
}
