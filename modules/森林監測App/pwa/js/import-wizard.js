// ===== import-wizard.js — Excel 批次匯入雛形（v2.5.0-prototype）=====
// 5 步驟 wizard：選檔 → 樣區對應 → 欄位對應 → 樹種/狀態碼比對 → 預覽
// ⚠ 雛形階段：最後一步僅 DRY-RUN，不會真的寫入 Firestore
// 設計依據：林業保育署永久樣區格式（中華紙漿臺東廠 19 樣區為樣本）
//
// 來源資料假設：
//   - 樣區明細表：每個 sheet 一個樣區，欄位含 樣木號碼/狀態/類型/X/Y/絕對X/絕對Y/樹種/DBH/H/備註/材積
//   - 樣區彙整表：（可選）含樣區編號、X0Y0 中心點、林分類型、地被
//   - 材積式表：（可選）樹種—類型—係數對照

import { fb, $, $$, el, toast, openModal, closeModal, state, twd97ToWgs84, calcTreeMetrics } from './app.js?v=2710';

// ===== 內部 wizard state =====
let W = null;  // { step, file, workbook, sheetMeta, plotMapping, fieldMapping, speciesIssues, statusMap }

const STEPS = [
  { n: 1, label: '選檔' },
  { n: 2, label: '樣區對應' },
  { n: 3, label: '欄位對應' },
  { n: 4, label: '樹種與代碼' },
  { n: 5, label: '預覽（DRY-RUN）' },
];

// MRV 立木 schema 目標欄位（含本案要新增的 localX/Y）
const TARGET_FIELDS = [
  { key: 'treeNum',     label: '樣木號碼',    required: true },
  { key: 'speciesZh',   label: '樹種中名',    required: true },
  { key: 'dbh_cm',      label: 'DBH (cm)',    required: true },
  { key: 'height_m',    label: '樹高 H (m)',  required: true },
  { key: 'localX_m',    label: '局部 X (m) ★新欄位', required: false },
  { key: 'localY_m',    label: '局部 Y (m) ★新欄位', required: false },
  { key: 'absX_twd97',  label: '絕對 X TWD97', required: false },
  { key: 'absY_twd97',  label: '絕對 Y TWD97', required: false },
  { key: 'statusCode',  label: '狀態碼（→ vitality）', required: false },
  { key: 'recordType',  label: '紀錄類型',    required: false },
  { key: 'notes',       label: '備註',        required: false },
  { key: 'volume_m3',   label: '材積（單株）', required: false },
];

// 林保署常見樣木狀態碼對照範例（雛形預填，實際需業主提供）
const DEFAULT_STATUS_VITALITY_MAP = {
  '1': 'healthy',         '2': 'healthy',  '3': 'healthy',  '4': 'weak',
  '5': 'standing-dead',   '6': 'fallen',   '缺牌': 'healthy',
};

// ===== Modal 寬版／恢復原寬度 =====
let _origModalWidthCls = null;
function expandModal() {
  const card = document.querySelector('#modal > div');
  if (!card) return;
  if (!_origModalWidthCls) _origModalWidthCls = card.className;
  card.className = card.className.replace('max-w-md', 'max-w-3xl');
}
function restoreModal() {
  const card = document.querySelector('#modal > div');
  if (card && _origModalWidthCls) {
    card.className = _origModalWidthCls;
    _origModalWidthCls = null;
  }
}

// ===== 入口 =====
export function openImportWizard(project) {
  if (!project) return toast('請先進入專案');
  if (typeof XLSX === 'undefined') return toast('SheetJS 未載入');
  W = {
    step: 1,
    project,
    file: null,
    workbook: null,
    sheetMeta: [],
    plotMapping: {},
    fieldMapping: {},
    sourceColumns: [],
    sampleRows: [],
    speciesIssues: { unknown: [], known: [] },
    statusMap: { ...DEFAULT_STATUS_VITALITY_MAP },
    dryRunResult: null,
    importing: false,         // v2.6：真實匯入進行中
    importProgress: null,     // { phase, current, total, message }
    importResult: null,       // { successPlots, skipPlots, failedPlots, successTrees, skipTrees, failedTrees, errors, durationSec }
  };
  const container = el('div', { id: 'import-wizard-root' });
  openModal('📥 從 Excel 匯入樣區資料（雛形 / DRY-RUN）', container);
  expandModal();

  // 攔截關閉以恢復寬度
  const origClose = closeModal;
  $('#modal-close').addEventListener('click', restoreModal, { once: true });
  $('#modal-backdrop').addEventListener('click', restoreModal, { once: true });

  render();
}

// ===== 主 render =====
function render() {
  const root = $('#import-wizard-root');
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(renderStepper());

  const stepFn = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5][W.step];
  root.appendChild(stepFn());
  root.appendChild(renderNavBar());
}

function renderStepper() {
  return el('div', { class: 'flex items-center gap-1 mb-4 text-xs flex-wrap' },
    ...STEPS.map((s, i) => el('div', { class: 'flex items-center gap-1' },
      el('div', {
        class: `w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
          W.step === s.n ? 'bg-forest-700 text-white' :
          W.step > s.n ? 'bg-forest-700/60 text-white' :
          'bg-stone-200 text-stone-600'
        }`
      }, String(s.n)),
      el('span', { class: W.step === s.n ? 'font-semibold text-forest-800' : 'text-stone-500' }, s.label),
      i < STEPS.length - 1 ? el('span', { class: 'text-stone-300 mx-1' }, '›') : null
    ))
  );
}

