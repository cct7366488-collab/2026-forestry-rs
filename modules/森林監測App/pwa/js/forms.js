// ===== forms.js — v1.5 表單：專案 / 樣區 / 立木 / 更新 / 方法學 / QA / Seed =====
// v2.0：加 understory（地被植物）+ soilCons（水土保持）兩模組

import { fb, $, $$, el, toast, openModal, closeModal, state, calcTreeMetrics, speciesParamsLabel, wgs84ToTwd97, twd97ToWgs84, DEFAULT_METHODOLOGY, isPi, isDataManager, isSurveyor, canQA, isLocked, rerouteCurrentView, captureCurrentSubtab, qaBadge } from './app.js';
import { TYPE_CODES, AGENCY_CODES, agenciesByGroup, nextSequence, buildProjectCode } from './code-tables.js?v=2000';
// v2.0：物種字典從 species-dict.js 載入（樹種 / 動物 / 草本 / 入侵種）
import { TREES, ANIMALS, HERBS, INVASIVE_PLANTS, isInvasive, findHerb, findAnimal } from './species-dict.js?v=2000';
// v2.3：階段 2 狀態機（自動偵測送審）
import { STATUS, applyStatusAfterQA, applyStatusAfterSurveyorReset, applyStatusAfterMethodologySaved } from './project-status.js?v=2710';

// 兼容舊 SPECIES 命名（forms.js 內部仍引用）
const SPECIES = TREES;

// （v2.0：原本內聯的 ~100 種樹種陣列已移到 species-dict.js TREES，本檔透過上面的 SPECIES = TREES 別名引用）
const PEST_OPTIONS = ['葉斑', '潰瘍', '蟲孔', '空洞', '菌害', '枯梢', '無'];

