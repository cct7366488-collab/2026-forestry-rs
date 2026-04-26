// ===== forms.js — v1.5 表單：專案 / 樣區 / 立木 / 更新 / 方法學 / QA / Seed =====

import { fb, $, $$, el, toast, openModal, closeModal, state, calcTreeMetrics, speciesParamsLabel, wgs84ToTwd97, DEFAULT_METHODOLOGY, isPi, isDataManager, isSurveyor, canQA, isLocked } from './app.js';
import { TYPE_CODES, AGENCY_CODES, agenciesByGroup, nextSequence, buildProjectCode } from './code-tables.js?v=1714';

// ===== 內建樹種字典（v1.1：~100 種台灣常見種；v2 對接 species-conservation-lookup 拿全清單）=====
const SPECIES = [
  // 針葉 - 杉科
  { zh: '台灣杉', sci: 'Taiwania cryptomerioides', cons: null },
  { zh: '柳杉', sci: 'Cryptomeria japonica', cons: null },
  { zh: '杉木', sci: 'Cunninghamia lanceolata', cons: null },
  { zh: '香杉', sci: 'Cunninghamia konishii', cons: null },
  // 針葉 - 柏科
  { zh: '紅檜', sci: 'Chamaecyparis formosensis', cons: null },
  { zh: '台灣扁柏', sci: 'Chamaecyparis obtusa var. formosana', cons: null },
  { zh: '台灣肖楠', sci: 'Calocedrus macrolepis var. formosana', cons: null },
  { zh: '玉山圓柏', sci: 'Juniperus squamata', cons: null },
  // 針葉 - 松科
  { zh: '台灣二葉松', sci: 'Pinus taiwanensis', cons: null },
  { zh: '台灣五葉松', sci: 'Pinus morrisonicola', cons: null },
  { zh: '台灣鐵杉', sci: 'Tsuga chinensis var. formosana', cons: null },
  { zh: '台灣冷杉', sci: 'Abies kawakamii', cons: null },
  { zh: '台灣雲杉', sci: 'Picea morrisonicola', cons: null },
  { zh: '濕地松', sci: 'Pinus elliottii', cons: null },
  { zh: '琉球松', sci: 'Pinus luchuensis', cons: null },
  // 針葉 - 紅豆杉科
  { zh: '台灣油杉', sci: 'Keteleeria davidiana var. formosana', cons: 'I' },
  { zh: '台灣穗花杉', sci: 'Amentotaxus formosana', cons: 'I' },
  { zh: '台灣紅豆杉', sci: 'Taxus mairei', cons: 'II' },
  { zh: '蘭嶼羅漢松', sci: 'Podocarpus costalis', cons: 'II' },
  // 闊葉 - 樟科
  { zh: '牛樟', sci: 'Cinnamomum kanehirae', cons: 'II' },
  { zh: '樟樹', sci: 'Cinnamomum camphora', cons: null },
  { zh: '土肉桂', sci: 'Cinnamomum osmophloeum', cons: null },
  { zh: '香桂', sci: 'Cinnamomum subavenium', cons: null },
  { zh: '陰香', sci: 'Cinnamomum burmannii', cons: null },
  { zh: '紅楠', sci: 'Machilus thunbergii', cons: null },
  { zh: '大葉楠', sci: 'Machilus japonica var. kusanoi', cons: null },
  { zh: '香楠', sci: 'Machilus zuihoensis', cons: null },
  // 闊葉 - 殼斗科
  { zh: '青剛櫟', sci: 'Cyclobalanopsis glauca', cons: null },
  { zh: '赤皮', sci: 'Cyclobalanopsis gilva', cons: null },
  { zh: '長尾尖葉櫧', sci: 'Castanopsis cuspidata var. carlesii', cons: null },
  { zh: '印度栲', sci: 'Castanopsis indica', cons: null },
  { zh: '小西氏石櫟', sci: 'Lithocarpus konishii', cons: null },
  { zh: '油葉石櫟', sci: 'Lithocarpus konishii var. lanceolatus', cons: null },
  { zh: '三斗石櫟', sci: 'Pasania hancei', cons: null },
  { zh: '槲櫟', sci: 'Quercus aliena', cons: null },
  // 闊葉 - 木蘭科
  { zh: '烏心石', sci: 'Michelia compressa', cons: null },
  // 闊葉 - 桑科
  { zh: '雀榕', sci: 'Ficus superba var. japonica', cons: null },
  { zh: '榕樹', sci: 'Ficus microcarpa', cons: null },
  { zh: '大葉雀榕', sci: 'Ficus caulocarpa', cons: null },
  { zh: '稜果榕', sci: 'Ficus septica', cons: null },
  { zh: '牛奶榕', sci: 'Ficus erecta var. beecheyana', cons: null },
  // 闊葉 - 楝科
  { zh: '苦楝', sci: 'Melia azedarach', cons: null },
  { zh: '大葉桃花心木', sci: 'Swietenia macrophylla', cons: null },
  { zh: '桃花心木', sci: 'Swietenia mahagoni', cons: null },
  { zh: '紅椿', sci: 'Toona sureni', cons: null },
  { zh: '香椿', sci: 'Toona sinensis', cons: null },
  // 闊葉 - 大戟科
  { zh: '烏桕', sci: 'Sapium sebiferum', cons: null },
  { zh: '茄苳', sci: 'Bischofia javanica', cons: null },
  { zh: '血桐', sci: 'Macaranga tanarius', cons: null },
  { zh: '蟲屎', sci: 'Melanolepis multiglandulosa', cons: null },
  // 闊葉 - 漆樹科
  { zh: '黃連木', sci: 'Pistacia chinensis', cons: null },
  { zh: '羅氏鹽膚木', sci: 'Rhus chinensis var. roxburghii', cons: null },
  { zh: '山漆', sci: 'Rhus succedanea', cons: null },
  // 闊葉 - 楓樹科
  { zh: '青楓', sci: 'Acer serrulatum', cons: null },
  { zh: '樟葉楓', sci: 'Acer albopurpurascens', cons: null },
  { zh: '尖葉槭', sci: 'Acer kawakamii', cons: null },
  { zh: '台灣三角楓', sci: 'Acer buergerianum var. formosanum', cons: null },
  // 闊葉 - 榆科
  { zh: '櫸木', sci: 'Zelkova serrata', cons: null },
  { zh: '台灣櫸', sci: 'Zelkova serrata var. tarokoensis', cons: null },
  { zh: '山黃麻', sci: 'Trema orientalis', cons: null },
  { zh: '朴樹', sci: 'Celtis sinensis', cons: null },
  { zh: '沙朴', sci: 'Celtis formosana', cons: null },
  // 闊葉 - 樺木科 / 桃金孃科
  { zh: '台灣赤楊', sci: 'Alnus formosana', cons: null },
  { zh: '台灣赤楠', sci: 'Syzygium formosanum', cons: null },
  { zh: '賽赤楠', sci: 'Syzygium tetragonum', cons: null },
  { zh: '蓮霧', sci: 'Syzygium samarangense', cons: null },
  // 闊葉 - 蝶形花科
  { zh: '相思樹', sci: 'Acacia confusa', cons: null },
  { zh: '大葉合歡', sci: 'Albizia lebbeck', cons: null },
  { zh: '印度紫檀', sci: 'Pterocarpus indicus', cons: null },
  { zh: '大葉相思', sci: 'Acacia mangium', cons: null },
  // 闊葉 - 木麻黃科 / 桉樹
  { zh: '木麻黃', sci: 'Casuarina equisetifolia', cons: null },
  { zh: '桉樹', sci: 'Eucalyptus robusta', cons: null },
  { zh: '檸檬桉', sci: 'Corymbia citriodora', cons: null },
  // 闊葉 - 杜英科 / 五加科 / 山茶科
  { zh: '猴歡喜', sci: 'Sloanea formosana', cons: null },
  { zh: '杜英', sci: 'Elaeocarpus sylvestris', cons: null },
  { zh: '鵝掌柴', sci: 'Schefflera octophylla', cons: null },
  { zh: '木荷', sci: 'Schima superba', cons: null },
  { zh: '油茶', sci: 'Camellia oleifera', cons: null },
  // 闊葉 - 安息香 / 千屈菜 / 金縷梅 / 木犀
  { zh: '烏皮九芎', sci: 'Styrax suberifolia', cons: null },
  { zh: '紅皮', sci: 'Styrax tonkinensis', cons: null },
  { zh: '九芎', sci: 'Lagerstroemia subcostata', cons: null },
  { zh: '大花紫薇', sci: 'Lagerstroemia speciosa', cons: null },
  { zh: '楓香', sci: 'Liquidambar formosana', cons: null },
  { zh: '光蠟樹', sci: 'Fraxinus formosana', cons: null },
  { zh: '小葉白蠟樹', sci: 'Fraxinus floribunda', cons: null },
  // 闊葉 - 無患子 / 山欖 / 紫葳 / 海桐
  { zh: '無患子', sci: 'Sapindus mukorossi', cons: null },
  { zh: '台灣欒樹', sci: 'Koelreuteria henryi', cons: null },
  { zh: '荔枝', sci: 'Litchi chinensis', cons: null },
  { zh: '龍眼', sci: 'Dimocarpus longan', cons: null },
  { zh: '山欖', sci: 'Planchonella obovata', cons: null },
  { zh: '黃花風鈴木', sci: 'Tabebuia chrysantha', cons: null },
  { zh: '藍花楹', sci: 'Jacaranda mimosifolia', cons: null },
  { zh: '台灣海桐', sci: 'Pittosporum pentandrum', cons: null },
  // 紅樹林
  { zh: '海茄苳', sci: 'Avicennia marina', cons: null },
  { zh: '紅海欖', sci: 'Rhizophora stylosa', cons: null },
  { zh: '水筆仔', sci: 'Kandelia obovata', cons: null },
  { zh: '欖李', sci: 'Lumnitzera racemosa', cons: null },
  // 經濟果樹
  { zh: '芒果', sci: 'Mangifera indica', cons: null }
];