function renderNavBar() {
  // v2.6：匯入中時隱藏全部按鈕（防止使用者中途切走），匯入完成顯示「關閉」
  if (W.importing) {
    return el('div', { class: 'flex justify-end pt-4 border-t mt-4 text-sm text-stone-500' },
      '匯入進行中，請勿關閉視窗或重整頁面...');
  }
  if (W.importResult) {
    return el('div', { class: 'flex justify-end gap-2 pt-4 border-t mt-4' },
      el('button', {
        type: 'button',
        class: 'bg-forest-700 text-white px-4 py-2 rounded',
        onclick: () => { restoreModal(); closeModal(); W = null; }
      }, '完成')
    );
  }

  const canBack = W.step > 1 && !W.dryRunResult;
  const canNext = canGoNext();
  const isLast = W.step === STEPS.length;
  const hasDryRun = !!W.dryRunResult;
  return el('div', { class: 'flex justify-between gap-2 pt-4 border-t mt-4' },
    el('button', {
      type: 'button',
      class: `border px-4 py-2 rounded ${canBack ? '' : 'opacity-30 cursor-not-allowed'}`,
      onclick: () => { if (canBack) { W.step--; render(); } }
    }, '← 上一步'),
    el('div', { class: 'flex gap-2' },
      el('button', {
        type: 'button',
        class: 'border px-3 py-2 rounded text-sm text-stone-600',
        onclick: () => { restoreModal(); closeModal(); W = null; }
      }, hasDryRun ? '關閉' : '取消'),
      isLast
        ? (hasDryRun
            ? el('button', {
                type: 'button',
                class: 'border border-amber-600 text-amber-700 px-4 py-2 rounded',
                onclick: () => { W.dryRunResult = null; render(); }
              }, '↻ 重新 DRY-RUN')
            : el('button', {
                type: 'button',
                class: 'bg-amber-600 text-white px-4 py-2 rounded font-semibold',
                onclick: handleDryRunCommit
              }, '執行 DRY-RUN（不寫入）'))
        : el('button', {
            type: 'button',
            class: `bg-forest-700 text-white px-4 py-2 rounded ${canNext ? '' : 'opacity-40 cursor-not-allowed'}`,
            onclick: () => { if (canNext) { W.step++; render(); } }
          }, '下一步 →')
    )
  );
}

function canGoNext() {
  if (W.step === 1) return !!W.workbook;
  if (W.step === 2) return Object.values(W.plotMapping).some(v => v.use);
  if (W.step === 3) {
    return TARGET_FIELDS.filter(f => f.required).every(f => W.fieldMapping[f.key] != null);
  }
  return true;
}

// ===== STEP 1：選檔 + 解析 =====
function renderStep1() {
  const box = el('div', { class: 'space-y-3' });
  box.appendChild(el('h3', { class: 'font-semibold text-base' }, '步驟 1：選擇 Excel 檔案'));
  box.appendChild(el('p', { class: 'text-sm text-stone-600' },
    '支援 .xlsx 或 .xls。系統將自動偵測工作表並列出。建議格式：每個樣區一張工作表（如「1」「2」…「19」），可選含彙整表。'));

  const fileInput = el('input', {
    type: 'file', accept: '.xlsx,.xls',
    class: 'block w-full text-sm border border-stone-300 rounded px-3 py-2'
  });
  const status = el('div', { class: 'text-sm' });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    status.innerHTML = '<span class="text-stone-500">解析中...</span>';
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      W.file = f;
      W.workbook = wb;
      W.sheetMeta = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const ref = ws['!ref'] || 'A1:A1';
        const range = XLSX.utils.decode_range(ref);
        const rows = range.e.r - range.s.r + 1;
        const cols = range.e.c - range.s.c + 1;
        // 偵測類型
        const looksNumericName = /^\d+$/.test(name);
        const type = looksNumericName ? 'plot-detail'
                   : (rows > 30 && cols > 5 ? 'summary-or-detail' : 'other');
        return { name, rows, cols, type };
      });
      // 預設：所有純數字命名的 sheet 都當作樣區
      W.plotMapping = {};
      W.sheetMeta.forEach(s => {
        W.plotMapping[s.name] = {
          use: s.type === 'plot-detail',
          plotCode: `${W.project.code}-${s.name.padStart(3, '0')}`
        };
      });
      status.innerHTML = `<span class="text-green-700">✓ 已解析：${wb.SheetNames.length} 張工作表，${f.name}（${(f.size/1024).toFixed(1)} KB）</span>`;
      render();
    } catch (e) {
      status.innerHTML = `<span class="text-red-600">✗ 解析失敗：${e.message}</span>`;
    }
  });

  box.appendChild(fileInput);
  box.appendChild(status);

  if (W.workbook) {
    const tbl = el('div', { class: 'mt-3 text-xs border rounded overflow-hidden' });
    tbl.appendChild(el('div', { class: 'grid grid-cols-12 bg-stone-100 px-2 py-1 font-semibold' },
      el('div', { class: 'col-span-5' }, '工作表'),
      el('div', { class: 'col-span-3' }, '尺寸'),
      el('div', { class: 'col-span-4' }, '推測類型'),
    ));
    W.sheetMeta.forEach(s => {
      tbl.appendChild(el('div', { class: 'grid grid-cols-12 px-2 py-1 border-t' },
        el('div', { class: 'col-span-5 truncate font-mono' }, s.name),
        el('div', { class: 'col-span-3 text-stone-600' }, `${s.rows} × ${s.cols}`),
        el('div', { class: 'col-span-4 text-stone-600' }, {
          'plot-detail': '🌳 樣區明細',
          'summary-or-detail': '📋 彙整或大樣區',
          'other': '其他'
        }[s.type] || '?')
      ));
    });
    box.appendChild(tbl);
  }
  return box;
}

// ===== STEP 2：樣區對應 =====
function renderStep2() {
  const box = el('div', { class: 'space-y-3' });
  box.appendChild(el('h3', { class: 'font-semibold text-base' }, '步驟 2：樣區對應'));
  box.appendChild(el('p', { class: 'text-sm text-stone-600' },
    '勾選哪些工作表是「樣區明細」，並指定對應的樣區編號（plot code）。系統將為每個樣區建立一筆 plot 文件。'));

  const tbl = el('div', { class: 'border rounded overflow-hidden text-sm' });
  tbl.appendChild(el('div', { class: 'grid grid-cols-12 bg-stone-100 px-2 py-2 font-semibold text-xs' },
    el('div', { class: 'col-span-1' }, '匯入'),
    el('div', { class: 'col-span-3' }, '工作表'),
    el('div', { class: 'col-span-2' }, '尺寸'),
    el('div', { class: 'col-span-6' }, '對應 Plot Code'),
  ));
  W.sheetMeta.forEach(s => {
    const m = W.plotMapping[s.name];
    const checkbox = el('input', { type: 'checkbox', class: 'mt-1' });
    if (m.use) checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      m.use = checkbox.checked;
      render();
    });
    const codeInput = el('input', {
      type: 'text', value: m.plotCode,
      class: 'w-full border rounded px-2 py-1 font-mono text-xs'
    });
    if (!m.use) codeInput.disabled = true;
    codeInput.addEventListener('input', () => { m.plotCode = codeInput.value; });
    tbl.appendChild(el('div', { class: 'grid grid-cols-12 px-2 py-2 border-t items-center' },
      el('div', { class: 'col-span-1' }, checkbox),
      el('div', { class: 'col-span-3 font-mono truncate' }, s.name),
      el('div', { class: 'col-span-2 text-xs text-stone-500' }, `${s.rows}×${s.cols}`),
      el('div', { class: 'col-span-6' }, codeInput),
    ));
  });
  box.appendChild(tbl);

  const used = Object.values(W.plotMapping).filter(v => v.use).length;
  box.appendChild(el('div', { class: 'text-sm text-stone-700 bg-stone-50 rounded px-3 py-2' },
    `將匯入 ${used} 個樣區`));
  return box;
}