// ===== v2.3.6：共用 GPS button helper =====
// plot 表單與 wildlife 表單共用，避免 drift；行為 100% 一致
// 用法：const { gpsBtn, gpsStatus, lngInput, latInput, accInput } = createGpsButton({...});
function createGpsButton({
  initialLat = null,        // 已存的緯度（編輯既有資料用）
  initialLng = null,        // 已存的經度
  initialAccuracy = null,   // 已存的精度（plot 表單用）
  showTwd97 = false,        // true: 顯示 TWD97 座標（plot 表單用）
  showInitialAsExisting = false, // true: 初始顯示「已存：lat, lng」（wildlife 用）
  plotForDistance = null    // 若提供，定位後顯示與 plot 中心距離（wildlife 用）
} = {}) {
  // 三個 hidden input（lng/lat 必有，accuracy 視 showTwd97 決定）
  const lngInput = el('input', { type: 'hidden', name: 'lng', value: initialLng ?? '' });
  const latInput = el('input', { type: 'hidden', name: 'lat', value: initialLat ?? '' });
  const accInput = showTwd97
    ? el('input', { type: 'hidden', name: 'accuracy', value: initialAccuracy ?? '' })
    : null;

  // 初始狀態文字
  let initText = '尚未定位';
  if (initialLat != null && initialLng != null) {
    if (showInitialAsExisting) {
      initText = `已存：${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    } else if (showTwd97) {
      initText = `WGS84: ${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    } else {
      initText = `${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    }
  }
  const gpsStatus = el('span', { class: 'text-xs text-stone-600 ml-2' }, initText);

  // 先創建 button（給 click handler 引用）
  const gpsBtn = el('button', { type: 'button', class: 'gps-btn' }, '📍 抓取 GPS');

  gpsBtn.addEventListener('click', () => {
    console.log('[createGpsButton] click triggered');
    if (!navigator.geolocation) { toast('此裝置不支援 GPS'); return; }
    gpsBtn.disabled = true;
    gpsBtn.textContent = '⏳ 定位中...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          const { longitude, latitude, accuracy } = pos.coords;
          lngInput.value = longitude;
          latInput.value = latitude;
          if (accInput) accInput.value = accuracy;

          // 距 plot 中心訊息（wildlife 用）
          let extraMsg = '';
          if (plotForDistance) {
            const plotLoc = plotForDistance.location;
            const plotLat = plotLoc?.latitude ?? plotLoc?._lat ?? null;
            const plotLng = plotLoc?.longitude ?? plotLoc?._long ?? null;
            if (plotLat != null && plotLng != null) {
              const d = haversine(latitude, longitude, plotLat, plotLng);
              extraMsg = `<br>距 plot 中心 ${Math.round(d)} m${d > 100 ? ' ⚠ 超過 100 m 邊界' : ''}`;
            }
          }

          // TWD97 顯示（plot 用）
          if (showTwd97) {
            const t = wgs84ToTwd97(longitude, latitude);
            gpsStatus.innerHTML = `WGS84: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}<br>TWD97: (${t.x}, ${t.y}) ｜ ±${Math.round(accuracy)}m${extraMsg}`;
          } else {
            gpsStatus.innerHTML = `${latitude.toFixed(6)}, ${longitude.toFixed(6)} ±${Math.round(accuracy)}m${extraMsg}`;
          }
        } catch (e) {
          console.error('[createGpsButton] success callback error', e);
          toast('GPS 處理錯誤：' + e.message);
        } finally {
          gpsBtn.disabled = false;
          gpsBtn.textContent = '📍 重新定位';
        }
      },
      (err) => {
        console.warn('[createGpsButton] error', err);
        toast('GPS 失敗：' + (err.message || '權限被拒或超時'));
        gpsBtn.disabled = false;
        gpsBtn.textContent = '📍 抓取 GPS';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  return { gpsBtn, gpsStatus, lngInput, latInput, accInput };
}

// ===== 共用：欄位工廠 =====
function field({ label, name, type = 'text', required = false, value = '', placeholder = '', options = null, step, min, max, rows }) {
  const id = `f-${name}`;
  const lab = el('label', { for: id }, label, required ? el('span', { class: 'req' }, ' *') : null);
  let input;
  if (options) {
    input = el('select', { id, name, ...(required ? { required: 'true' } : {}) },
      ...options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const t = typeof o === 'string' ? o : o.label;
        const opt = el('option', { value: v }, t);
        if (String(v) === String(value)) opt.setAttribute('selected', 'true');
        return opt;
      })
    );
  } else if (type === 'textarea') {
    input = el('textarea', { id, name, rows: rows || 3, placeholder }, value);
  } else {
    const attrs = { id, name, type, value: value ?? '', placeholder };
    if (required) attrs.required = 'true';
    if (step != null) attrs.step = step;
    if (min != null) attrs.min = min;
    if (max != null) attrs.max = max;
    input = el('input', attrs);
  }
  return el('div', { class: 'field' }, lab, input);
}

// ===== 照片上傳元件（v1.6） =====
// 用法：const up = photoUploader({ existing: doc.photos || [], required, onChange });
//      表單中放 up.element；submit 時呼叫 await up.commit({ projectId, plotId, prefix }) 拿到新 photos 陣列
// 行為：
//   - 顯示既有照片 thumbnail（不可被 surveyor 編輯時）+ 刪除 X 按鈕
//   - 新增按鈕：accept=image/*，capture=environment（手機開後鏡頭）
//   - 新加的檔案先做本地 preview（FileReader）；submit 才真正上傳到 Storage
//   - commit() 回傳合併後的 photos 陣列：[...remainingExisting, ...newlyUploaded]
function photoUploader({ existing = [], onChange = null } = {}) {
  let kept = [...existing];          // 保留的既有照片（user 沒按刪除的）
  let pending = [];                  // 待上傳的新檔案 [{ file, previewUrl, tempId }]

  const wrap = el('div', { class: 'photo-uploader space-y-2' });
  const grid = el('div', { class: 'flex flex-wrap gap-2' });
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment',
    multiple: 'true', class: 'hidden'
  });
  const addBtn = el('button', {
    type: 'button',
    class: 'border-2 border-dashed border-stone-300 rounded w-20 h-20 flex items-center justify-center text-stone-400 hover:bg-stone-50',
    onclick: () => fileInput.click()
  }, '＋');

  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      if (!file.type.startsWith('image/')) { toast(`忽略非圖片：${file.name}`); continue; }
      if (file.size > 5 * 1024 * 1024) { toast(`檔案過大（>5MB）：${file.name}`); continue; }
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      pending.push({ file, previewUrl, tempId });
    }
    fileInput.value = '';
    redraw();
    onChange?.();
  });

  function redraw() {
    grid.innerHTML = '';
    kept.forEach((p, i) => {
      const item = el('div', { class: 'relative w-20 h-20' },
        el('img', { src: p.url, class: 'w-20 h-20 object-cover rounded border' }),
        el('button', {
          type: 'button',
          class: 'absolute -top-1 -right-1 bg-red-600 text-white text-xs w-5 h-5 rounded-full',
          title: '移除',
          onclick: () => { kept.splice(i, 1); redraw(); onChange?.(); }
        }, '✕')
      );
      grid.appendChild(item);
    });
    pending.forEach((p) => {
      const item = el('div', { class: 'relative w-20 h-20' },
        el('img', { src: p.previewUrl, class: 'w-20 h-20 object-cover rounded border opacity-70' }),
        el('span', { class: 'absolute bottom-0 left-0 right-0 text-center text-[10px] bg-amber-500 text-white' }, '待上傳'),
        el('button', {
          type: 'button',
          class: 'absolute -top-1 -right-1 bg-stone-600 text-white text-xs w-5 h-5 rounded-full',
          title: '取消',
          onclick: () => {
            URL.revokeObjectURL(p.previewUrl);
            pending = pending.filter(x => x.tempId !== p.tempId);
            redraw(); onChange?.();
          }
        }, '✕')
      );
      grid.appendChild(item);
    });
    grid.appendChild(addBtn);
  }
  redraw();

  wrap.appendChild(grid);
  wrap.appendChild(fileInput);

  return {
    element: wrap,
    get count() { return kept.length + pending.length; },
    // 上傳 + 回傳合併陣列。upload 失敗的檔案會 throw，由 caller 處理
    async commit({ projectId, plotId, prefix = 'plot' }) {
      const uploaded = [];
      for (const p of pending) {
        const ext = (p.file.name.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `projects/${projectId}/plots/${plotId}/${prefix}-${ts}-${rand}${ext}`;
        const r = fb.storageRef(fb.storage, path);
        await fb.uploadBytes(r, p.file, { contentType: p.file.type });
        const url = await fb.getDownloadURL(r);
        uploaded.push({
          url, path,
          name: p.file.name,
          size: p.file.size,
          contentType: p.file.type,
          uploadedAt: new Date(),
          uploadedBy: state.user.uid
        });
        URL.revokeObjectURL(p.previewUrl);
      }
      // 計算被移除的既有照片（既有 - 保留）→ 從 Storage 刪
      const removedExisting = existing.filter(e => !kept.some(k => k.path === e.path));
      for (const r of removedExisting) {
        if (!r.path) continue;
        try { await fb.deleteObject(fb.storageRef(fb.storage, r.path)); }
        catch (e) { console.warn('刪除舊照片失敗（可能已不存在）:', r.path, e.code); }
      }
      pending = [];
      return [...kept, ...uploaded];
    }
  };
}

// ===== v1.6.11：plot detail 頁的「📷 加照片」獨立按鈕（不必進編輯表單，現場拍立傳）=====
// 限：plot 建立者本人 OR PI/dataManager；且專案未 Lock（client 端先擋，Rules 會再驗）
// 行為：直接觸發系統相機/相簿 → 上傳 → updateDoc plot.photos → location.reload() 重繪
export async function quickAddPhoto(project, plot) {
  if (!plot || !plot.id) { toast('找不到樣區資訊'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.multiple = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);

  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    cleanup();
    if (!files.length) return;

    const valid = files.filter(f => {
      if (!f.type.startsWith('image/')) { toast(`忽略非圖片：${f.name}`); return false; }
      if (f.size > 5 * 1024 * 1024) { toast(`過大（>5MB）：${f.name}`); return false; }
      return true;
    });
    if (!valid.length) return;

    toast(`上傳中（${valid.length} 張）...`, 8000);
    try {
      const newPhotos = [];
      for (const file of valid) {
        const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `projects/${project.id}/plots/${plot.id}/plot-${ts}-${rand}${ext}`;
        const r = fb.storageRef(fb.storage, path);
        await fb.uploadBytes(r, file, { contentType: file.type });
        const url = await fb.getDownloadURL(r);
        newPhotos.push({
          url, path, name: file.name, size: file.size, contentType: file.type,
          uploadedAt: new Date(), uploadedBy: state.user.uid
        });
      }
      const merged = [...(plot.photos || []), ...newPhotos];
      const updates = { photos: merged, updatedAt: fb.serverTimestamp() };
      // 若 surveyor 補照片給自己被 flag/reject 的 plot → qaStatus 自動回 pending（一致 Bug #3 邏輯）
      if (plot.createdBy === state.user.uid && ['flagged', 'rejected'].includes(plot.qaStatus)) {
        updates.qaStatus = 'pending';
        updates.qaMarkedBy = null;
        updates.qaMarkedAt = null;
      }
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), updates);
      toast(`已新增 ${valid.length} 張照片` + (updates.qaStatus === 'pending' ? '（重新送審）' : ''));
      setTimeout(() => location.reload(), 800);  // 等 toast 顯示完再重整
    } catch (e) {
      console.error('quickAddPhoto failed:', e);
      toast('上傳失敗：' + e.message);
    }
  });

  input.click();
}

// ===== v1.6.19：封存 / 解封存 — 真實案件結束後使用，資料保留只是從作用中清單移除 =====
export async function archiveProject(project) {
  if (!confirm(
    `封存專案「${project.name}」（${project.code}）？\n\n` +
    `✓ 所有資料保留在 Firebase 雲端（不會刪除）\n` +
    `✓ 自動 Lock，沒人能再寫入\n` +
    `✓ 從預設「我的專案」清單移除（仍可從「顯示已封存」查看）\n\n` +
    `適用：案件結束、研究結案。仍可隨時解封存還原。`
  )) return;
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), {
      archived: true,
      locked: true,
      lockedAt: fb.serverTimestamp(),
      lockedBy: state.user.uid,
      archivedAt: fb.serverTimestamp(),
      archivedBy: state.user.uid
    });
    toast(`已封存「${project.name}」`);
  } catch (e) { toast('封存失敗：' + e.message); }
}

export async function unarchiveProject(project) {
  if (!confirm(
    `解封存「${project.name}」？\n\n` +
    `✓ 還原為作用中專案\n` +
    `✓ 自動 Unlock（PI 可重新編輯）\n\n` +
    `若要繼續封存狀態（資料不可改），請手動 Lock。`
  )) return;
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), {
      archived: false,
      locked: false,
      lockedAt: null,
      lockedBy: null
    });
    toast(`已解封存「${project.name}」`);
  } catch (e) { toast('解封存失敗：' + e.message); }
}

// ===== v1.6.19：admin 永久刪除（級聯刪除所有 plots / trees / regen + Storage 照片）=====
// 安全閘門（依序）：
//   (1) 必須先「封存」此專案（archived=true）才允許永久刪除 — 強制至少二步驟思考
//   (2) 客製 modal 必須勾選「我已匯出資料備份」 — 提醒先匯出 XLSX/CSV
//   (3) 必須輸入專案代碼確認 — 防誤刪
// Storage Rules `allow delete`（v1.6.0 已加）；Firestore Rules `allow delete: if isSystemAdmin()`
export async function deleteProjectCascade(project) {
  if (!project.archived) {
    toast('請先「封存」此專案，封存後才能永久刪除');
    return;
  }

  // 客製確認 modal（取代 prompt + confirm）
  const confirmed = await new Promise(resolve => {
    const f = el('form', { class: 'space-y-3' },
      el('p', { class: 'text-sm font-medium' }, `永久刪除「${project.name}」（${project.code}）`),
      el('p', { class: 'text-sm text-red-700 bg-red-50 p-2 rounded' },
        '⚠️ 將連同所有樣區、立木、自然更新、上傳照片一併刪除，**無法復原**。'),
      el('label', { class: 'flex items-start gap-2 text-sm' },
        el('input', { type: 'checkbox', name: 'exported', required: 'true', class: 'mt-1' }),
        el('span', {}, '我已從「匯出」分頁下載此專案的資料備份（XLSX / CSV）')
      ),
      el('div', { class: 'field' },
        el('label', {}, `輸入專案代碼 `, el('code', { class: 'bg-stone-100 px-1' }, project.code), ` 確認：`),
        el('input', { type: 'text', name: 'code', required: 'true', autocomplete: 'off',
          class: 'border rounded px-2 py-1 w-full mt-1' })
      ),
      el('div', { class: 'flex gap-2 pt-2' },
        el('button', { type: 'submit', class: 'flex-1 bg-red-600 text-white py-2 rounded' }, '永久刪除'),
        el('button', { type: 'button', class: 'flex-1 border py-2 rounded',
          onclick: () => { closeModal(); resolve(false); } }, '取消')
      )
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      if (fd.get('code').trim() !== project.code) {
        toast('代碼不符');
        return;
      }
      closeModal();
      resolve(true);
    });
    openModal('永久刪除專案', f);
  });
  if (!confirmed) return;

  toast('刪除中...', 30000);
  try {
    const projectId = project.id;
    // (1) 列出所有 plots
    const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots'));
    let plotCount = 0, treeCount = 0, regenCount = 0, photoCount = 0;

    for (const plotDoc of plotsSnap.docs) {
      const plotId = plotDoc.id;

      // (a) 刪 trees（含 photos）
      const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots', plotId, 'trees'));
      for (const td of treesSnap.docs) {
        await fb.deleteDoc(td.ref);
        treeCount++;
      }

      // (b) 刪 regeneration
      const regenSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots', plotId, 'regeneration'));
      for (const rd of regenSnap.docs) {
        await fb.deleteDoc(rd.ref);
        regenCount++;
      }

      // (c) 刪 plot 與其下所有 Storage 照片（用 listAll 抓 prefix 一網打盡 plot + tree 照片）
      try {
        const list = await fb.listAll(fb.storageRef(fb.storage, `projects/${projectId}/plots/${plotId}`));
        for (const item of list.items) {
          try { await fb.deleteObject(item); photoCount++; }
          catch (e) { console.warn('刪照片失敗', item.fullPath, e.code); }
        }
      } catch (e) { console.warn('listAll 失敗', e); }

      // (d) 刪 plot doc
      await fb.deleteDoc(plotDoc.ref);
      plotCount++;
    }

    // (2) 刪 project doc
    await fb.deleteDoc(fb.doc(fb.db, 'projects', projectId));

    toast(`已刪除：${plotCount} 樣區 / ${treeCount} 立木 / ${regenCount} 更新 / ${photoCount} 照片`, 5000);
    setTimeout(() => { location.hash = ''; location.reload(); }, 1500);
  } catch (e) {
    console.error('deleteProjectCascade failed:', e);
    toast('刪除失敗：' + e.message);
  }
}

// ===== 專案表單 =====
// v1.5：admin 建空殼 + 指派 PI 的 email；自動填 memberUids、預設 methodology
export function openProjectForm(existing = null) {
  // v1.7.1：結構化代碼輸入 — 編輯既有專案時保留原 code（不允許改）
  const isEdit = !!existing;
  const currentYear = new Date().getFullYear();

  // 類型 select
  const typeSel = el('select', { name: 'type', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    el('option', { value: '' }, '— 選擇類型 —'),
    ...TYPE_CODES.map(t => el('option', { value: t.code }, `${t.code} — ${t.label}`))
  );
  // 單位 select（依 group 分組）
  const agencySel = el('select', { name: 'agency', required: 'true', class: 'border rounded px-2 py-1 w-full' });
  agencySel.appendChild(el('option', { value: '' }, '— 選擇單位 —'));
  const grouped = agenciesByGroup();
  for (const [grp, items] of Object.entries(grouped)) {
    const og = document.createElement('optgroup');
    og.label = grp;
    items.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.code;
      opt.textContent = `${a.code} — ${a.label}`;
      og.appendChild(opt);
    });
    agencySel.appendChild(og);
  }
  const yearInput = el('input', { type: 'number', name: 'year', min: '2020', max: '2100', value: currentYear,
    required: 'true', class: 'border rounded px-2 py-1 w-full' });
  const seqInput = el('input', { type: 'text', name: 'seq', readonly: 'true', placeholder: '自動產生',
    class: 'border rounded px-2 py-1 w-full bg-stone-50 text-stone-600' });
  const codePreview = el('div', {
    class: 'bg-blue-50 border border-blue-200 rounded p-2 text-sm font-mono text-center'
  }, '請填類型 / 單位 / 年度');

  // 自動算流水號
  let cachedProjectsSnap = null;
  async function ensureProjectsSnap() {
    if (cachedProjectsSnap) return cachedProjectsSnap;
    const s = await fb.getDocs(fb.collection(fb.db, 'projects'));
    cachedProjectsSnap = s.docs;
    return cachedProjectsSnap;
  }
  async function updateCodePreview() {
    const t = typeSel.value;
    const a = agencySel.value;
    const y = yearInput.value;
    if (!t || !a || !y) {
      codePreview.textContent = '請填類型 / 單位 / 年度';
      seqInput.value = '';
      return;
    }
    const prefix = `${t}-${a}-${y}-`;
    const docs = await ensureProjectsSnap();
    const seq = nextSequence(docs, prefix);
    seqInput.value = seq;
    codePreview.textContent = buildProjectCode(t, a, y, seq);
  }
  typeSel.addEventListener('change', updateCodePreview);
  agencySel.addEventListener('change', updateCodePreview);
  yearInput.addEventListener('change', updateCodePreview);

  const f = el('form', { class: 'space-y-2' },
    isEdit
      ? el('div', { class: 'field' },
          el('label', {}, '案件代碼'),
          el('div', { class: 'bg-stone-100 px-2 py-1 rounded text-sm font-mono' }, existing.code),
          el('p', { class: 'text-xs text-stone-500 mt-1' }, '代碼建立後不可改')
        )
      : el('div', { class: 'space-y-2' },
          el('div', { class: 'field' }, el('label', {}, '計畫類型 ', el('span', { class: 'req' }, '*')), typeSel),
          el('div', { class: 'field' }, el('label', {}, '委託 / 執行單位 ', el('span', { class: 'req' }, '*')), agencySel),
          el('div', { class: 'field-row' },
            el('div', { class: 'field' }, el('label', {}, '年度 ', el('span', { class: 'req' }, '*')), yearInput),
            el('div', { class: 'field' }, el('label', {}, '流水號（自動）'), seqInput)
          ),
          el('div', { class: 'field' },
            el('label', {}, '專案代碼 預覽'),
            codePreview,
            el('p', { class: 'text-xs text-stone-500 mt-1' }, '系統自動依 (類型,單位,年度) 找未用過的最小編號')
          )
        ),
    field({ label: '專案名稱', name: 'name', required: true, value: existing?.name || '', placeholder: '示範林班' }),
    field({ label: '描述', name: 'description', type: 'textarea', value: existing?.description || '' }),
    // v1.7.0：支援多 PI（comma 或換行分隔多個 email）
    isEdit
      ? null
      : field({ label: 'PI（計畫主持人）email — 多人請用「,」或換行分隔', name: 'piEmail', type: 'textarea', rows: 2, required: true,
          value: state.user.email,
          placeholder: 'professor1@example.com, professor2@example.com' }),
    isEdit
      ? null
      : el('p', { class: 'text-xs text-stone-500' }, '⚠️ 每個 PI 必須先用該 email 登入過一次本系統。建好專案後，PI 可在「設計」分頁設定方法學、在「設定」分頁邀請更多成員。'),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);

    if (isEdit) {
      // 編輯：只更新 name / description
      try {
        await fb.updateDoc(fb.doc(fb.db, 'projects', existing.id), {
          name: fd.get('name').trim(),
          description: fd.get('description').trim() || ''
        });
        toast('已更新');
        closeModal();
      } catch (e) { toast('更新失敗：' + e.message); }
      return;
    }

    // 新建專案：v1.7.1 結構化代碼
    const t = fd.get('type'), a = fd.get('agency'), y = fd.get('year'), seq = fd.get('seq');
    if (!t || !a || !y || !seq) { toast('請完整選擇類型 / 單位 / 年度'); return; }
    const code = buildProjectCode(t, a, y, seq);
    // 重新驗證流水號（避免 race：他人剛建同 prefix）
    const docs = await ensureProjectsSnap();
    if (docs.some(d => d.data().code === code)) {
      toast(`代碼 ${code} 已被使用，請重新打開表單以取得新流水號`);
      return;
    }

    const piEmails = fd.get('piEmail').split(/[,;\n\s]+/).map(s => s.trim()).filter(Boolean);
    if (piEmails.length === 0) { toast('至少需要 1 位 PI'); return; }
    const piUids = [];
    for (const email of piEmails) {
      const usnap = await fb.getDocs(fb.query(fb.collection(fb.db, 'users'), fb.where('email', '==', email)));
      if (usnap.empty) { toast(`找不到 email = ${email} 的使用者，請對方先登入過一次系統`); return; }
      piUids.push(usnap.docs[0].id);
    }
    const members = {};
    piUids.forEach(uid => { members[uid] = 'pi'; });
    const data = {
      code,
      codeMeta: { type: t, agency: a, year: parseInt(y, 10), seq },  // v1.7.1：結構化資訊備查
      name: fd.get('name').trim(),
      description: fd.get('description').trim() || '',
      coordinateSystem: 'TWD97_TM2',
      pi: piUids[0],
      pis: piUids,
      members,
      memberUids: piUids,
      methodology: { ...DEFAULT_METHODOLOGY },
      locked: false,
      // v2.3：階段 2 狀態機初始狀態
      status: STATUS.CREATED,
      statusChangedAt: fb.serverTimestamp(),
      statusChangedBy: state.user.uid,
      autoLockReason: null,
      migratedV2_3: true,
      // 階段 3 預留欄位
      reviews: [],
      verifiedBy: null,
      verifiedAt: null,
      createdBy: state.user.uid,
      createdAt: fb.serverTimestamp()
    };
    try {
      const ref = await fb.addDoc(fb.collection(fb.db, 'projects'), data);
      toast(`已建立 ${code}（${piUids.length} 位 PI）`);
      closeModal();
      location.hash = `#/p/${ref.id}`;
    } catch (e) { toast('建立失敗：' + e.message); }
  });
  openModal(existing ? '編輯專案' : '新專案', f);
}