const PEST_OPTIONS = ['葉斑', '潰瘍', '蟲孔', '空洞', '菌害', '枯梢', '無'];

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
    el('div', { class: 'field' },
      el('label', {}, '強制必填欄位'),
      el('div', { class: 'flex flex-wrap gap-3 text-sm' },
        ...['photos', 'branchHeight', 'pestSymptoms'].map(k => el('label', { class: 'flex items-center gap-1 whitespace-nowrap' },
          el('input', { type: 'checkbox', name: `req_${k}`, ...(m.required?.[k] ? { checked: 'true' } : {}) }),
          { photos: '照片', branchHeight: '枝下高', pestSymptoms: '病蟲害' }[k]
        ))
      )
    ),
    el('div', { class: 'field' },
      el('label', {}, '啟用模組'),
      el('div', { class: 'flex flex-wrap gap-3 text-sm' },
        ...['plot', 'tree', 'regeneration'].map(k => el('label', { class: 'flex items-center gap-1 whitespace-nowrap' },
          el('input', { type: 'checkbox', name: `mod_${k}`, ...(m.modules?.[k] !== false ? { checked: 'true' } : {}) }),
          { plot: '永久樣區', tree: '立木', regeneration: '自然更新' }[k]
        ))
      )
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
      required: {
        photos: fd.get('req_photos') === 'on',
        branchHeight: fd.get('req_branchHeight') === 'on',
        pestSymptoms: fd.get('req_pestSymptoms') === 'on'
      },
      modules: {
        plot: fd.get('mod_plot') === 'on',
        tree: fd.get('mod_tree') === 'on',
        regeneration: fd.get('mod_regeneration') === 'on',
        understory: false, soil: false, disturbance: false
      },
      description: fd.get('description').trim()
    };
    try {
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), { methodology: newM });
      project.methodology = newM;
      state.project.methodology = newM;
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
export async function markQA(project, plotId, subDoc, status) {
  const labels = { verified: '通過', flagged: '退回修正', rejected: '駁回' };
  const comment = status === 'verified' ? '' : (prompt(`為什麼${labels[status]}？（簡短說明）`) || '');
  if (status !== 'verified' && !comment.trim()) { toast('需填寫原因'); return; }
  try {
    const ref = subDoc
      ? fb.doc(fb.db, 'projects', project.id, 'plots', plotId, subDoc.coll, subDoc.id)
      : fb.doc(fb.db, 'projects', project.id, 'plots', plotId);
    await fb.updateDoc(ref, {
      qaStatus: status,
      qaMarkedBy: state.user.uid,
      qaMarkedAt: fb.serverTimestamp(),
      qaComment: comment
    });
    toast(`已標記為 ${status}`);
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

  const gpsBtn = el('button', { type: 'button', class: 'gps-btn' }, '📍 抓取 GPS');
  const gpsStatus = el('span', { class: 'text-xs text-stone-600 ml-2' }, loc ? `WGS84: ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : '尚未定位');
  const lngInput = el('input', { type: 'hidden', name: 'lng', value: loc?.longitude || '' });
  const latInput = el('input', { type: 'hidden', name: 'lat', value: loc?.latitude || '' });
  const accInput = el('input', { type: 'hidden', name: 'accuracy', value: existing?.locationAccuracy_m || '' });

  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { toast('此裝置不支援 GPS'); return; }
    gpsBtn.disabled = true;
    gpsBtn.textContent = '⏳ 定位中...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude, accuracy } = pos.coords;
        lngInput.value = longitude;
        latInput.value = latitude;
        accInput.value = accuracy;
        const t = wgs84ToTwd97(longitude, latitude);
        gpsStatus.innerHTML = `WGS84: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}<br>TWD97: (${t.x}, ${t.y}) ｜ ±${Math.round(accuracy)}m`;
        gpsBtn.disabled = false;
        gpsBtn.textContent = '📍 重新定位';
      },
      (err) => {
        toast('GPS 失敗：' + err.message);
        gpsBtn.disabled = false;
        gpsBtn.textContent = '📍 抓取 GPS';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
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
        applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId), data);
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
function applySurveyorReQaReset(data, existing) {
  if (!existing) return;
  if (existing.createdBy !== state.user.uid) return;
  if (!['flagged', 'rejected'].includes(existing.qaStatus)) return;
  data.qaStatus = 'pending';
  data.qaMarkedBy = null;
  data.qaMarkedAt = null;
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
export function openTreeForm(project, plot, existing = null) {
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

  const f = el('form', { class: 'space-y-2' },
    speciesList,
    field({ label: '個體編號', name: 'treeNum', type: 'number', step: '1', min: '1', required: true,
      value: existing?.treeNum ?? '' }),
    el('div', { class: 'field' },
      el('label', {}, '樹種 ', el('span', { class: 'req' }, '*')),
      speciesInput,
      consWarn
    ),
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
    const data = {
      treeNum: parseInt(fd.get('treeNum'), 10),
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
        applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, treeId), data);
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
  openModal(existing ? `編輯立木 #${existing.treeNum}` : '新立木', f);
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
        applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, existing.id), data);
        toast(data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新');
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