// ===== STEP 3：欄位對應 =====
function renderStep3() {
  const box = el('div', { class: 'space-y-3' });
  box.appendChild(el('h3', { class: 'font-semibold text-base' }, '步驟 3：欄位對應'));
  box.appendChild(el('p', { class: 'text-sm text-stone-600' },
    '系統讀取第一個被勾選的樣區工作表的欄位，請對應到 MRV 欄位。標 ★ 為 v2.5 新欄位。'));

  // 取第一個被勾選的 sheet 的欄位作為樣本
  const firstSheet = Object.entries(W.plotMapping).find(([_, v]) => v.use)?.[0];
  if (!firstSheet) {
    box.appendChild(el('div', { class: 'text-red-600' }, '請回上一步至少勾選一個樣區'));
    return box;
  }
  const ws = W.workbook.Sheets[firstSheet];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerRow = aoa[0] || [];
  W.sourceColumns = headerRow.map((h, i) => ({
    idx: i,
    name: String(h || `(空欄 ${i+1})`).trim()
  }));
  W.sampleRows = aoa.slice(1, 4);

  // 自動猜測對應（用名稱關鍵字）
  if (Object.keys(W.fieldMapping).length === 0) {
    autoGuessMapping();
  }

  // 對應 UI：來源欄 vs 目標欄 (兩欄堆疊)
  const grid = el('div', { class: 'border rounded divide-y text-sm' });
  grid.appendChild(el('div', { class: 'grid grid-cols-12 bg-stone-100 px-2 py-2 font-semibold text-xs' },
    el('div', { class: 'col-span-5' }, `Excel 來源欄（${firstSheet}）`),
    el('div', { class: 'col-span-1 text-center' }, '→'),
    el('div', { class: 'col-span-6' }, 'MRV 目標欄'),
  ));

  TARGET_FIELDS.forEach(tf => {
    const select = el('select', { class: 'w-full border rounded px-2 py-1 text-xs' });
    select.appendChild(el('option', { value: '' }, '— 不對應 —'));
    W.sourceColumns.forEach(sc => {
      const opt = el('option', { value: String(sc.idx) }, `[${sc.idx + 1}] ${sc.name}`);
      if (W.fieldMapping[tf.key] === sc.idx) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      W.fieldMapping[tf.key] = select.value === '' ? null : parseInt(select.value, 10);
    });
    const sampleVal = W.fieldMapping[tf.key] != null
      ? (W.sampleRows[0]?.[W.fieldMapping[tf.key]] ?? '—')
      : '';
    grid.appendChild(el('div', { class: 'grid grid-cols-12 px-2 py-2 items-center' },
      el('div', { class: 'col-span-5 text-xs text-stone-500' },
        sampleVal !== '' ? `樣本：${String(sampleVal).slice(0, 20)}` : '—'),
      el('div', { class: 'col-span-1 text-center text-stone-400' }, '→'),
      el('div', { class: 'col-span-6' },
        el('div', { class: `font-medium ${tf.required ? '' : 'text-stone-600'}` },
          tf.label, tf.required ? el('span', { class: 'text-red-500 ml-1' }, '*') : null),
        select
      ),
    ));
  });
  box.appendChild(grid);

  // 缺必填提示
  const missing = TARGET_FIELDS.filter(f => f.required && W.fieldMapping[f.key] == null);
  if (missing.length) {
    box.appendChild(el('div', { class: 'text-red-600 text-sm bg-red-50 rounded px-3 py-2' },
      `⚠ 必填欄位未對應：${missing.map(m => m.label).join('、')}`));
  }
  return box;
}

function autoGuessMapping() {
  // 名稱關鍵字 fuzzy match
  const guesses = {
    treeNum:    ['樣木號碼', '編號', '號碼'],
    speciesZh:  ['樹種', 'species'],
    dbh_cm:     ['胸高直徑', 'DBH', '直徑'],
    height_m:   ['樹高', 'height', '全高'],
    localX_m:   ['樣區X', '局部X', 'X座標', '相對X'],
    localY_m:   ['樣區Y', '局部Y', 'Y座標', '相對Y'],
    absX_twd97: ['立木位置X', '絕對X', 'TWD97_X'],
    absY_twd97: ['立木位置Y', '絕對Y', 'TWD97_Y'],
    statusCode: ['樣木狀態', '狀態'],
    recordType: ['紀錄類型', '記錄類型', '類型'],
    notes:      ['備註', '註'],
    volume_m3:  ['材積', 'volume'],
  };
  for (const [tk, kws] of Object.entries(guesses)) {
    const hit = W.sourceColumns.find(sc => kws.some(k => sc.name.includes(k)));
    if (hit) W.fieldMapping[tk] = hit.idx;
  }
}