// ===== 方法學編輯器（PI 主場）=====
export function openMethodologyForm(project) {
  const m = project.methodology || { ...DEFAULT_METHODOLOGY };
  const f = el('form', { class: 'space-y-2' },
    field({ label: '目標樣區數', name: 'targetPlotCount', type: 'number', step: '1', min: '1', required: true, value: m.targetPlotCount }),
    field({ label: '樣區形狀', name: 'plotShape', required: true,
      options: [{ value: 'circle', label: '圓形' }, { value: 'square', label: '方形' }],
      value: m.plotShape }),
    field({ label: '允許的樣區面積（m²，逗號分隔）', name: 'plotAreaOptions', required: true,
      value: (m.plotAreaOptions || []).join(','), placeholder: '400, 500, 1000' }),
    // v2.5：plotOriginType — 立木 X/Y 座標系統的原點位置
    el('div', { class: 'field', style: 'background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:10px' },
      el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:6px' },
        '樣區原點位置（v2.5）'),
      ...[
        { v: 'center', label: '中心點原點', desc: 'plot.GPS = 樣區中心；皮尺距中心可正可負（林保署永久樣區常用）' },
        { v: 'corner', label: '左下角原點', desc: 'plot.GPS = 樣區左下角；皮尺從左下往右北恆為正' }
      ].map(({ v, label, desc }) => el('label', {
        style: 'display:block;font-size:13px;line-height:1.5;cursor:pointer;padding:4px 0'
      },
        el('input', {
          type: 'radio', name: 'plotOriginType', value: v,
          style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
          ...((m.plotOriginType || 'center') === v ? { checked: 'true' } : {})
        }),
        el('b', {}, label),
        el('div', { style: 'font-size:11px;color:#57534e;margin-left:20px' }, desc)
      )),
      el('p', { style: 'font-size:11px;color:#1e40af;margin-top:6px' },
        '💡 設定後，立木表單會出現 X / Y 座標欄位，自動換算每株絕對 TWD97 + WGS84 座標。')
    ),
    el('div', { class: 'field' },
      el('label', {}, '強制必填欄位（立木調查）'),
      el('div', { style: 'display:block' },
        ...['photos', 'branchHeight', 'pestSymptoms'].map(k => el('label', {
          style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
        },
          el('input', {
            type: 'checkbox', name: `req_${k}`,
            style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
            ...(m.required?.[k] ? { checked: 'true' } : {})
          }),
          { photos: '照片', branchHeight: '枝下高', pestSymptoms: '病蟲害' }[k]
        ))
      )
    ),
    // v2.0：模組勾選改 inline style 寫死（避開 Tailwind CDN + 動態 DOM 在窄 modal 直書 bug）
    el('div', { class: 'field' },
      el('label', {}, '啟用模組（v1 既有）'),
      el('div', { style: 'display:block' },
        ...['plot', 'tree', 'regeneration'].map(k => el('label', {
          style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
        },
          el('input', {
            type: 'checkbox', name: `mod_${k}`,
            style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
            ...(m.modules?.[k] !== false ? { checked: 'true' } : {})
          }),
          { plot: '永久樣區', tree: '立木', regeneration: '自然更新' }[k]
        ))
      )
    ),
    // v2.0：新增監測模組勾選 + 各自必填
    el('div', { class: 'field', style: 'background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.0 新增監測模組'),
      // 主模組勾選（每個一行）
      ...[
        { k: 'understory', label: '🌿 地被植物' },
        { k: 'soilCons', label: '⛰️ 水土保持' }
      ].map(({ k, label }) => el('label', {
        style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
      },
        el('input', {
          type: 'checkbox', name: `mod_${k}`,
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.[k] === true ? { checked: 'true' } : {})
        }),
        label
      )),
      // 必填子設定（每個一行，縮排）
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #a7f3d0' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '必填欄位設定'),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'us_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.understoryConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '地被樣方照片必填'
        ),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'sc_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.soilConsConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '水保定點照片必填'
        )
      ),
      // 樣方大小
      el('div', { style: 'margin-top:8px' },
        el('label', { style: 'display:block;font-size:13px;color:#57534e;margin-bottom:4px' }, '地被樣方大小'),
        el('select', {
          name: 'us_quadratSize',
          style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;background:#fff'
        },
          ...['1x1', '2x2', '5x5'].map(s => {
            const opt = el('option', { value: s }, `${s.replace('x', ' × ')} m`);
            if ((m.understoryConfig?.quadratSize || '1x1') === s) opt.setAttribute('selected', 'true');
            return opt;
          })
        )
      ),
    ),
    // v2.1：野生動物模組
    el('div', { class: 'field', style: 'background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.1 野生動物監測'),
      el('label', { style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer' },
        el('input', {
          type: 'checkbox', name: 'mod_wildlife',
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.wildlife === true ? { checked: 'true' } : {})
        }),
        '🦌 啟用野生動物監測'
      ),
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #fcd34d' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '設定'),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'wl_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.wildlifeConfig?.requirePhotos === true ? { checked: 'true' } : {})
          }),
          '紀錄照片必填（音訊調查可免）'
        ),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'wl_blur',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.wildlifeConfig?.blurSensitive !== false ? { checked: 'true' } : {})
          }),
          '保育類 I 級匯出時加警示（避免敏感物種點位外流）'
        )
      ),
      el('p', { style: 'font-size:11px;color:#78716c;margin-top:6px' },
        '支援 4 種方法：直接目擊 / 痕跡 / 自動相機 / 鳴聲。物種輸入即時帶保育等級色階。')
    ),
    // v2.2：經濟收穫模組
    el('div', { class: 'field', style: 'background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.2 經濟收穫監測'),
      el('label', { style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer' },
        el('input', {
          type: 'checkbox', name: 'mod_harvest',
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.harvest === true ? { checked: 'true' } : {})
        }),
        '🌰 啟用經濟收穫監測'
      ),
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #fde047' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '可採收樹種白名單（限制 harvest 紀錄綁的 tree.speciesZh）'),
        el('input', {
          type: 'text', name: 'hv_species',
          style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;width:100%;background:#fff',
          placeholder: '土肉桂, 油茶, 愛玉子',
          value: (m.harvestConfig?.species || ['土肉桂']).join(', ')
        }),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer;margin-top:6px' },
          el('input', {
            type: 'checkbox', name: 'hv_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.harvestConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '採收照片必填（採前/採後/產品）'
        ),
        el('div', { style: 'margin-top:6px' },
          el('label', { style: 'display:block;font-size:13px;color:#57534e;margin-bottom:2px' }, '預設含水率（鮮→乾重估算）'),
          el('input', {
            type: 'number', name: 'hv_moisture', step: '0.05', min: '0', max: '0.95',
            style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;width:100px;background:#fff',
            value: m.harvestConfig?.moistureDefault ?? 0.5
          })
        )
      ),
      el('p', { style: 'font-size:11px;color:#78716c;margin-top:6px' },
        '🌳 採收紀錄綁立木個體；treeStatusAfter=砍除根除 自動同步 tree.vitality。鮮重→乾重→自動算 tCO₂e 扣減。')
    ),
    field({ label: '方法學說明', name: 'description', type: 'textarea', rows: 5, value: m.description || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const newM = {
      targetPlotCount: parseInt(fd.get('targetPlotCount'), 10),
      plotShape: fd.get('plotShape'),
      plotAreaOptions: fd.get('plotAreaOptions').split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0),
      plotOriginType: fd.get('plotOriginType') || 'center',  // v2.5
      required: {
        photos: fd.get('req_photos') === 'on',
        branchHeight: fd.get('req_branchHeight') === 'on',
        pestSymptoms: fd.get('req_pestSymptoms') === 'on'
      },
      modules: {
        plot: fd.get('mod_plot') === 'on',
        tree: fd.get('mod_tree') === 'on',
        regeneration: fd.get('mod_regeneration') === 'on',
        understory: fd.get('mod_understory') === 'on',  // v2.0
        soilCons: fd.get('mod_soilCons') === 'on',      // v2.0
        wildlife: fd.get('mod_wildlife') === 'on',      // v2.1
        harvest: fd.get('mod_harvest') === 'on',        // v2.2
        disturbance: m.modules?.disturbance || false
      },
      // v2.0：新模組獨立 config
      understoryConfig: {
        ...DEFAULT_METHODOLOGY.understoryConfig,
        ...(m.understoryConfig || {}),
        quadratSize: fd.get('us_quadratSize') || '1x1',
        requirePhotos: fd.get('us_photoReq') === 'on'
      },
      soilConsConfig: {
        ...DEFAULT_METHODOLOGY.soilConsConfig,
        ...(m.soilConsConfig || {}),
        requirePhotos: fd.get('sc_photoReq') === 'on'
      },
      // v2.1：野生動物
      wildlifeConfig: {
        ...DEFAULT_METHODOLOGY.wildlifeConfig,
        ...(m.wildlifeConfig || {}),
        requirePhotos: fd.get('wl_photoReq') === 'on',
        blurSensitive: fd.get('wl_blur') === 'on'
      },
      // v2.2：經濟收穫
      harvestConfig: {
        ...DEFAULT_METHODOLOGY.harvestConfig,
        ...(m.harvestConfig || {}),
        species: (fd.get('hv_species') || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean),
        requirePhotos: fd.get('hv_photoReq') === 'on',
        moistureDefault: parseFloat(fd.get('hv_moisture')) || 0.5
      },
      description: fd.get('description').trim()
    };
    try {
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), { methodology: newM });
      project.methodology = newM;
      state.project.methodology = newM;
      // v2.3：methodology 第一次儲存（status='created'）→ 'planning'
      try { await applyStatusAfterMethodologySaved(state.project); } catch (e) { console.warn('[v2.3 methodology status] failed', e); }
      toast('方法學已更新');
      closeModal();
      location.reload();  // 簡單重整讓設計頁重繪
    } catch (e) { toast('儲存失敗：' + e.message); }
  });
  openModal('編輯方法學', f);
}