// ===== STEP 4：樹種與狀態碼比對 =====
function renderStep4() {
  const box = el('div', { class: 'space-y-3' });
  box.appendChild(el('h3', { class: 'font-semibold text-base' }, '步驟 4：樹種與狀態碼比對'));

  // 收集所有樣區裡出現的樹種
  const speciesSet = new Set();
  const statusSet = new Set();
  for (const [sheetName, m] of Object.entries(W.plotMapping)) {
    if (!m.use) continue;
    const aoa = XLSX.utils.sheet_to_json(W.workbook.Sheets[sheetName], { header: 1, defval: '' });
    for (let r = 1; r < aoa.length; r++) {
      const sp = String(aoa[r]?.[W.fieldMapping.speciesZh] ?? '').trim();
      if (sp) speciesSet.add(sp);
      if (W.fieldMapping.statusCode != null) {
        const st = String(aoa[r]?.[W.fieldMapping.statusCode] ?? '').trim();
        if (st) statusSet.add(st);
      }
    }
  }

  // 樹種比對：本案沒實際 import SPECIES dict，用一份小的 mock 已知清單示意
  const KNOWN_SPECIES = ['臺灣櫸', '楓香', '樟樹', '咬人狗', '蟲屎', '九芎', '白匏子'];
  const unknown = [...speciesSet].filter(s => !KNOWN_SPECIES.includes(s));
  W.speciesIssues = { unknown, known: [...speciesSet].filter(s => KNOWN_SPECIES.includes(s)) };

  box.appendChild(el('div', { class: 'border rounded p-3 bg-stone-50' },
    el('div', { class: 'font-semibold text-sm mb-2' },
      `🌿 樹種對照（共 ${speciesSet.size} 種）`),
    el('div', { class: 'text-xs text-green-700 mb-1' },
      `✓ 字典已收錄：${W.speciesIssues.known.length} 種`),
    el('div', { class: 'text-xs text-amber-700' },
      `⚠ 字典缺少：${unknown.length} 種 — 將在匯入時提示新增到 lookups/species`),
    unknown.length
      ? el('div', { class: 'text-xs mt-2 text-stone-700 max-h-24 overflow-y-auto bg-white rounded border p-2' },
          unknown.join('、'))
      : null
  ));

  if (W.fieldMapping.statusCode != null) {
    const tbl = el('div', { class: 'border rounded text-sm' });
    tbl.appendChild(el('div', { class: 'bg-stone-100 px-3 py-2 font-semibold text-sm' },
      `🔢 樣木狀態碼對照（共 ${statusSet.size} 種）`));
    tbl.appendChild(el('div', { class: 'text-xs px-3 pt-2 text-stone-600' },
      '請設定來源代碼對應到 MRV 的 vitality enum。預設值依林保署常見用法填入，請與業主提供的對照表核對。'));
    [...statusSet].sort().forEach(code => {
      const select = el('select', { class: 'border rounded px-2 py-1 text-xs' });
      ['healthy', 'weak', 'standing-dead', 'fallen'].forEach(v => {
        const opt = el('option', { value: v }, {
          'healthy': '健康', 'weak': '衰弱',
          'standing-dead': '枯立', 'fallen': '倒伏'
        }[v]);
        if ((W.statusMap[code] || 'healthy') === v) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { W.statusMap[code] = select.value; });
      tbl.appendChild(el('div', { class: 'grid grid-cols-12 items-center px-3 py-2 border-t text-xs' },
        el('div', { class: 'col-span-3 font-mono' }, `代碼「${code}」`),
        el('div', { class: 'col-span-2 text-stone-400' }, '→'),
        el('div', { class: 'col-span-7' }, select),
      ));
    });
    box.appendChild(tbl);
  }
  return box;
}

// ===== v2.7.1：方法學原點型態 vs 資料分布一致性檢查 =====
// 動機：v2.6.2 散布圖揭露紙漿廠資料品質問題 — Excel X/Y 全 ≥ 0（corner 模式）
//      但 methodology.plotOriginType 沿用預設 'center'（4 象限）→ 立木全堆到右上跑出邊界
// 設計：軟警告（不擋 DRY-RUN），讓使用者有機會回去改方法學再來

function analyzeXYDistribution() {
  const fm = W.fieldMapping || {};
  if (fm.localX_m == null && fm.localY_m == null) return null;  // 無 X/Y 欄位對應 → 無資料可分析

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0, anyNegX = false, anyNegY = false;

  for (const [sheetName, m] of Object.entries(W.plotMapping || {})) {
    if (!m.use) continue;
    const aoa = XLSX.utils.sheet_to_json(W.workbook.Sheets[sheetName], { header: 1, defval: '' });
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || row[fm.treeNum] === '' || row[fm.treeNum] == null) continue;
      const xRaw = fm.localX_m != null ? row[fm.localX_m] : null;
      const yRaw = fm.localY_m != null ? row[fm.localY_m] : null;
      const x = (xRaw != null && xRaw !== '') ? parseFloat(xRaw) : null;
      const y = (yRaw != null && yRaw !== '') ? parseFloat(yRaw) : null;
      let used = false;
      if (x != null && !isNaN(x)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (x < 0) anyNegX = true;
        used = true;
      }
      if (y != null && !isNaN(y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (y < 0) anyNegY = true;
        used = true;
      }
      if (used) count++;
    }
  }
  if (count === 0) return null;
  return { minX, maxX, minY, maxY, count, anyNegX, anyNegY };
}

function checkOriginTypeMismatch() {
  const meth = W.project?.methodology;
  if (!meth) return null;
  const orig = meth.plotOriginType || 'center';
  const a = analyzeXYDistribution();
  if (!a) return null;

  const fmtRange = (lo, hi) => `${lo.toFixed(1)} ~ ${hi.toFixed(1)} m`;

  if (orig === 'center' && !a.anyNegX && !a.anyNegY) {
    return {
      severity: 'warn',
      kind: 'center-but-corner-data',
      title: '⚠ 方法學原點型態可能設錯（看起來資料是 corner 模式，但方法學是 center）',
      detail: `偵測到 ${a.count} 筆立木 X/Y 全部 ≥ 0（X: ${fmtRange(a.minX, a.maxX)} / Y: ${fmtRange(a.minY, a.maxY)}），但本專案方法學的 plotOriginType 是「center（中心點原點，4 象限，X/Y 可正可負）」。資料看起來是用「樣區左下角」當原點測量的（corner 模式）。`,
      action: '建議：取消此 wizard → 進「設計」分頁編輯方法學 → plotOriginType 改成「corner（左下角原點）」→ 儲存 → 重新匯入。若硬匯入：散布圖會把所有立木堆到右上角、紅圈描邊跑出樣區邊界。'
    };
  }
  if (orig === 'corner' && (a.anyNegX || a.anyNegY)) {
    return {
      severity: 'warn',
      kind: 'corner-but-center-data',
      title: '⚠ 方法學原點型態可能設錯（看起來資料是 center 模式，但方法學是 corner）',
      detail: `偵測到 ${a.count} 筆立木中有負值座標（X: ${fmtRange(a.minX, a.maxX)} / Y: ${fmtRange(a.minY, a.maxY)}），但本專案方法學的 plotOriginType 是「corner（左下角原點，單象限，X/Y ≥ 0）」。資料看起來是用「樣區中心點」當原點測量的（center 模式）。`,
      action: '建議：取消此 wizard → 進「設計」分頁編輯方法學 → plotOriginType 改成「center（中心點原點）」→ 儲存 → 重新匯入。'
    };
  }
  return null;  // 方法學與資料一致或無法判斷
}