// ===== v1.7.0：PI 批量建立空殼樣區（預先規劃 + 分派工作的入口）=====
// Code 規則：{projectCode}[-{林班}]-{NNN}（NNN 補零三位數）
// 空殼 = 無 GPS / 無 area / assignedTo=null / qaStatus='shell'（不會出現在待審核）
export async function openBatchPlotsForm(project) {
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  const previewBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs text-stone-700 my-2' });

  const f = el('form', { class: 'space-y-2' },
    el('p', { class: 'text-sm text-stone-600' },
      `批量建立預先規劃的空殼樣區。Surveyor 被指派後可填 GPS 與資料。`),
    el('div', { class: 'field-row' },
      field({ label: '林班（可留空）', name: 'forestUnit', value: '', placeholder: '123-2' }),
      field({ label: '起始編號', name: 'startNum', type: 'number', step: '1', min: '1', required: true, value: 1 })
    ),
    el('div', { class: 'field-row' },
      field({ label: '建立數量', name: 'count', type: 'number', step: '1', min: '1', max: '500', required: true, value: 10 }),
      field({ label: '預設面積 (m²)', name: 'area_m2',
        options: (meth.plotAreaOptions || [400, 500, 1000]).map(a => ({ value: a, label: `${a} m²` })),
        value: meth.plotAreaOptions?.[0] || 500, required: true })
    ),
    field({ label: '預設形狀', name: 'shape',
      options: [{ value: 'circle', label: '圓形' }, { value: 'square', label: '方形' }],
      value: meth.plotShape || 'circle', required: true }),
    previewBox,
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '建立'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  function updatePreview() {
    const fd = new FormData(f);
    const fu = fd.get('forestUnit').trim();
    const start = parseInt(fd.get('startNum'), 10) || 1;
    const count = parseInt(fd.get('count'), 10) || 1;
    const codeOf = (n) => `${project.code}${fu ? '-' + fu : ''}-${String(n).padStart(3, '0')}`;
    if (count <= 0) { previewBox.textContent = ''; return; }
    if (count === 1) {
      previewBox.innerHTML = `將建立：<b>${codeOf(start)}</b>`;
    } else {
      previewBox.innerHTML = `將建立 <b>${count}</b> 個樣區：<b>${codeOf(start)}</b> ～ <b>${codeOf(start + count - 1)}</b>`;
    }
  }
  f.addEventListener('input', updatePreview);
  updatePreview();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const fu = fd.get('forestUnit').trim() || null;
    const start = parseInt(fd.get('startNum'), 10);
    const count = parseInt(fd.get('count'), 10);
    const area = parseInt(fd.get('area_m2'), 10);
    const shape = fd.get('shape');
    if (count > 100 && !confirm(`建立 ${count} 個空殼？建議分批以免一次寫太多`)) return;

    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '建立中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots');
      let success = 0;
      for (let i = 0; i < count; i++) {
        const n = start + i;
        const code = `${project.code}${fu ? '-' + fu : ''}-${String(n).padStart(3, '0')}`;
        await fb.addDoc(colRef, {
          code,
          forestUnit: fu,
          shape,
          area_m2: area,
          location: null,
          locationTWD97: null,
          locationAccuracy_m: null,
          establishedAt: null,
          notes: null,
          assignedTo: null,
          qaStatus: 'shell',  // v1.7.0：空殼狀態，不參與 QA 統計
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
          insideBoundary: true
        });
        success++;
      }
      toast(`已建立 ${success} 個空殼樣區`);
      closeModal();
    } catch (e) {
      toast('建立失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '建立';
    }
  });
  openModal('批量建立空殼樣區', f);
}

// ===== v1.7.0：批量指派樣區給 surveyor =====
export async function assignPlotToSurveyor(project, plot, surveyorUid) {
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), {
      assignedTo: surveyorUid || null,
      updatedAt: fb.serverTimestamp()
    });
    toast(surveyorUid ? '已指派' : '已解除指派');
  } catch (e) { toast('指派失敗：' + e.message); }
}

// ===== QA 標記（pi 用）=====
// v2.3：標記後跑狀態機
//   - verified 後若全 6 子集合 verified → 自動 review + auto-Lock
//   - 從 verified 退回 flagged/rejected 且 status='review' → 退回 active + auto-unlock
export async function markQA(project, plotId, subDoc, status) {
  const labels = { verified: '通過', flagged: '退回修正', rejected: '駁回' };
  const comment = status === 'verified' ? '' : (prompt(`為什麼${labels[status]}？（簡短說明）`) || '');
  if (status !== 'verified' && !comment.trim()) { toast('需填寫原因'); return; }
  try {
    const ref = subDoc
      ? fb.doc(fb.db, 'projects', project.id, 'plots', plotId, subDoc.coll, subDoc.id)
      : fb.doc(fb.db, 'projects', project.id, 'plots', plotId);
    // v2.3：先讀 oldQa 才能判斷狀態機要 promote 還是 demote
    const oldSnap = await fb.getDoc(ref);
    const oldQa = oldSnap.exists() ? oldSnap.data().qaStatus : null;
    await fb.updateDoc(ref, {
      qaStatus: status,
      qaMarkedBy: state.user.uid,
      qaMarkedAt: fb.serverTimestamp(),
      qaComment: comment
    });
    toast(`已標記為 ${status}`);
    // v2.3：狀態機分派（不擋 toast；跑完再 toast 結果）
    let stateChanged = false;
    try {
      const result = await applyStatusAfterQA(project, oldQa, status);
      if (result === 'promoted-review') {
        toast('🔍 全資料 verified — 專案已自動進入審查階段並鎖定', 5000);
        stateChanged = true;
      } else if (result === 'demoted-active') {
        toast('▶ 專案自動退回「進行中」（已解除鎖定）', 4000);
        stateChanged = true;
      }
    } catch (e) { console.warn('[v2.3 status update] failed', e); }
    // v2.6.1：sub-doc + 沒觸發狀態機 → 局部更新該 row 的 badge（不 reroute、不閃畫面）
    //         plot 本身 / 觸發 promote-demote → 仍 reroute（更新 lock banner、status badge、全部 row 的 QA 按鈕）
    if (subDoc && !stateChanged) {
      const cell = document.querySelector(`[data-qa-cell-id="qa-cell-${subDoc.coll}-${subDoc.id}"]`);
      if (cell) {
        const badge = cell.querySelector('.qa-badge');
        if (badge) {
          badge.outerHTML = qaBadge(status);
          // v2.6.1b：broadcast event 給樣區清單頁的 chip 做增量更新
          //   （plot listener 對 sub-doc 變動無感，需手動通知）
          window.dispatchEvent(new CustomEvent('mrv:qa-changed', {
            detail: { plotId, subColl: subDoc.coll, oldStatus: oldQa, newStatus: status }
          }));
          return;  // 局部更新成功 → 不 reroute
        }
      }
      console.warn('[markQA local-update] cell/badge not found, fallback to reroute', subDoc);
    }
    // v2.3.1：fallback / 狀態機觸發 / plot 本身 → 重繪當前 view
    // v2.3.4：reroute 前記住當前 sub-tab
    captureCurrentSubtab();
    state.project = null;
    state.plot = null;
    try { await rerouteCurrentView(); } catch (e) { console.warn('[reroute] failed', e); }
  } catch (e) { toast('標記失敗：' + e.message); }
}