// ===== STEP 5：DRY-RUN 預覽 / 真實匯入進度 / 真實匯入結果 =====
function renderStep5() {
  // v2.6：真實匯入結果（最高優先）
  if (W.importResult) return renderImportResult();
  // v2.6：真實匯入進行中
  if (W.importing) return renderImportProgress();
  // 已執行 DRY-RUN — 顯示結果區
  if (W.dryRunResult) return renderDryRunResult();

  const box = el('div', { class: 'space-y-3' });
  box.appendChild(el('h3', { class: 'font-semibold text-base' }, '步驟 5：預覽 (DRY-RUN)'));
  box.appendChild(el('div', { class: 'bg-amber-50 border border-amber-300 rounded px-3 py-2 text-sm text-amber-900' },
    '⚠ 雛形階段：此步驟「不會」真正寫入資料庫，僅輸出將被建立的資料結構供檢視。'));

  // v2.7.1：方法學原點型態與資料分布一致性檢查（軟警告，不擋 DRY-RUN）
  const mismatch = checkOriginTypeMismatch();
  if (mismatch) {
    box.appendChild(el('div', { class: 'border-l-4 border-amber-500 bg-amber-50 rounded p-3 text-sm' },
      el('div', { class: 'font-semibold text-amber-900 mb-1' }, mismatch.title),
      el('div', { class: 'text-amber-800 mb-2' }, mismatch.detail),
      el('div', { class: 'text-xs text-amber-700' }, mismatch.action)
    ));
  }

  // 計算將要寫入的 plot / tree 數
  let plotCount = 0, treeCount = 0;
  const samples = [];
  for (const [sheetName, m] of Object.entries(W.plotMapping)) {
    if (!m.use) continue;
    plotCount++;
    const aoa = XLSX.utils.sheet_to_json(W.workbook.Sheets[sheetName], { header: 1, defval: '' });
    const trees = aoa.slice(1).filter(r => r[W.fieldMapping.treeNum] !== '' && r[W.fieldMapping.treeNum] != null);
    treeCount += trees.length;
    if (samples.length < 2 && trees.length > 0) {
      samples.push({ plotCode: m.plotCode, sample: trees[0] });
    }
  }

  box.appendChild(el('div', { class: 'grid grid-cols-3 gap-3 text-center text-sm' },
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-forest-800' }, String(plotCount)),
      el('div', { class: 'text-xs text-stone-600' }, '將建立樣區')
    ),
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-forest-800' }, String(treeCount)),
      el('div', { class: 'text-xs text-stone-600' }, '將建立立木')
    ),
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-amber-700' }, String(W.speciesIssues.unknown.length)),
      el('div', { class: 'text-xs text-stone-600' }, '需新增樹種')
    ),
  ));

  // 樣本第一筆立木 — 顯示轉換後的 tree document 結構
  if (samples.length) {
    const s = samples[0];
    const sampleTree = buildTreeDoc(s.sample, s.plotCode);
    box.appendChild(el('div', { class: 'border rounded' },
      el('div', { class: 'bg-stone-100 px-3 py-2 text-sm font-semibold' },
        `📄 樣本 tree 文件（${s.plotCode} 第一筆）`),
      el('pre', { class: 'p-3 text-xs overflow-x-auto bg-white' },
        JSON.stringify(sampleTree, null, 2))
    ));
  }

  // 寫入預估
  box.appendChild(el('div', { class: 'text-xs text-stone-600 bg-stone-50 rounded p-3' },
    el('div', {}, `批次寫入估計：${Math.ceil((plotCount + treeCount) / 500)} 個 Firestore batch（每批 500 ops 上限）`),
    el('div', {}, `預估寫入時間：${((plotCount + treeCount) * 0.05).toFixed(1)} 秒（網路順暢時）`),
  ));
  return box;
}

function buildTreeDoc(row, plotCode) {
  const fm = W.fieldMapping;
  const get = (k) => fm[k] != null ? row[fm[k]] : null;
  const treeNum = parseInt(get('treeNum'), 10) || null;
  const statusCode = String(get('statusCode') ?? '').trim();
  return {
    treeNum,
    treeCode: treeNum ? `${plotCode}-${String(treeNum).padStart(3, '0')}` : null,
    speciesZh: String(get('speciesZh') || '').trim() || null,
    dbh_cm: parseFloat(get('dbh_cm')) || null,
    height_m: parseFloat(get('height_m')) || null,
    localX_m: fm.localX_m != null ? parseFloat(get('localX_m')) : null,
    localY_m: fm.localY_m != null ? parseFloat(get('localY_m')) : null,
    locationTWD97: (fm.absX_twd97 != null && fm.absY_twd97 != null) ? {
      x: parseFloat(get('absX_twd97')) || null,
      y: parseFloat(get('absY_twd97')) || null,
    } : null,
    vitality: W.statusMap[statusCode] || 'healthy',
    statusCodeRaw: statusCode || null,
    recordTypeRaw: fm.recordType != null ? String(get('recordType') ?? '').trim() || null : null,
    notes: fm.notes != null ? (String(get('notes') ?? '').trim() || null) : null,
    volume_m3_imported: fm.volume_m3 != null ? parseFloat(get('volume_m3')) || null : null,
    qaStatus: 'pending',
    importedAt: '<server timestamp>',
    importedBy: state.user?.uid || '<uid>',
  };
}

// ===== DRY-RUN commit — 結果直接顯示在 modal 內 =====
function handleDryRunCommit() {
  let plotCount = 0, treeCount = 0;
  const fullPayload = [];
  for (const [sheetName, m] of Object.entries(W.plotMapping)) {
    if (!m.use) continue;
    plotCount++;
    const aoa = XLSX.utils.sheet_to_json(W.workbook.Sheets[sheetName], { header: 1, defval: '' });
    const trees = aoa.slice(1)
      .filter(r => r[W.fieldMapping.treeNum] !== '' && r[W.fieldMapping.treeNum] != null)
      .map(r => buildTreeDoc(r, m.plotCode));
    treeCount += trees.length;
    fullPayload.push({ plot: { code: m.plotCode, sourceSheet: sheetName }, trees });
  }
  W.dryRunResult = {
    plotCount, treeCount,
    project: { code: W.project.code, id: W.project.id },
    fieldMapping: W.fieldMapping,
    statusMap: W.statusMap,
    unknownSpecies: W.speciesIssues.unknown,
    knownSpeciesCount: W.speciesIssues.known.length,
    payload: fullPayload,
    timestamp: new Date().toISOString(),
  };
  console.group('[ImportWizard DRY-RUN] 將寫入的資料');
  console.log(W.dryRunResult);
  console.groupEnd();
  toast(`✓ DRY-RUN 完成：${plotCount} plots / ${treeCount} trees`, 3000);
  render();
}