// ===== 樣區表單 =====
export async function openPlotForm(project, existing = null) {
  const loc = existing?.location;
  const t97 = existing?.locationTWD97;
  // v1.5：套用 methodology + 警示超過目標數
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  if (!existing) {
    try {
      const ps = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
      if (meth.targetPlotCount && ps.size >= meth.targetPlotCount) {
        if (!confirm(`已達方法學目標數（${meth.targetPlotCount}）— 目前 ${ps.size} 個樣區。仍要繼續新增嗎？`)) return;
      }
    } catch {}
  }

  // v2.3.6：plot GPS 用共用 helper（顯示 TWD97 + accuracy）
  const { gpsBtn, gpsStatus, lngInput, latInput, accInput } = createGpsButton({
    initialLat: loc?.latitude ?? null,
    initialLng: loc?.longitude ?? null,
    initialAccuracy: existing?.locationAccuracy_m ?? null,
    showTwd97: true
  });

  // v1.6：照片上傳元件
  const photoReq = !!meth.required?.photos;
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '樣區照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（≤5MB / 張，可多選）'));

  const f = el('form', { class: 'space-y-2' },
    field({ label: '樣區編號', name: 'code', required: true, value: existing?.code || '', placeholder: `${project.code}-001` }),
    field({ label: '林班-小班', name: 'forestUnit', value: existing?.forestUnit || '', placeholder: '123-2' }),
    el('div', { class: 'field' },
      el('label', {}, 'GPS 座標 ', el('span', { class: 'req' }, '*')),
      el('div', { class: 'flex items-center flex-wrap gap-2' }, gpsBtn, gpsStatus),
      lngInput, latInput, accInput
    ),
    el('div', { class: 'field-row' },
      field({ label: '形狀', name: 'shape',
        options: [{ value: 'circle', label: '圓形' }, { value: 'square', label: '方形' }],
        value: existing?.shape || meth.plotShape || 'circle', required: true }),
      field({ label: '面積 (m²)', name: 'area_m2',
        options: (meth.plotAreaOptions || [400, 500, 1000]).map(a => ({ value: a, label: `${a} m²` })),
        value: existing?.area_m2 || (meth.plotAreaOptions?.[0] || 500), required: true })
    ),
    field({ label: '設置日期', name: 'establishedAt', type: 'date', required: true, value: existing?.establishedAt ? (existing.establishedAt.toDate ? existing.establishedAt.toDate() : new Date(existing.establishedAt)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deletePlot(project, existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const lng = parseFloat(fd.get('lng'));
    const lat = parseFloat(fd.get('lat'));
    if (!lng || !lat) { toast('請先抓取 GPS'); return; }
    // v1.6：照片 required 驗證
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張樣區照片'); return; }
    const t97 = wgs84ToTwd97(lng, lat);
    const data = {
      code: fd.get('code').trim(),
      forestUnit: fd.get('forestUnit').trim() || null,
      location: new fb.GeoPoint(lat, lng),
      locationTWD97: { x: t97.x, y: t97.y },
      locationAccuracy_m: parseFloat(fd.get('accuracy')) || null,
      shape: fd.get('shape'),
      area_m2: parseInt(fd.get('area_m2'), 10),
      establishedAt: new Date(fd.get('establishedAt')),
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp(),
      insideBoundary: true  // v2: 對林班界做點面套疊
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      // v1.6：先建/更新 plot 取得 id，再上傳照片，最後寫回 photos URL
      let plotId;
      if (existing) {
        plotId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots'), data);
        plotId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({ projectId: project.id, plotId, prefix: 'plot' });
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? '編輯樣區' : '新樣區', f);
}

// v1.5.1 bug #3：surveyor 修正自己被 flag/reject 的資料 → 自動回 pending
// 保留 qaComment 給 dataManager 看歷史
// v2.3：return boolean 讓 caller 知道是否觸發了 reset，以便接著跑專案層狀態機
function applySurveyorReQaReset(data, existing) {
  if (!existing) return false;
  if (existing.createdBy !== state.user.uid) return false;
  if (!['flagged', 'rejected'].includes(existing.qaStatus)) return false;
  data.qaStatus = 'pending';
  data.qaMarkedBy = null;
  data.qaMarkedAt = null;
  return true;
}

// v2.3：surveyor reset 後若 project.status='review' 退回 active + auto-unlock
async function maybeDemoteAfterReset(project, didReset) {
  if (!didReset) return;
  try {
    const result = await applyStatusAfterSurveyorReset(project, true);
    if (result === 'demoted-active') {
      toast('▶ 專案自動退回「進行中」（已解除鎖定）', 4000);
      setTimeout(() => location.reload(), 1800);
    }
  } catch (e) { console.warn('[v2.3 surveyor reset status] failed', e); }
}

async function deletePlot(project, plot) {
  if (!confirm(`確定刪除樣區 ${plot.code}？子項立木與更新記錄會殘留（v1 限制）`)) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id));
    toast('已刪除');
    closeModal();
    location.hash = `#/p/${project.id}`;
  } catch (e) { toast('刪除失敗：' + e.message); }
}

// ===== 立木表單 =====
// v2.3.3：個體編號自動帶 plotCode + 下一個未用流水號（DEMO-010-001 格式）
//   - prefix 顯示 plot.code-（唯讀），右側 input 預設下一個流水號
//   - 編輯既有：保留原 treeNum，prefix 仍顯示但不可改
//   - submit 寫入 treeCode（完整字串）+ treeNum（流水號 number）
export async function openTreeForm(project, plot, existing = null) {
  // v2.3.3：算下一個未用流水號（query 同 plot 已存在的 trees）
  let nextNum = 1;
  if (!existing) {
    try {
      const ts = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
      const usedNums = ts.docs.map(d => parseInt(d.data().treeNum, 10)).filter(n => Number.isFinite(n));
      nextNum = usedNums.length ? Math.max(...usedNums) + 1 : 1;
    } catch (e) { console.warn('[openTreeForm] count trees failed', e); }
  }
  const padNum = (n) => String(n).padStart(3, '0');

  // 樹種 autocomplete（datalist）
  const speciesList = el('datalist', { id: 'dl-species' },
    ...SPECIES.map(s => el('option', { value: s.zh }, `${s.sci}${s.cons ? ` [${s.cons}]` : ''}`))
  );

  const speciesInput = el('input', {
    type: 'text', name: 'speciesZh', required: 'true',
    list: 'dl-species', placeholder: '輸入或選擇',
    value: existing?.speciesZh || '',
    autocomplete: 'off'
  });
  const consWarn = el('div', { class: 'text-xs mt-1' });
  function updateConsWarn() {
    const s = SPECIES.find(x => x.zh === speciesInput.value);
    if (s?.cons) consWarn.innerHTML = `<span class="cons-warn">⚠ 保育類 第 ${s.cons} 級</span>`;
    else consWarn.innerHTML = '';
  }
  speciesInput.addEventListener('input', updateConsWarn);
  updateConsWarn();

  // DBH / H 即時計算顯示
  const calcOut = el('div', { class: 'bg-stone-50 rounded p-2 text-xs text-stone-700 my-2' });
  function updateCalc() {
    const dbh = parseFloat(f.querySelector('[name=dbh_cm]').value);
    const h = parseFloat(f.querySelector('[name=height_m]').value);
    const zh = speciesInput.value;
    const sci = SPECIES.find(x => x.zh === zh)?.sci || '';
    if (!dbh || !h) { calcOut.textContent = '輸入 DBH 與樹高即時試算'; return; }
    const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh: zh, speciesSci: sci });
    // v1.6.20：顯示樹種別參數來源 + 完整碳/CO2 計算
    calcOut.innerHTML =
      `<div>斷面積 <b>${m.basalArea_m2}</b> m² ｜ 幹材積 <b>${m.volume_m3}</b> m³</div>` +
      `<div>全株生物量 <b>${m.biomass_kg}</b> kg ｜ 碳蓄積 <b>${m.carbon_kg}</b> kg ｜ CO₂ 當量 <b>${m.co2_kg}</b> kg</div>` +
      `<div class="text-[10px] text-stone-500 mt-1">${speciesParamsLabel(zh, sci)}</div>`;
  }

  // 病蟲害 checkbox（v1.6.9：inline style 寫死在 HTML，不依賴 CSS file，避開任何快取問題）
  const existingPests = new Set(existing?.pestSymptoms || []);
  const pestBox = el('div', { style: 'font-size:0' });
  const labStyle = 'display:inline-block;width:33%;font-size:14px;white-space:nowrap;line-height:1.8;vertical-align:top;color:#1c1917;cursor:pointer';
  const inpStyle = 'vertical-align:middle;margin-right:4px;width:16px;height:16px';
  pestBox.innerHTML = PEST_OPTIONS.map(p =>
    `<label style="${labStyle}"><input type="checkbox" name="pest" value="${p}"${existingPests.has(p) ? ' checked' : ''} style="${inpStyle}"> ${p}</label>`
  ).join('');

  // v1.6.13：立木照片上傳（拍特徵：樹皮、葉、花果、整體外觀）
  const treePhotoUp = photoUploader({ existing: existing?.photos || [] });
  const treePhotoLabel = el('label', {}, '立木照片',
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（樹皮 / 葉 / 花果 / 整體，≤5MB / 張）'));

  // v2.5：立木個體座標 X/Y（樣區內局部，自動換算 absolute TWD97 + WGS84）
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  const originType = meth.plotOriginType || 'center';
  const originLabel = originType === 'center' ? '中心點' : '左下角';
  const xyHint = originType === 'center'
    ? '皮尺距樣區中心點的偏移量（東向 X / 北向 Y，可正可負）'
    : '皮尺距樣區左下角的距離（向東 X / 向北 Y，皆為正）';
  const xInput = el('input', {
    type: 'number', name: 'localX_m', step: '0.01',
    value: existing?.localX_m ?? '',
    style: 'width:100%;border:1px solid #d6d3d1;border-radius:6px;padding:8px 10px;font-size:16px'
  });
  const yInput = el('input', {
    type: 'number', name: 'localY_m', step: '0.01',
    value: existing?.localY_m ?? '',
    style: 'width:100%;border:1px solid #d6d3d1;border-radius:6px;padding:8px 10px;font-size:16px'
  });
  const xyCalc = el('div', { class: 'text-xs', style: 'background:#f5f5f4;border-radius:6px;padding:6px 8px;margin-top:6px' });
  function updateXyCalc() {
    const lx = parseFloat(xInput.value);
    const ly = parseFloat(yInput.value);
    const px = plot.locationTWD97?.x;
    const py = plot.locationTWD97?.y;
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
      xyCalc.innerHTML = '<span class="text-stone-500">輸入 X / Y 即時換算絕對座標</span>';
      return;
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      xyCalc.innerHTML = '<span class="text-amber-700">⚠ 樣區尚未設定 GPS 座標 — 無法換算絕對位置</span>';
      return;
    }
    const absX = px + lx;
    const absY = py + ly;
    let lngLat = '—';
    try {
      const w = twd97ToWgs84(absX, absY);
      if (w?.lng != null) lngLat = `${w.lng.toFixed(6)}, ${w.lat.toFixed(6)}`;
    } catch (e) {}
    xyCalc.innerHTML =
      `<div>絕對 TWD97：<b>X=${absX.toFixed(2)} m, Y=${absY.toFixed(2)} m</b></div>` +
      `<div>WGS84（lng, lat）：<b>${lngLat}</b></div>`;
  }
  xInput.addEventListener('input', updateXyCalc);
  yInput.addEventListener('input', updateXyCalc);
  const xyBox = el('div', { class: 'field', style: 'background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:10px' },
    el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:4px' },
      `📍 立木位置（${originLabel}原點）`,
      el('span', { class: 'text-xs text-stone-500 ml-1' }, '（v2.5 新欄位 / 選填）')),
    el('div', { class: 'text-xs text-stone-600 mb-2' }, xyHint),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'X (m)'), xInput),
      el('div', { class: 'field' }, el('label', {}, 'Y (m)'), yInput)
    ),
    xyCalc
  );
  // 延遲一拍以等 DOM 接上才更新提示
  setTimeout(updateXyCalc, 0);

  // v2.3.3：個體編號 — prefix（plot.code-）+ 序號 input + 即時預覽
  const treeNumInput = el('input', {
    type: 'number', name: 'treeNum', step: '1', min: '1', required: 'true',
    value: existing?.treeNum ?? nextNum,
    style: 'flex:1;border:1px solid #d6d3d1;border-left:none;border-radius:0 6px 6px 0;padding:8px 10px;font-size:16px;min-width:0'
  });
  const treeCodePreview = el('div', {
    class: 'text-xs text-stone-600 mt-1',
    style: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace'
  }, `最終編號：${plot.code}-${padNum(parseInt(treeNumInput.value, 10) || nextNum)}`);
  function updateTreeCodePreview() {
    const n = parseInt(treeNumInput.value, 10);
    treeCodePreview.textContent = Number.isFinite(n) && n > 0
      ? `最終編號：${plot.code}-${padNum(n)}`
      : `最終編號：${plot.code}-???（請輸入流水號）`;
  }
  treeNumInput.addEventListener('input', updateTreeCodePreview);

  const f = el('form', { class: 'space-y-2' },
    speciesList,
    el('div', { class: 'field' },
      el('label', {}, '個體編號 ', el('span', { class: 'req' }, '*')),
      el('div', { style: 'display:flex;align-items:stretch' },
        el('span', {
          style: 'background:#f5f5f4;border:1px solid #d6d3d1;border-right:none;border-radius:6px 0 0 6px;padding:8px 10px;font-size:16px;color:#57534e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap'
        }, `${plot.code}-`),
        treeNumInput
      ),
      treeCodePreview
    ),
    el('div', { class: 'field' },
      el('label', {}, '樹種 ', el('span', { class: 'req' }, '*')),
      speciesInput,
      consWarn
    ),
    // v2.5：立木個體座標（樣區內局部 X/Y → 自動算 absolute TWD97 + WGS84）
    xyBox,
    el('div', { class: 'field-row' },
      field({ label: 'DBH (cm)', name: 'dbh_cm', type: 'number', step: '0.1', min: '0', required: true, value: existing?.dbh_cm ?? '' }),
      field({ label: '樹高 H (m)', name: 'height_m', type: 'number', step: '0.1', min: '0', required: true, value: existing?.height_m ?? '' })
    ),
    field({ label: '枝下高 (m)', name: 'branchHeight_m', type: 'number', step: '0.1', min: '0', value: existing?.branchHeight_m ?? '' }),
    calcOut,
    field({ label: '活力', name: 'vitality', required: true,
      options: [
        { value: 'healthy', label: '健康' },
        { value: 'weak', label: '衰弱' },
        { value: 'standing-dead', label: '枯立' },
        { value: 'fallen', label: '倒伏' }
      ], value: existing?.vitality || 'healthy' }),
    el('div', { class: 'field' },
      el('label', {}, '病蟲害症狀（複選）'),
      pestBox
    ),
    field({ label: '標記方式', name: 'marking',
      options: [
        { value: 'none', label: '無' },
        { value: 'paint', label: '噴漆' },
        { value: 'tag', label: '號牌' }
      ], value: existing?.marking || 'none' }),
    el('div', { class: 'field' }, treePhotoLabel, treePhotoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deleteSubdoc(project, plot, 'trees', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  // 即時計算
  f.querySelector('[name=dbh_cm]').addEventListener('input', updateCalc);
  f.querySelector('[name=height_m]').addEventListener('input', updateCalc);
  speciesInput.addEventListener('input', updateCalc);
  updateCalc();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const sp = SPECIES.find(x => x.zh === speciesZh) || {};
    const dbh = parseFloat(fd.get('dbh_cm'));
    const h = parseFloat(fd.get('height_m'));
    const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh, speciesSci: sp.sci });
    const treeNumVal = parseInt(fd.get('treeNum'), 10);
    // v2.5：立木座標換算（local X/Y → absolute TWD97 + WGS84 geopoint）
    const localX = parseFloat(fd.get('localX_m'));
    const localY = parseFloat(fd.get('localY_m'));
    let treeLocationTWD97 = null, treeLocationWGS84 = null;
    if (Number.isFinite(localX) && Number.isFinite(localY)
        && Number.isFinite(plot.locationTWD97?.x) && Number.isFinite(plot.locationTWD97?.y)) {
      const absX = plot.locationTWD97.x + localX;
      const absY = plot.locationTWD97.y + localY;
      treeLocationTWD97 = { x: absX, y: absY };
      try {
        const w = twd97ToWgs84(absX, absY);
        if (w?.lng != null && w?.lat != null) {
          treeLocationWGS84 = new fb.GeoPoint(w.lat, w.lng);
        }
      } catch (e) { console.warn('[v2.5 tree wgs84]', e); }
    }
    const data = {
      treeNum: treeNumVal,
      // v2.3.3：完整字串編號（DEMO-010-001 格式），方便顯示與匯出
      treeCode: `${plot.code}-${String(treeNumVal).padStart(3, '0')}`,
      speciesZh,
      speciesSci: sp.sci || null,
      conservationGrade: sp.cons || null,
      dbh_cm: dbh,
      height_m: h,
      branchHeight_m: parseFloat(fd.get('branchHeight_m')) || null,
      vitality: fd.get('vitality'),
      pestSymptoms: fd.getAll('pest'),
      marking: fd.get('marking'),
      notes: fd.get('notes').trim() || null,
      // v2.5 立木個體座標
      localX_m: Number.isFinite(localX) ? localX : null,
      localY_m: Number.isFinite(localY) ? localY : null,
      locationTWD97: treeLocationTWD97,
      location: treeLocationWGS84,
      ...m,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees');
      // v1.6.13：先建/更新 tree 取得 id，再上傳照片，最後寫回 photos URL
      let treeId;
      if (existing) {
        treeId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, treeId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        treeId = ref.id;
      }
      if (treePhotoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (treePhotoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await treePhotoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `tree-${treeId}`
        });
        await fb.updateDoc(fb.doc(colRef, treeId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  // v2.3.3：標題顯示完整 treeCode（舊資料 fallback：plot.code + 補零 treeNum）
  const titleCode = existing ? (existing.treeCode || `${plot.code}-${String(existing.treeNum || 0).padStart(3, '0')}`) : null;
  openModal(existing ? `編輯立木 ${titleCode}` : '新立木', f);
}

// ===== 自然更新表單 =====
export function openRegenForm(project, plot, existing = null) {
  const f = el('form', { class: 'space-y-2' },
    field({ label: '樹種', name: 'speciesZh', required: true, value: existing?.speciesZh || '' }),
    field({ label: '苗高分級', name: 'heightClass', required: true,
      options: [
        { value: '<30', label: '< 30 cm' },
        { value: '30-130', label: '30 – 130 cm' },
        { value: '>130', label: '> 130 cm' }
      ], value: existing?.heightClass || '<30' }),
    field({ label: '株數', name: 'count', type: 'number', step: '1', min: '0', required: true, value: existing?.count ?? '' }),
    field({ label: '競爭植被覆蓋度 (%)', name: 'competitionCover_pct', type: 'number', step: '5', min: '0', max: '100', value: existing?.competitionCover_pct ?? '' }),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deleteSubdoc(project, plot, 'regeneration', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const sp = SPECIES.find(x => x.zh === speciesZh) || {};
    const data = {
      speciesZh,
      speciesSci: sp.sci || null,
      heightClass: fd.get('heightClass'),
      count: parseInt(fd.get('count'), 10),
      competitionCover_pct: fd.get('competitionCover_pct') ? parseInt(fd.get('competitionCover_pct'), 10) : null,
      notes: fd.get('notes').trim() || null
    };
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'regeneration');
      if (existing) {
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, existing.id), data);
        toast(data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新');
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';  // v1.5
        await fb.addDoc(colRef, data);
        toast('已建立（待審核）');
      }
      closeModal();
    } catch (e) { toast('儲存失敗：' + e.message); }
  });
  openModal(existing ? '編輯更新記錄' : '新更新記錄', f);
}

async function deleteSubdoc(project, plot, subColl, existing) {
  if (!confirm('確定刪除？')) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, subColl, existing.id));
    toast('已刪除');
    closeModal();
  } catch (e) { toast('刪除失敗：' + e.message); }
}

// ===== v2.0 共用：調查場次（surveyRound）helper =====
// 自動產生當前季度標籤，如 'Q2-2026'。PI 可在 methodology 改設成月份模式。
function currentSurveyRound() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `Q${q}-${now.getFullYear()}`;
}

// ===== v2.0 模組一：地被植物（understory）— 5 點樣方法 =====
// 一筆 = 一個小樣方一次調查；species[] 為 nested array 記多筆物種覆蓋度
export function openUnderstoryForm(project, plot, existing = null) {
  const cfg = project.methodology?.understoryConfig || DEFAULT_METHODOLOGY.understoryConfig;
  const photoReq = !!cfg.requirePhotos;

  // 物種子表：state 持有 species 陣列，動態加列/刪列
  let speciesRows = existing?.species ? [...existing.species] : [];

  // datalist 草本字典（依 lifeForm 分組註記）
  const herbList = el('datalist', { id: 'dl-herbs' },
    ...HERBS.map(h => el('option', { value: h.zh },
      `${h.lifeForm}${h.isInvasive ? ' ⚠入侵' : ''} ｜ ${h.sci}`))
  );

  const speciesContainer = el('div', { class: 'space-y-2' });
  function redrawSpecies() {
    speciesContainer.innerHTML = '';
    if (speciesRows.length === 0) {
      speciesContainer.appendChild(el('p', { class: 'text-xs text-stone-500 italic' }, '尚無物種紀錄，按下方「＋ 加物種」開始'));
      return;
    }
    speciesRows.forEach((sr, idx) => {
      const card = el('div', {
        class: 'border rounded p-2 space-y-1 ' + (sr.isInvasive ? 'bg-orange-50 border-orange-300' : 'bg-stone-50')
      });
      const speciesIn = el('input', {
        type: 'text', list: 'dl-herbs', placeholder: '物種中文', value: sr.speciesZh || '',
        class: 'border rounded px-2 py-1 w-full text-sm', autocomplete: 'off'
      });
      speciesIn.addEventListener('input', () => {
        sr.speciesZh = speciesIn.value;
        const h = findHerb(speciesIn.value);
        if (h) {
          sr.speciesSci = h.sci;
          sr.lifeForm = h.lifeForm;
          sr.isInvasive = h.isInvasive || isInvasive(speciesIn.value);
          lifeFormSel.value = h.lifeForm;
        } else {
          sr.isInvasive = isInvasive(speciesIn.value);
        }
        redrawSpecies();
      });
      const lifeFormSel = el('select', { class: 'border rounded px-2 py-1 text-sm' },
        ...['草本', '蕨類', '苔蘚', '藤本', '灌木幼株'].map(lf => {
          const opt = el('option', { value: lf }, lf);
          if (sr.lifeForm === lf) opt.setAttribute('selected', 'true');
          return opt;
        })
      );
      lifeFormSel.addEventListener('change', () => { sr.lifeForm = lifeFormSel.value; });
      const covInput = el('input', {
        type: 'number', min: '0', max: '100', step: '1', placeholder: '覆蓋%',
        value: sr.coverage ?? '', class: 'border rounded px-2 py-1 w-20 text-sm'
      });
      covInput.addEventListener('input', () => { sr.coverage = parseInt(covInput.value, 10) || 0; });
      const heightInput = el('input', {
        type: 'number', min: '0', step: '1', placeholder: '高cm',
        value: sr.height_cm ?? '', class: 'border rounded px-2 py-1 w-20 text-sm'
      });
      heightInput.addEventListener('input', () => { sr.height_cm = parseInt(heightInput.value, 10) || null; });
      const delBtn = el('button', {
        type: 'button', class: 'text-red-600 text-sm px-2',
        onclick: () => { speciesRows.splice(idx, 1); redrawSpecies(); }
      }, '✕');
      const invasiveTag = sr.isInvasive
        ? el('div', { class: 'text-xs text-orange-700 font-medium' }, '⚠ 公告外來入侵種')
        : null;
      card.appendChild(speciesIn);
      card.appendChild(el('div', { class: 'flex gap-2 items-center' },
        lifeFormSel,
        covInput, el('span', { class: 'text-xs text-stone-500' }, '%'),
        heightInput, el('span', { class: 'text-xs text-stone-500' }, 'cm'),
        delBtn
      ));
      if (invasiveTag) card.appendChild(invasiveTag);
      speciesContainer.appendChild(card);
    });
  }
  redrawSpecies();

  const addSpeciesBtn = el('button', {
    type: 'button', class: 'border border-dashed border-stone-400 rounded w-full py-2 text-sm text-stone-600',
    onclick: () => {
      speciesRows.push({ speciesZh: '', speciesSci: null, lifeForm: '草本', coverage: 0, height_cm: null, isInvasive: false });
      redrawSpecies();
    }
  }, '＋ 加物種');

  // 樣方照片
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '樣方俯拍照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（從正上方拍 1m×1m 範圍）'));

  const f = el('form', { class: 'space-y-2' },
    herbList,
    el('div', { class: 'field-row' },
      field({ label: '小樣方位置', name: 'quadratCode', required: true,
        options: cfg.quadratCodes.map(c => ({ value: c, label: { N: '北', E: '東', S: '南', W: '西', C: '中央' }[c] || c })),
        value: existing?.quadratCode || 'C' }),
      field({ label: '樣方大小', name: 'quadratSize', required: true,
        options: [
          { value: '1x1', label: '1 × 1 m' },
          { value: '2x2', label: '2 × 2 m' },
          { value: '5x5', label: '5 × 5 m' }
        ], value: existing?.quadratSize || cfg.quadratSize || '1x1' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound(), placeholder: 'Q2-2026' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '整體覆蓋度 (%)', name: 'totalCoverage', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.totalCoverage ?? '' }),
      field({ label: '枯枝落葉層厚 (cm)', name: 'litterDepth_cm', type: 'number', step: '0.5', min: '0',
        value: existing?.litterDepth_cm ?? '' })
    ),
    el('div', { class: 'field' },
      el('label', {}, '物種紀錄（覆蓋度可加總超過 100% — 多層交疊允許）'),
      speciesContainer,
      addSpeciesBtn
    ),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'understory', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張樣方照片'); return; }
    // 過濾空物種列
    const cleanSpecies = speciesRows.filter(s => s.speciesZh && s.speciesZh.trim());
    const fd = new FormData(f);
    const data = {
      quadratCode: fd.get('quadratCode'),
      quadratSize: fd.get('quadratSize'),
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      totalCoverage: parseInt(fd.get('totalCoverage'), 10),
      litterDepth_cm: fd.get('litterDepth_cm') ? parseFloat(fd.get('litterDepth_cm')) : null,
      species: cleanSpecies,
      invasiveCount: cleanSpecies.filter(s => s.isInvasive).length,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'understory');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `understory-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯地被樣方 ${existing.quadratCode}` : '新地被樣方', f);
}

// ===== v2.0 模組二：水土保持（soilCons）— 5 點定點觀測 =====
// 一筆 = 一個觀測點一次調查；自動帶上次同 stationCode 代表照供比對
export async function openSoilConsForm(project, plot, existing = null) {
  const cfg = project.methodology?.soilConsConfig || DEFAULT_METHODOLOGY.soilConsConfig;
  const photoReq = !!cfg.requirePhotos;

  // 抓上一筆同 stationCode 的紀錄（給比對照片）
  let lastRecord = null;
  const stationCode = existing?.stationCode || 'C';
  try {
    const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'soilCons');
    const qSnap = await fb.getDocs(fb.query(colRef,
      fb.where('stationCode', '==', stationCode),
      fb.orderBy('surveyDate', 'desc')
    ));
    for (const d of qSnap.docs) {
      if (existing && d.id === existing.id) continue;
      lastRecord = { id: d.id, ...d.data() };
      break;
    }
  } catch (e) { /* 無索引或無資料時略過 */ }

  // 比對照片區
  const compareBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs' });
  function updateCompareBox(curStation) {
    compareBox.innerHTML = '';
    if (!lastRecord || lastRecord.stationCode !== curStation) {
      compareBox.appendChild(el('div', { class: 'text-stone-500 italic' }, '尚無同點位歷史紀錄'));
      return;
    }
    const lastPhoto = (lastRecord.photos || [])[0];
    compareBox.appendChild(el('div', { class: 'font-medium mb-1' },
      `📅 上次調查：${(lastRecord.surveyDate?.toDate ? lastRecord.surveyDate.toDate() : new Date(lastRecord.surveyDate || 0)).toISOString().slice(0, 10)} `,
      `（${lastRecord.surveyRound || '—'}）`
    ));
    compareBox.appendChild(el('div', {},
      `沖蝕等級 ${lastRecord.erosionLevel} · 植生覆蓋 ${lastRecord.vegCoverage}% · 排水 ${lastRecord.drainage || '—'}`
    ));
    if (lastPhoto?.url) {
      compareBox.appendChild(el('div', { class: 'mt-1' },
        el('img', { src: lastPhoto.url, style: 'width:80px;height:80px;object-fit:cover;border-radius:4px;border:1px solid #d6d3d1' })
      ));
    }
  }

  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '定點照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（建議朝固定方位拍，便於比對）'));

  const stationSelect = el('select', { name: 'stationCode', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...cfg.stationCodes.map(c => {
      const lab = { N: '北 N', E: '東 E', S: '南 S', W: '西 W', C: '中央 C' }[c] || c;
      const opt = el('option', { value: c }, lab);
      if (c === stationCode) opt.setAttribute('selected', 'true');
      return opt;
    })
  );
  stationSelect.addEventListener('change', () => updateCompareBox(stationSelect.value));

  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', {}, '觀測點 ', el('span', { class: 'req' }, '*')),
        stationSelect
      ),
      field({ label: '事件類型', name: 'eventType', required: true,
        options: [
          { value: 'routine', label: '例行季調' },
          { value: 'post-typhoon', label: '颱風後' },
          { value: 'post-rain', label: '豪雨後' },
          { value: 'post-construction', label: '工程後' }
        ], value: existing?.eventType || 'routine' })
    ),
    field({ label: '事件名稱（如颱風名／豪雨日期，例行可留空）', name: 'eventName',
      value: existing?.eventName || '', placeholder: '丹娜絲颱風 / 0822 豪雨' }),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound(), placeholder: 'Q2-2026' })
    ),
    compareBox,
    el('div', { class: 'field-row' },
      field({ label: '植生覆蓋率 (%)', name: 'vegCoverage', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.vegCoverage ?? '' }),
      field({ label: '裸露面積率 (%)', name: 'bareRatio', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.bareRatio ?? '' })
    ),
    field({ label: '沖蝕等級 (1-5)', name: 'erosionLevel', required: true,
      options: [
        { value: 1, label: '1 — 無明顯沖蝕' },
        { value: 2, label: '2 — 輕微面蝕' },
        { value: 3, label: '3 — 溝蝕 < 5 cm' },
        { value: 4, label: '4 — 溝蝕 5–30 cm' },
        { value: 5, label: '5 — 崩塌或大型溝蝕' }
      ], value: existing?.erosionLevel || 1 }),
    el('div', { class: 'field-row' },
      field({ label: '沖蝕針讀值 (cm)', name: 'erosionPin_cm', type: 'number', step: '0.1',
        value: existing?.erosionPin_cm ?? '', placeholder: '無沖蝕針可留空' }),
      field({ label: '坍塌面積 (m²)', name: 'collapseArea_m2', type: 'number', step: '0.5', min: '0',
        value: existing?.collapseArea_m2 ?? '', placeholder: '無坍塌可留空' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '排水狀況', name: 'drainage', required: true,
        options: [
          { value: 'good', label: '良好' },
          { value: 'ponding', label: '積水' },
          { value: 'scouring', label: '淘刷' },
          { value: 'blocked', label: '阻塞' }
        ], value: existing?.drainage || 'good' }),
      field({ label: '保護工狀況', name: 'protectionStatus',
        options: [
          { value: 'none', label: '無設置' },
          { value: 'intact', label: '完好' },
          { value: 'partial', label: '局部破損' },
          { value: 'failed', label: '失效' }
        ], value: existing?.protectionStatus || 'none' })
    ),
    field({ label: '保護工類型（若有設置）', name: 'protectionType',
      options: [
        { value: '', label: '— 無 —' },
        { value: 'contour', label: '等高溝' },
        { value: 'staking', label: '打樁編柵' },
        { value: 'vegetation', label: '植生帶' },
        { value: 'concrete', label: '混凝土' },
        { value: 'masonry', label: '砌石' },
        { value: 'other', label: '其他' }
      ], value: existing?.protectionType || '' }),
    field({ label: '入侵植物覆蓋 (%)', name: 'invasiveCoverage', type: 'number', step: '1', min: '0', max: '100',
      value: existing?.invasiveCoverage ?? '' }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'soilCons', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  // 自動算 bareRatio = 100 - vegCoverage
  f.querySelector('[name=vegCoverage]').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) f.querySelector('[name=bareRatio]').value = Math.max(0, 100 - v);
  });

  updateCompareBox(stationCode);

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張定點照片'); return; }
    const fd = new FormData(f);
    const data = {
      stationCode: fd.get('stationCode'),
      eventType: fd.get('eventType'),
      eventName: fd.get('eventName').trim() || null,
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      vegCoverage: parseInt(fd.get('vegCoverage'), 10),
      bareRatio: parseInt(fd.get('bareRatio'), 10),
      erosionLevel: parseInt(fd.get('erosionLevel'), 10),
      erosionPin_cm: fd.get('erosionPin_cm') ? parseFloat(fd.get('erosionPin_cm')) : null,
      collapseArea_m2: fd.get('collapseArea_m2') ? parseFloat(fd.get('collapseArea_m2')) : null,
      drainage: fd.get('drainage'),
      protectionStatus: fd.get('protectionStatus'),
      protectionType: fd.get('protectionType') || null,
      invasiveCoverage: fd.get('invasiveCoverage') ? parseInt(fd.get('invasiveCoverage'), 10) : null,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'soilCons');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `soilcons-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯水保紀錄 ${existing.stationCode}` : '新水保紀錄', f);
}