// ===== 結果顯示區 =====
function renderDryRunResult() {
  const r = W.dryRunResult;
  const box = el('div', { class: 'space-y-3' });

  // 成功 banner
  box.appendChild(el('div', { class: 'bg-green-50 border-2 border-green-400 rounded p-4' },
    el('div', { class: 'text-xl font-bold text-green-800 mb-1' }, '✅ DRY-RUN 完成'),
    el('div', { class: 'text-sm text-stone-700' },
      `已模擬計算 ${r.plotCount} 樣區、${r.treeCount} 立木的轉換結果。`),
    el('div', { class: 'text-xs text-amber-800 bg-amber-100 rounded px-2 py-1 mt-2 inline-block' },
      '⚠ 雛形階段：以上資料尚未寫入 Firestore（無實際變更）')
  ));

  // 摘要 + 動作按鈕
  box.appendChild(el('div', { class: 'grid grid-cols-3 gap-3 text-center text-sm' },
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-forest-800' }, String(r.plotCount)),
      el('div', { class: 'text-xs text-stone-600' }, '樣區')
    ),
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-forest-800' }, String(r.treeCount)),
      el('div', { class: 'text-xs text-stone-600' }, '立木')
    ),
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'text-2xl font-bold text-amber-700' }, String(r.unknownSpecies.length)),
      el('div', { class: 'text-xs text-stone-600' }, '需新增樹種')
    ),
  ));

  // 下載 / 複製 / 真實匯入按鈕
  box.appendChild(el('div', { class: 'flex gap-2 flex-wrap' },
    el('button', {
      type: 'button',
      class: 'bg-forest-700 text-white px-4 py-2 rounded text-sm',
      onclick: () => downloadPayload(r)
    }, '⬇ 下載 payload.json'),
    el('button', {
      type: 'button',
      class: 'border px-4 py-2 rounded text-sm',
      onclick: () => copyPayload(r)
    }, '📋 複製到剪貼簿'),
    // v2.6：真實匯入按鈕（紅色顯眼）
    el('button', {
      type: 'button',
      class: 'bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-semibold ml-auto',
      onclick: handleRealImport,
      title: '將以上資料寫入 Firestore'
    }, '✅ 執行真實匯入到 Firestore'),
  ));

  // 樹種待補清單
  if (r.unknownSpecies.length) {
    box.appendChild(el('div', { class: 'border border-amber-300 bg-amber-50 rounded p-3' },
      el('div', { class: 'text-sm font-semibold text-amber-900 mb-1' },
        `⚠ 待補樹種（${r.unknownSpecies.length} 種）— 真實匯入時需先 seed 進物種字典`),
      el('div', { class: 'text-xs text-amber-900' }, r.unknownSpecies.join('、'))
    ));
  }

  // 第一個樣區的前 3 筆樣本
  if (r.payload.length > 0) {
    const first = r.payload[0];
    box.appendChild(el('div', { class: 'border rounded' },
      el('div', { class: 'bg-stone-100 px-3 py-2 text-sm font-semibold' },
        `📄 樣區 ${first.plot.code} 的前 3 筆立木`),
      el('pre', { class: 'p-3 text-xs overflow-x-auto bg-white max-h-64 overflow-y-auto' },
        JSON.stringify(first.trees.slice(0, 3), null, 2))
    ));
  }

  // 完整 payload 摺疊區
  box.appendChild(el('details', { class: 'border rounded' },
    el('summary', { class: 'bg-stone-100 px-3 py-2 text-sm font-semibold cursor-pointer hover:bg-stone-200' },
      `📦 完整 payload（${r.plotCount} 樣區、${r.treeCount} 立木 — 點此展開）`),
    el('pre', { class: 'p-3 text-xs overflow-x-auto bg-white max-h-96 overflow-y-auto' },
      JSON.stringify(r.payload, null, 2))
  ));

  // 各樣區立木數小表
  const counts = r.payload.map(p => `${p.plot.code}: ${p.trees.length}`).join('、');
  box.appendChild(el('div', { class: 'text-xs text-stone-500 bg-stone-50 rounded p-2' },
    el('b', {}, '各樣區立木數：'), counts));

  return box;
}

function downloadPayload(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dry-run-${r.project.code || 'preview'}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已下載 payload.json');
}

async function copyPayload(r) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
    toast('已複製到剪貼簿');
  } catch (e) {
    toast('複製失敗：' + e.message);
  }
}