// ===== v2.1 模組三：野生動物（wildlife）— 4 種方法切換 =====
// 一筆 = 一次觀察（直接目擊 / 痕跡 / 自動相機 / 鳴聲）
// 物種 datalist 用 ANIMALS 字典，自動帶保育等級色階
export function openWildlifeForm(project, plot, existing = null) {
  const cfg = project.methodology?.wildlifeConfig || DEFAULT_METHODOLOGY.wildlifeConfig;
  const photoReq = !!cfg.requirePhotos;

  // 動物字典 datalist（按 group 分組顯示）
  const animalList = el('datalist', { id: 'dl-animals' },
    ...ANIMALS.map(a => el('option', { value: a.zh },
      `${a.group}${a.cons ? ` [${a.cons} 級]` : ''} ｜ ${a.sci}`))
  );

  // method 切換：依選的方法顯示對應必填欄位
  const methodFields = {
    sign: null, cam: null, audio: null
  };

  const consWarn = el('div', { class: 'text-xs mt-1' });
  const speciesInput = el('input', {
    type: 'text', name: 'speciesZh', required: 'true',
    list: 'dl-animals', placeholder: '輸入或選擇',
    value: existing?.speciesZh || '',
    autocomplete: 'off',
    class: 'w-full border rounded px-2 py-1'
  });
  function updateConsWarn() {
    const a = findAnimal(speciesInput.value);
    if (a?.cons) {
      const colorMap = { 'I': '#dc2626', 'II': '#f97316', 'III': '#eab308' };
      const labelMap = { 'I': '瀕臨絕種', 'II': '珍貴稀有', 'III': '其他應予保育' };
      consWarn.innerHTML = `<span style="background:${colorMap[a.cons]};color:#fff;padding:2px 8px;border-radius:4px;font-weight:600">⚠ 第 ${a.cons} 級 — ${labelMap[a.cons]}</span> <span style="color:#57534e">${a.sci}</span>`;
    } else if (a) {
      consWarn.innerHTML = `<span style="color:#57534e">${a.group} ｜ ${a.sci}</span>`;
    } else {
      consWarn.innerHTML = '';
    }
  }
  speciesInput.addEventListener('input', updateConsWarn);
  updateConsWarn();

  // method 切換 listener
  const methodSelect = el('select', { name: 'method', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...['direct', 'sign', 'cam', 'audio'].map(m => {
      const labelMap = { direct: '直接目擊', sign: '痕跡（足印/糞便/食痕）', cam: '自動相機', audio: '鳴聲調查' };
      const opt = el('option', { value: m }, labelMap[m]);
      if (existing?.method === m) opt.setAttribute('selected', 'true');
      return opt;
    })
  );

  // 各方法專屬欄位區
  const signBox = el('div', { class: 'field hidden' },
    field({ label: '痕跡類型', name: 'signType',
      options: [
        { value: 'footprint', label: '足印' },
        { value: 'feces', label: '糞便' },
        { value: 'feeding', label: '食痕' },
        { value: 'scratching', label: '刨痕' },
        { value: 'nest', label: '巢穴' },
        { value: 'call', label: '鳴聲（聽到未見）' },
        { value: 'other', label: '其他' }
      ], value: existing?.signType || 'footprint' })
  );
  const camBox = el('div', { class: 'field hidden' },
    field({ label: '相機編號 / 點位 ID', name: 'camId',
      value: existing?.camId || '', placeholder: 'CAM-001' }),
    field({ label: '相機觸發時間', name: 'camTriggerTime', type: 'datetime-local',
      value: existing?.camTriggerTime ? toDatetimeLocal(existing.camTriggerTime) : '' })
  );
  const audioBox = el('div', { class: 'field hidden' },
    field({ label: '聽聲時長 (分鐘)', name: 'audioMinutes', type: 'number', step: '0.5', min: '0',
      value: existing?.audioMinutes ?? 5 })
  );

  function updateMethodVisibility() {
    const m = methodSelect.value;
    signBox.classList.toggle('hidden', m !== 'sign');
    camBox.classList.toggle('hidden', m !== 'cam');
    audioBox.classList.toggle('hidden', m !== 'audio');
    // 動態調整 required
    signBox.querySelector('[name=signType]').required = (m === 'sign');
    camBox.querySelector('[name=camId]').required = (m === 'cam');
    audioBox.querySelector('[name=audioMinutes]').required = (m === 'audio');
  }
  methodSelect.addEventListener('change', updateMethodVisibility);

  // v2.3.6：wildlife GPS 用共用 helper（與 plot 表單同款行為，加距 plot 中心顯示）
  const wlInitLat = existing?.location?.latitude ?? existing?.location?._lat ?? null;
  const wlInitLng = existing?.location?.longitude ?? existing?.location?._long ?? null;
  const { gpsBtn, gpsStatus, lngInput, latInput } = createGpsButton({
    initialLat: wlInitLat,
    initialLng: wlInitLng,
    showInitialAsExisting: true,
    plotForDistance: plot
  });

  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '紀錄照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（直接目擊：個體；痕跡：糞便/足印特寫；相機：原檔；音訊可免）'));

  const f = el('form', { class: 'space-y-2' },
    animalList,
    el('div', { class: 'field' },
      el('label', {}, '調查方法 ', el('span', { class: 'req' }, '*')),
      methodSelect
    ),
    el('div', { class: 'field' },
      el('label', {}, '物種中名 ', el('span', { class: 'req' }, '*')),
      speciesInput,
      consWarn
    ),
    signBox, camBox, audioBox,
    el('div', { class: 'field-row' },
      field({ label: '隻數 / 估計個體數', name: 'count', type: 'number', step: '1', min: '0', required: true,
        value: existing?.count ?? 1 }),
      field({ label: '齡別/性別', name: 'ageSex',
        options: [
          { value: '', label: '— 不確定 —' },
          { value: 'adult-M', label: '成體公' },
          { value: 'adult-F', label: '成體母' },
          { value: 'adult-U', label: '成體（性別不明）' },
          { value: 'juvenile', label: '幼體' },
          { value: 'mixed', label: '混齡' }
        ], value: existing?.ageSex || '' })
    ),
    field({ label: '行為', name: 'activity',
      options: [
        { value: '', label: '— 未確認 —' },
        { value: 'foraging', label: '覓食' },
        { value: 'resting', label: '休息' },
        { value: 'moving', label: '移動' },
        { value: 'alert', label: '警戒' },
        { value: 'breeding', label: '育幼/繁殖' },
        { value: 'calling', label: '鳴叫' }
      ], value: existing?.activity || '' }),
    field({ label: '微棲地', name: 'habitat',
      options: [
        { value: '', label: '— 未指定 —' },
        { value: 'canopy', label: '林冠層' },
        { value: 'understory', label: '林下層' },
        { value: 'ground', label: '地表' },
        { value: 'water', label: '水域' },
        { value: 'edge', label: '林緣' },
        { value: 'open', label: '空曠地' }
      ], value: existing?.habitat || '' }),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound() })
    ),
    el('div', { class: 'field' },
      el('label', {}, '觀察點 GPS ',
        el('span', { class: 'text-xs text-stone-500' }, '（容許 plot 邊界外，會顯示距離）')),
      el('div', { class: 'flex items-center flex-wrap gap-2' }, gpsBtn, gpsStatus),
      lngInput, latInput
    ),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註 / 行為描述', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'wildlife', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  updateMethodVisibility();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張紀錄照片'); return; }
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const a = findAnimal(speciesZh) || {};
    const lng = parseFloat(fd.get('lng'));
    const lat = parseFloat(fd.get('lat'));
    const data = {
      method: fd.get('method'),
      speciesZh,
      speciesSci: a.sci || null,
      group: a.group || null,
      conservationGrade: a.cons || null,
      count: parseInt(fd.get('count'), 10),
      ageSex: fd.get('ageSex') || null,
      activity: fd.get('activity') || null,
      habitat: fd.get('habitat') || null,
      signType: fd.get('signType') || null,
      camId: fd.get('camId')?.trim() || null,
      camTriggerTime: fd.get('camTriggerTime') ? new Date(fd.get('camTriggerTime')) : null,
      audioMinutes: fd.get('audioMinutes') ? parseFloat(fd.get('audioMinutes')) : null,
      location: (lng && lat) ? new fb.GeoPoint(lat, lng) : null,
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'wildlife');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `wildlife-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false; submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯野生動物紀錄` : '新野生動物紀錄', f);
}

// 共用：datetime-local 轉換 helper
function toDatetimeLocal(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 共用：兩點 WGS84 距離（公尺）— Haversine
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===== v2.2 模組四：經濟收穫（harvest）— 通用化命名（土肉桂為首） =====
// 紀錄綁立木個體（treeId 必填）；採後狀態同步 tree.vitality；自動算碳扣減（kg dry × 0.5 × 44/12 / 1000 = tCO₂e）
export async function openHarvestForm(project, plot, existing = null) {
  const cfg = project.methodology?.harvestConfig || DEFAULT_METHODOLOGY.harvestConfig;
  const photoReq = !!cfg.requirePhotos;
  const speciesWhitelist = cfg.species || ['土肉桂'];

  // 抓本 plot 內白名單樹種的 trees 給 treeId 下拉
  let candidateTrees = [];
  try {
    const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
    candidateTrees = treesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => speciesWhitelist.includes(t.speciesZh))
      .sort((a, b) => (a.treeNum || 0) - (b.treeNum || 0));
  } catch {}

  if (candidateTrees.length === 0 && !existing) {
    openModal('新採收紀錄', el('div', { class: 'space-y-2' },
      el('p', { class: 'text-sm' }, '此 plot 內沒有白名單樹種的立木。'),
      el('p', { class: 'text-xs text-stone-600' },
        `白名單：${speciesWhitelist.join(' / ')}（可在「設計 → 編輯方法學 → v2.2」修改）`),
      el('p', { class: 'text-xs text-stone-600' }, '請先在「立木調查」加入該樹種的立木。'),
      el('button', { type: 'button', class: 'w-full border py-2 rounded mt-3', onclick: closeModal }, '關閉')
    ));
    return;
  }

  // 找出當前選中的 tree（編輯模式）
  let selectedTree = existing
    ? candidateTrees.find(t => t.id === existing.treeId) || (existing.treeId ? { id: existing.treeId, treeNum: existing.treeNum, speciesZh: existing.speciesZh, dbh_cm: existing.dbh_at_harvest } : null)
    : candidateTrees[0];

  const treeSelect = el('select', { name: 'treeId', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...candidateTrees.map(t => {
      const opt = el('option', { value: t.id },
        `#${t.treeNum || '?'} · ${t.speciesZh} · DBH ${t.dbh_cm?.toFixed(1) || '?'} cm`);
      if (selectedTree?.id === t.id) opt.setAttribute('selected', 'true');
      return opt;
    })
  );

  // 計算自動帶 dbh_at_harvest（從選中 tree 帶過來）
  const dbhAuto = el('div', { class: 'text-xs text-stone-500 my-1' });
  function updateTreeInfo() {
    const t = candidateTrees.find(x => x.id === treeSelect.value);
    if (t) {
      dbhAuto.textContent = `自動帶：${t.speciesZh}，原 DBH ${t.dbh_cm?.toFixed(1) || '?'} cm`;
      const dbhField = f?.querySelector('[name=dbh_at_harvest]');
      if (dbhField && !existing) dbhField.value = t.dbh_cm?.toFixed(1) || '';
    }
  }
  treeSelect.addEventListener('change', updateTreeInfo);

  // 即時碳扣減試算
  const carbonOut = el('div', { class: 'bg-stone-50 rounded p-2 text-xs my-2' });
  function updateCarbonCalc() {
    const fresh = parseFloat(f?.querySelector('[name=harvestAmount_kg_fresh]')?.value);
    let dry = parseFloat(f?.querySelector('[name=harvestAmount_kg_dry]')?.value);
    const moisture = cfg.moistureDefault ?? 0.5;
    if (!isNaN(fresh) && isNaN(dry)) {
      dry = fresh * (1 - moisture);
    }
    if (isNaN(fresh) && isNaN(dry)) { carbonOut.textContent = '輸入鮮重或乾重即時試算碳扣減'; return; }
    const dryEst = !isNaN(dry) ? dry : fresh * (1 - moisture);
    const carbonRemoved_kgC = dryEst * 0.5;  // 碳含量 50%
    const co2_kg = carbonRemoved_kgC * 44 / 12;
    carbonOut.innerHTML =
      `<div>估算乾重 <b>${dryEst.toFixed(2)}</b> kg ${isNaN(dry) ? `（從鮮重×${(1 - moisture).toFixed(2)}）` : ''}</div>` +
      `<div>碳扣減 <b>${(carbonRemoved_kgC / 1000).toFixed(4)}</b> t-C ｜ CO₂ 扣減 <b>${(co2_kg / 1000).toFixed(4)}</b> tCO₂e</div>`;
  }

  // 照片上傳
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '採收照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（採前 / 採後 / 產品 至少一張）'));

  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field' },
      el('label', {}, '採收個體 ', el('span', { class: 'req' }, '*')),
      treeSelect,
      dbhAuto
    ),
    el('div', { class: 'field-row' },
      field({ label: '採收日期', name: 'harvestDate', type: 'date', required: true,
        value: existing?.harvestDate ? (existing.harvestDate.toDate ? existing.harvestDate.toDate() : new Date(existing.harvestDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound() })
    ),
    el('div', { class: 'field-row' },
      field({ label: '採收部位', name: 'harvestType', required: true,
        options: [
          { value: 'bark', label: '樹皮' },
          { value: 'leaves', label: '嫩葉' },
          { value: 'twigs', label: '嫩枝' },
          { value: 'flowers', label: '花' },
          { value: 'roots', label: '根' },
          { value: 'whole', label: '全株' }
        ], value: existing?.harvestType || 'bark' }),
      field({ label: '採收方式', name: 'harvestMethod', required: true,
        options: [
          { value: 'half-bark', label: '半皮取（保留樹幹存活）' },
          { value: 'ring', label: '環剝' },
          { value: 'leaf-pruning', label: '剪葉' },
          { value: 'branch-pruning', label: '枝條修剪' },
          { value: 'coppice', label: '全砍重萌（萌芽更新）' },
          { value: 'root-dig', label: '挖根' }
        ], value: existing?.harvestMethod || 'half-bark' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '鮮重 (kg)', name: 'harvestAmount_kg_fresh', type: 'number', step: '0.01', min: '0', required: true,
        value: existing?.harvestAmount_kg_fresh ?? '' }),
      field({ label: '乾重 (kg) — 可後補', name: 'harvestAmount_kg_dry', type: 'number', step: '0.01', min: '0',
        value: existing?.harvestAmount_kg_dry ?? '' })
    ),
    field({ label: '採收時 DBH (cm)', name: 'dbh_at_harvest', type: 'number', step: '0.1', min: '0', required: true,
      value: existing?.dbh_at_harvest ?? selectedTree?.dbh_cm ?? '' }),
    carbonOut,
    field({ label: '產品用途', name: 'productUse',
      options: [
        { value: '', label: '— 未指定 —' },
        { value: 'essential-oil', label: '精油' },
        { value: 'powder', label: '桂皮粉 / 香料粉' },
        { value: 'tea', label: '茶飲' },
        { value: 'seedling', label: '種苗' },
        { value: 'medicinal', label: '藥用' },
        { value: 'other', label: '其他' }
      ], value: existing?.productUse || '' }),
    field({ label: '採後植株狀態', name: 'treeStatusAfter', required: true,
      options: [
        { value: 'kept-resprout', label: '存活並重萌（半皮取常見）' },
        { value: 'kept-no-sprout', label: '存活未萌（觀察期）' },
        { value: 'dead', label: '枯死' },
        { value: 'removed', label: '砍除根除（→ 自動 set tree 為 standing-dead）' }
      ], value: existing?.treeStatusAfter || 'kept-resprout' }),
    field({ label: '預計下次回測日期', name: 'nextSurveyDate', type: 'date',
      value: existing?.nextSurveyDate ? (existing.nextSurveyDate.toDate ? existing.nextSurveyDate.toDate() : new Date(existing.nextSurveyDate)).toISOString().slice(0, 10) : '' }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註 / 萌芽情形描述', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'harvest', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  // 即時試算
  f.querySelector('[name=harvestAmount_kg_fresh]').addEventListener('input', updateCarbonCalc);
  f.querySelector('[name=harvestAmount_kg_dry]').addEventListener('input', updateCarbonCalc);
  updateCarbonCalc();
  updateTreeInfo();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張採收照片'); return; }
    const fd = new FormData(f);
    const treeId = fd.get('treeId');
    const tree = candidateTrees.find(t => t.id === treeId);
    const fresh = parseFloat(fd.get('harvestAmount_kg_fresh'));
    let dry = parseFloat(fd.get('harvestAmount_kg_dry'));
    const moisture = cfg.moistureDefault ?? 0.5;
    if (isNaN(dry)) dry = fresh * (1 - moisture);
    const carbonRemoved_kgC = dry * 0.5;
    const carbonRemoved_tCO2e = (carbonRemoved_kgC * 44 / 12) / 1000;

    const treeStatusAfter = fd.get('treeStatusAfter');
    const data = {
      treeId,
      treeNum: tree?.treeNum || existing?.treeNum || null,
      speciesZh: tree?.speciesZh || existing?.speciesZh || null,
      harvestDate: new Date(fd.get('harvestDate')),
      surveyRound: fd.get('surveyRound').trim(),
      harvestType: fd.get('harvestType'),
      harvestMethod: fd.get('harvestMethod'),
      harvestAmount_kg_fresh: fresh,
      harvestAmount_kg_dry: !isNaN(parseFloat(fd.get('harvestAmount_kg_dry'))) ? parseFloat(fd.get('harvestAmount_kg_dry')) : null,
      dryEstimated_kg: dry,                   // 永遠存估算結果
      moistureContent: moisture,
      carbonRemoved_kgC: +carbonRemoved_kgC.toFixed(3),
      carbonRemoved_tCO2e: +carbonRemoved_tCO2e.toFixed(6),
      dbh_at_harvest: parseFloat(fd.get('dbh_at_harvest')),
      productUse: fd.get('productUse') || null,
      treeStatusAfter,
      nextSurveyDate: fd.get('nextSurveyDate') ? new Date(fd.get('nextSurveyDate')) : null,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };

    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'harvest');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `harvest-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      // tree 雙向同步：砍除根除 → 自動 set tree.vitality='standing-dead'
      if (treeStatusAfter === 'removed' && tree) {
        try {
          await fb.updateDoc(
            fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', tree.id),
            {
              vitality: 'standing-dead',
              harvestedAt: data.harvestDate,
              harvestRemovedBy: state.user.uid,
              updatedAt: fb.serverTimestamp()
            }
          );
        } catch (e) { console.warn('tree vitality sync failed:', e.message); }
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : (treeStatusAfter === 'removed' ? '已建立 + tree 已標記枯立' : '已建立（待審核）'));
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false; submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯採收紀錄 #${existing.treeNum}` : '新採收紀錄', f);
}

// ===== Seed Demo Data =====
export async function seedDemoData(project) {
  if (!confirm('將灌入 3 個示範樣區（蓮華池附近虛構座標）+ 約 30 株立木 + 約 20 筆更新。繼續？')) return;
  toast('灌入中...');
  try {
    // 三個示範樣區（蓮華池研究中心附近）
    const demoPlots = [
      { code: `${project.code}-001`, lat: 23.9176, lng: 120.8838, forestUnit: '示範-1', shape: 'circle', area_m2: 500, notes: '柳杉人工林' },
      { code: `${project.code}-002`, lat: 23.9192, lng: 120.8856, forestUnit: '示範-2', shape: 'square', area_m2: 400, notes: '天然闊葉林' },
      { code: `${project.code}-003`, lat: 23.9158, lng: 120.8821, forestUnit: '示範-1', shape: 'circle', area_m2: 500, notes: '混合林' }
    ];
    for (const p of demoPlots) {
      const t97 = wgs84ToTwd97(p.lng, p.lat);
      const plotRef = await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots'), {
        code: p.code,
        forestUnit: p.forestUnit,
        location: new fb.GeoPoint(p.lat, p.lng),
        locationTWD97: { x: t97.x, y: t97.y },
        shape: p.shape,
        area_m2: p.area_m2,
        establishedAt: new Date(),
        notes: p.notes,
        insideBoundary: true,
        createdBy: state.user.uid,
        createdAt: fb.serverTimestamp(),
        updatedAt: fb.serverTimestamp()
      });
      // 每個樣區 8-12 株假立木
      const n = 8 + Math.floor(Math.random() * 5);
      for (let i = 1; i <= n; i++) {
        const sp = SPECIES[Math.floor(Math.random() * 12)];
        const dbh = +(15 + Math.random() * 50).toFixed(1);
        const h = +(8 + Math.random() * 15).toFixed(1);
        const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh: sp.zh, speciesSci: sp.sci });
        const vitOpts = ['healthy', 'healthy', 'healthy', 'weak', 'standing-dead'];
        await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots', plotRef.id, 'trees'), {
          treeNum: i,
          speciesZh: sp.zh, speciesSci: sp.sci, conservationGrade: sp.cons || null,
          dbh_cm: dbh, height_m: h,
          vitality: vitOpts[Math.floor(Math.random() * vitOpts.length)],
          pestSymptoms: Math.random() < 0.2 ? ['葉斑'] : [],
          marking: 'paint',
          ...m,
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
          qaStatus: 'pending'
        });
      }
      // 更新記錄 5-8 筆
      const rn = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < rn; i++) {
        const sp = SPECIES[Math.floor(Math.random() * 12)];
        const hc = ['<30', '30-130', '>130'][Math.floor(Math.random() * 3)];
        await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots', plotRef.id, 'regeneration'), {
          speciesZh: sp.zh, speciesSci: sp.sci,
          heightClass: hc,
          count: Math.floor(Math.random() * 30) + 1,
          competitionCover_pct: Math.floor(Math.random() * 80),
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          qaStatus: 'pending'
        });
      }
    }
    toast('示範資料已灌入！');
  } catch (e) { toast('灌入失敗：' + e.message); }
}