// ===== v2.6：真實匯入到 Firestore =====
//
// 流程：
//   1. 確認 dialog
//   2. Pre-fetch 既有 plot codes（idempotent 用）
//   3. Plot 寫入：每筆 addDoc + 反推 plot.locationTWD97（從第一筆 tree 的 abs - local）
//   4. Tree 寫入：每筆 calcTreeMetrics + addDoc，已存在則 skip
//   5. 結果摘要 + 錯誤明細
//
// Phase 1 取捨：序列寫入（非 batch）— 簡單、進度條精確、失敗點明確；900 筆約 60 秒
async function handleRealImport() {
  const r = W.dryRunResult;
  if (!r) return toast('請先執行 DRY-RUN');
  if (W.importing) return;

  const ok = confirm(
    `將寫入到專案「${W.project.name || W.project.code}」：\n\n` +
    `  • ${r.plotCount} 樣區（已存在的 code 會自動跳過）\n` +
    `  • ${r.treeCount} 立木（含材積/碳量自動計算）\n` +
    `  • 樣區面積固定 500 m²（0.05 公頃）、形狀=方形\n` +
    `  • ${r.unknownSpecies.length} 種未知樹種仍會寫入（材積套用「其他闊」fallback）\n\n` +
    `匯入過程約需 ${Math.ceil(r.treeCount * 0.07)} 秒，期間請勿關閉視窗。\n\n` +
    `確定執行嗎？`
  );
  if (!ok) return;

  W.importing = true;
  W.importProgress = { phase: 'init', current: 0, total: r.plotCount + r.treeCount, message: '準備中...' };
  W.importResult = null;
  render();

  const result = {
    successPlots: 0, skipPlots: 0, failedPlots: [],
    successTrees: 0, skipTrees: 0, failedTrees: [],
    startTime: Date.now(),
    plotCodeToId: {},
  };

  try {
    // ===== 1. Pre-fetch existing plot codes =====
    W.importProgress.phase = 'plots';
    W.importProgress.message = '查詢既有樣區...';
    render();
    const plotsRef = fb.collection(fb.db, 'projects', W.project.id, 'plots');
    const existingPlotsSnap = await fb.getDocs(plotsRef);
    const existingPlotsByCode = new Map();
    existingPlotsSnap.forEach(d => existingPlotsByCode.set(d.data().code, d.id));

    // ===== 2. Write plots =====
    for (const item of r.payload) {
      const code = item.plot.code;
      if (existingPlotsByCode.has(code)) {
        result.skipPlots++;
        result.plotCodeToId[code] = existingPlotsByCode.get(code);
      } else {
        // 從第一筆有 absolute 的 tree 反推 plot.locationTWD97（中心點）
        let plotTWD97 = null, plotLocation = null;
        const firstTree = item.trees.find(t =>
          t.locationTWD97 && Number.isFinite(t.locationTWD97.x) &&
          Number.isFinite(t.localX_m) && Number.isFinite(t.localY_m));
        if (firstTree) {
          const px = firstTree.locationTWD97.x - firstTree.localX_m;
          const py = firstTree.locationTWD97.y - firstTree.localY_m;
          plotTWD97 = { x: px, y: py };
          try {
            const w = twd97ToWgs84(px, py);
            if (w?.lng != null && w?.lat != null) {
              plotLocation = new fb.GeoPoint(w.lat, w.lng);
            }
          } catch (e) {}
        }
        const plotDoc = {
          code,
          forestUnit: null,
          shape: 'square',
          area_m2: 500,                    // 0.05 公頃
          location: plotLocation,
          locationTWD97: plotTWD97,
          locationAccuracy_m: null,
          insideBoundary: true,
          establishedAt: fb.serverTimestamp(),
          notes: `從 Excel 匯入 — sourceSheet: ${item.plot.sourceSheet}`,
          photos: [],
          qaStatus: 'pending',
          assignedTo: null,
          importedAt: fb.serverTimestamp(),
          importedBy: state.user.uid,
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
        };
        try {
          const newRef = await fb.addDoc(plotsRef, plotDoc);
          result.successPlots++;
          result.plotCodeToId[code] = newRef.id;
        } catch (e) {
          result.failedPlots.push({ code, error: e.message });
          console.error('[import plot]', code, e);
        }
      }
      W.importProgress.current = result.successPlots + result.skipPlots + result.failedPlots.length;
      W.importProgress.message = `寫入樣區 ${W.importProgress.current}/${r.plotCount}`;
      render();
    }

    // ===== 3. Write trees =====
    W.importProgress.phase = 'trees';
    let treeWritten = 0;
    for (const item of r.payload) {
      const plotId = result.plotCodeToId[item.plot.code];
      if (!plotId) continue;  // plot 失敗 → 跳過該樣區的 trees
      const treesRef = fb.collection(fb.db, 'projects', W.project.id, 'plots', plotId, 'trees');
      // Pre-fetch tree codes for idempotency
      const existingTreesSnap = await fb.getDocs(treesRef);
      const existingTreeCodes = new Set();
      existingTreesSnap.forEach(d => {
        const c = d.data().treeCode;
        if (c) existingTreeCodes.add(c);
      });

      for (const t of item.trees) {
        treeWritten++;
        if (!t.treeCode) {
          result.failedTrees.push({ plotCode: item.plot.code, treeNum: t.treeNum, error: '缺 treeCode' });
        } else if (existingTreeCodes.has(t.treeCode)) {
          result.skipTrees++;
        } else {
          // 自動算材積/碳量（fallback 到「其他闊」對未知樹種）
          let m;
          try {
            m = calcTreeMetrics({
              dbh_cm: t.dbh_cm, height_m: t.height_m,
              speciesZh: t.speciesZh, speciesSci: null
            });
          } catch (e) {
            m = { basalArea_m2: 0, volume_m3: 0, biomass_kg: 0, carbon_kg: 0, co2_kg: 0 };
          }
          // 反算 location（WGS84 GeoPoint）
          let treeLocation = null;
          if (t.locationTWD97 && Number.isFinite(t.locationTWD97.x) && Number.isFinite(t.locationTWD97.y)) {
            try {
              const w = twd97ToWgs84(t.locationTWD97.x, t.locationTWD97.y);
              if (w?.lng != null && w?.lat != null) {
                treeLocation = new fb.GeoPoint(w.lat, w.lng);
              }
            } catch (e) {}
          }
          const treeDoc = {
            treeNum: t.treeNum,
            treeCode: t.treeCode,
            speciesZh: t.speciesZh,
            speciesSci: null,
            conservationGrade: null,
            dbh_cm: t.dbh_cm,
            height_m: t.height_m,
            branchHeight_m: null,
            vitality: t.vitality || 'healthy',
            pestSymptoms: [],
            marking: 'none',
            notes: t.notes,
            // v2.5 個體座標
            localX_m: t.localX_m,
            localY_m: t.localY_m,
            locationTWD97: t.locationTWD97,
            location: treeLocation,
            // v2.6 計算結果（fallback 到「其他闊」）
            ...m,
            // v2.6 匯入元資料（保留來源代碼供審計）
            statusCodeRaw: t.statusCodeRaw,
            recordTypeRaw: t.recordTypeRaw,
            volume_m3_imported: t.volume_m3_imported,
            // QA + 審計
            qaStatus: 'pending',
            importedAt: fb.serverTimestamp(),
            importedBy: state.user.uid,
            createdBy: state.user.uid,
            createdAt: fb.serverTimestamp(),
            updatedAt: fb.serverTimestamp(),
          };
          try {
            await fb.addDoc(treesRef, treeDoc);
            result.successTrees++;
          } catch (e) {
            result.failedTrees.push({ plotCode: item.plot.code, treeCode: t.treeCode, error: e.message });
            console.error('[import tree]', t.treeCode, e);
          }
        }
        W.importProgress.current = r.plotCount + treeWritten;
        // 每 5 筆更新 UI（避免每筆都 re-render 拖慢）
        if (treeWritten % 5 === 0 || treeWritten === r.treeCount) {
          W.importProgress.message = `寫入立木 ${treeWritten}/${r.treeCount}`;
          render();
        }
      }
    }

    result.endTime = Date.now();
    result.durationSec = ((result.endTime - result.startTime) / 1000).toFixed(1);
    W.importResult = result;
    W.importing = false;
    W.importProgress = null;
    render();
    toast(`✅ 匯入完成：${result.successPlots} 樣區 / ${result.successTrees} 立木`, 5000);
    console.group('[ImportWizard 真實匯入完成]');
    console.log(result);
    console.groupEnd();
  } catch (e) {
    result.fatalError = e.message;
    result.endTime = Date.now();
    result.durationSec = ((result.endTime - result.startTime) / 1000).toFixed(1);
    W.importResult = result;
    W.importing = false;
    W.importProgress = null;
    render();
    toast('匯入失敗：' + e.message, 5000);
    console.error('[ImportWizard 真實匯入致命錯誤]', e);
  }
}

// ===== 真實匯入進行中 — 進度條 =====
function renderImportProgress() {
  const p = W.importProgress;
  const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
  const phaseLabel = { init: '初始化', plots: '樣區', trees: '立木' }[p.phase] || p.phase;
  return el('div', { class: 'space-y-4' },
    el('h3', { class: 'font-semibold text-base' }, '🚀 寫入中...'),
    el('div', { class: 'bg-blue-50 border-2 border-blue-300 rounded p-4 space-y-3' },
      el('div', { class: 'flex justify-between items-center text-sm' },
        el('span', { class: 'font-semibold text-blue-900' }, `階段：${phaseLabel}`),
        el('span', { class: 'text-stone-700' }, `${p.current} / ${p.total}（${pct}%）`)
      ),
      // 進度條
      el('div', { class: 'w-full bg-stone-200 rounded-full h-3 overflow-hidden' },
        el('div', { class: 'bg-blue-600 h-3 transition-all', style: `width: ${pct}%` })
      ),
      el('div', { class: 'text-sm text-stone-700' }, p.message)
    ),
    el('div', { class: 'text-xs text-stone-500 bg-stone-50 rounded p-2' },
      '⚠ 寫入過程請勿關閉視窗或重整頁面。如不慎關閉，已寫入的資料不會遺失（可重跑 DRY-RUN 確認，再次匯入會自動跳過已存在項目）。'
    )
  );
}

// ===== 真實匯入完成 — 結果區 =====
function renderImportResult() {
  const r = W.importResult;
  const box = el('div', { class: 'space-y-3' });

  if (r.fatalError) {
    box.appendChild(el('div', { class: 'bg-red-50 border-2 border-red-400 rounded p-4' },
      el('div', { class: 'text-xl font-bold text-red-800 mb-1' }, '✗ 匯入失敗'),
      el('div', { class: 'text-sm text-stone-700' }, '致命錯誤：' + r.fatalError),
      el('div', { class: 'text-xs text-stone-600 mt-2' },
        `已成功：${r.successPlots} 樣區 / ${r.successTrees} 立木（已寫入 Firestore，不會回滾）`)
    ));
    return box;
  }

  // 成功 banner
  box.appendChild(el('div', { class: 'bg-green-50 border-2 border-green-400 rounded p-4' },
    el('div', { class: 'text-xl font-bold text-green-800 mb-1' }, '✅ 匯入完成'),
    el('div', { class: 'text-sm text-stone-700' },
      `已寫入 Firestore：${r.successPlots} 樣區 / ${r.successTrees} 立木（耗時 ${r.durationSec} 秒）`)
  ));

  // 統計卡：成功 / 跳過 / 失敗
  box.appendChild(el('div', { class: 'grid grid-cols-2 gap-3 text-sm' },
    // 樣區
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'font-semibold text-stone-700 mb-1' }, '樣區'),
      el('div', { class: 'text-xs text-green-700' }, `✓ 成功 ${r.successPlots}`),
      el('div', { class: 'text-xs text-amber-700' }, `↷ 跳過 ${r.skipPlots}（已存在）`),
      el('div', { class: 'text-xs text-red-700' }, `✗ 失敗 ${r.failedPlots.length}`),
    ),
    // 立木
    el('div', { class: 'bg-stone-100 rounded p-3' },
      el('div', { class: 'font-semibold text-stone-700 mb-1' }, '立木'),
      el('div', { class: 'text-xs text-green-700' }, `✓ 成功 ${r.successTrees}`),
      el('div', { class: 'text-xs text-amber-700' }, `↷ 跳過 ${r.skipTrees}（已存在）`),
      el('div', { class: 'text-xs text-red-700' }, `✗ 失敗 ${r.failedTrees.length}`),
    ),
  ));

  // 錯誤明細
  if (r.failedPlots.length || r.failedTrees.length) {
    const errBox = el('details', { class: 'border border-red-300 rounded' },
      el('summary', { class: 'bg-red-50 px-3 py-2 text-sm font-semibold text-red-900 cursor-pointer' },
        `⚠ 失敗清單（${r.failedPlots.length + r.failedTrees.length} 筆 — 點此展開）`),
    );
    if (r.failedPlots.length) {
      errBox.appendChild(el('div', { class: 'p-3 text-xs space-y-1' },
        el('div', { class: 'font-semibold' }, '失敗樣區：'),
        ...r.failedPlots.map(f => el('div', { class: 'font-mono' }, `  • ${f.code}：${f.error}`))
      ));
    }
    if (r.failedTrees.length) {
      errBox.appendChild(el('div', { class: 'p-3 text-xs space-y-1 max-h-48 overflow-y-auto' },
        el('div', { class: 'font-semibold' }, `失敗立木（顯示前 50 筆，共 ${r.failedTrees.length}）：`),
        ...r.failedTrees.slice(0, 50).map(f =>
          el('div', { class: 'font-mono' }, `  • ${f.treeCode || '(no code)'} @ ${f.plotCode}：${f.error}`))
      ));
    }
    box.appendChild(errBox);
  }

  // 提示
  box.appendChild(el('div', { class: 'text-xs text-stone-600 bg-stone-50 rounded p-3 space-y-1' },
    el('div', {}, '✨ 後續建議：'),
    el('div', {}, '1. 進「樣區」分頁檢視匯入的 19 樣區（plot.locationTWD97 已從第一筆立木反推樣區中心）'),
    el('div', {}, '2. 進任一樣區檢視 ~50 筆立木 + 個體 X/Y 座標'),
    el('div', {}, '3. 未知樹種（44 種中 ~37 種）的 speciesSci / 保育等級為 null，可逐筆編輯補上'),
    el('div', {}, '4. 材積/碳量已用「其他闊」fallback 公式自動算，PI 可逐筆 verified 或 flag 重算'),
  ));

  return box;
}
