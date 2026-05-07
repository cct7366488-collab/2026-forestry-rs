// ===== species-picker.js — v2.10.5 樹種搜尋下拉組件 =====
// 取代原生 <datalist>，支援：
//   - 從 Firestore species/{} 動態載入（v2.10 enriched schema：224 種）
//   - Fuzzy 搜尋：中文 / 學名 / 別名 / 科 / 屬 7 級分數排序
//   - 常用置頂（popularityRank asc）
//   - 富 metadata 顯示：保育級紅字 ⚠ / 公式來源徽章 🟢🟡🟠 / 科 / 樹型 / 海拔
//   - 鍵盤導航 ↑↓ Enter Esc
//   - Firestore 失敗 fallback 到 species-dict.js 靜態 TREES
//
// API：
//   const picker = createSpeciesPicker({ name, value, required, placeholder });
//   form.appendChild(picker.root);
//   picker.input.addEventListener('input', () => { ... picker.getMatched() ... });

import { fb, el } from './app.js?v=21116';
import { TREES } from './species-dict.js?v=2000';

// ===== Module-level cache（一次 fetch / session）=====
let _speciesCache = null;
let _cachePromise = null;

export async function loadSpeciesCache(force = false) {
  if (!force && _speciesCache) return _speciesCache;
  if (!force && _cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    try {
      const snap = await fb.getDocs(fb.collection(fb.db, 'species'));
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // aliasOf entries 不獨立顯示 — 把它們的 zh 補進主 entry 的 aliases
      const aliasMap = {};
      docs.filter(d => d.aliasOf).forEach(d => {
        (aliasMap[d.aliasOf] ||= []).push(d.zh);
      });
      const main = docs.filter(d => !d.aliasOf);
      main.forEach(d => {
        if (aliasMap[d.zh]) d.aliases = [...(d.aliases || []), ...aliasMap[d.zh]];
      });
      // popularityRank asc, null/missing 排到最後
      main.sort((a, b) => (a.popularityRank ?? 9999) - (b.popularityRank ?? 9999));
      _speciesCache = main;
      return main;
    } catch (e) {
      console.warn('[species-picker] Firestore 載入失敗，fallback 靜態 TREES', e);
      _speciesCache = TREES.map((t, i) => ({
        zh: t.zh, sci: t.sci, conservationGrade: t.cons,
        popularityRank: i + 1, aliases: [],
      }));
      return _speciesCache;
    } finally {
      _cachePromise = null;
    }
  })();
  return _cachePromise;
}

// ===== 7 級分數排序 =====
// A 1000 zh 完全 / B 500 zh prefix / C 400 alias 完全 / D 380 alias prefix
// E 200 zh includes / F 150 alias includes / G 100 sci includes / H 50 family/genus includes
function scoreSpecies(s, q) {
  if (!q) return 1; // 空 query 全部都過，靠 popularityRank 排
  const zh = (s.zh || '').toLowerCase();
  const sci = (s.sci || '').toLowerCase();
  const family = (s.family || '').toLowerCase();
  const genus = (s.genus || '').toLowerCase();
  const aliases = (s.aliases || []).map(a => (a || '').toLowerCase());
  if (zh === q) return 1000;
  if (zh.startsWith(q)) return 500;
  for (const a of aliases) if (a === q) return 400;
  for (const a of aliases) if (a.startsWith(q)) return 380;
  if (zh.includes(q)) return 200;
  for (const a of aliases) if (a.includes(q)) return 150;
  if (sci.includes(q)) return 100;
  if (family.includes(q) || genus.includes(q)) return 50;
  return 0;
}

function eqBadge(equationSource) {
  return equationSource === 'species-specific' ? '🟢' :
         equationSource === 'genus-default' ? '🟡' :
         equationSource === 'type-default-ipcc' ? '🟠' : '⚪';
}

// ===== v2.10.6：海拔分層 =====
// 台灣氣候帶：低 < 500m / 中 500-1500m / 高 > 1500m
// 物種屬於某 band：物種海拔範圍 與 band 範圍 overlap（端點相觸算 overlap）
// 物種無 elevationMin/Max 視為「分布不明」→ 任何 band 都不排除
const ELEV_BANDS = {
  all:  { label: '全部',         match: () => true },
  low:  { label: '低 <500m',     match: s => (s.elevationMin_m == null) || s.elevationMin_m <= 500 },
  mid:  { label: '中 500-1500m', match: s =>
            (s.elevationMin_m == null || s.elevationMin_m <= 1500) &&
            (s.elevationMax_m == null || s.elevationMax_m >= 500) },
  high: { label: '高 >1500m',    match: s => (s.elevationMax_m == null) || s.elevationMax_m >= 1500 },
};
const BAND_KEYS = ['all', 'low', 'mid', 'high'];
const LS_BAND_KEY = 'speciesPicker.elevBand';

// HTML 跳脫 — species 資料 user-controlled，避免 XSS
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}

// ===== 主組件 =====
export function createSpeciesPicker({
  name = 'speciesZh',
  value = '',
  required = false,
  placeholder = '搜尋中文 / 學名 / 別名（自由輸入也可）',
  elevationBand = null,        // 'all' | 'low' | 'mid' | 'high' | null（用 localStorage）
} = {}) {
  // 主 input — 給 form FormData 抓 value
  const inputAttrs = {
    type: 'text',
    name,
    placeholder,
    value: value || '',
    autocomplete: 'off',
    class: 'border rounded px-2 py-1.5 w-full',
  };
  if (required) inputAttrs.required = 'true';
  const input = el('input', inputAttrs);

  // 容器（relative 讓 dropdown absolute 對齊）
  const wrapper = el('div', { class: 'relative' });
  wrapper.appendChild(input);

  // dropdown panel
  const panel = el('div', {
    class: 'absolute left-0 right-0 mt-1 bg-white border border-stone-300 rounded-lg shadow-xl z-50 hidden max-h-72 overflow-y-auto',
  });
  wrapper.appendChild(panel);

  let _all = [];
  let _filtered = [];
  let _highlight = -1;
  let _open = false;
  // v2.10.6：海拔 band 狀態（caller 傳入 > localStorage > 'all'）
  let _band = 'all';
  // v2.10.9：user 是否手動點過 pill — 若已手動，DEM auto-set 不覆蓋
  let _userTouched = false;
  if (elevationBand && BAND_KEYS.includes(elevationBand)) {
    _band = elevationBand;
  } else {
    try {
      const saved = localStorage.getItem(LS_BAND_KEY);
      if (saved && BAND_KEYS.includes(saved)) _band = saved;
    } catch {}
  }

  // 啟動載入 cache（async）
  loadSpeciesCache().then(arr => {
    _all = arr;
    if (_open) refresh();
    // 載入完成後若已有 value，dispatch 一次 input 讓 caller 抓 metadata
    if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  function refresh() {
    const q = input.value.toLowerCase().trim();
    const bandFilter = ELEV_BANDS[_band].match;
    if (q) {
      _filtered = _all
        .filter(bandFilter)
        .map(s => ({ s, score: scoreSpecies(s, q) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score
          || (a.s.popularityRank ?? 9999) - (b.s.popularityRank ?? 9999))
        .slice(0, 30)
        .map(x => x.s);
    } else {
      // 空 query → 該 band top-30 popular
      _filtered = _all.filter(bandFilter).slice(0, 30);
    }
    _highlight = _filtered.length > 0 ? 0 : -1;
    renderPanel();
  }

  // v2.10.6：海拔 band pill bar（sticky 於 panel 頂）
  function renderBandPills() {
    const bar = el('div', { class: 'flex gap-1 px-2 py-1 border-b bg-stone-50 sticky top-0 z-10' });
    BAND_KEYS.forEach(key => {
      const meta = ELEV_BANDS[key];
      const active = key === _band;
      const pill = el('button', {
        type: 'button',
        class: `text-xs px-2 py-0.5 rounded transition ${
          active ? 'bg-forest-700 text-white font-medium'
                 : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-100'}`,
      }, meta.label);
      pill.addEventListener('mousedown', (e) => {
        e.preventDefault();    // 不讓 input blur
        _band = key;
        _userTouched = true;   // v2.10.9：標記 user 動過，後續 DEM auto-set 不覆蓋
        try { localStorage.setItem(LS_BAND_KEY, _band); } catch {}
        refresh();
      });
      bar.appendChild(pill);
    });
    return bar;
  }

  function renderPanel() {
    panel.innerHTML = '';
    panel.appendChild(renderBandPills());      // v2.10.6：永遠在最上面（不論有無資料）
    const q = input.value.trim();
    if (_all.length === 0) {
      panel.appendChild(el('div', { class: 'p-3 text-sm text-stone-500' }, '⏳ 載入樹種字典...'));
      return;
    }
    const bandLabel = _band === 'all' ? '' : ` · ${ELEV_BANDS[_band].label}`;
    const totalInBand = _all.filter(ELEV_BANDS[_band].match).length;
    if (_filtered.length === 0) {
      panel.appendChild(el('div', { class: 'p-3 text-sm text-stone-500' },
        `查無符合樹種${bandLabel}；可直接在輸入框打字（自由輸入新物種）`));
      return;
    }
    const headerText = q
      ? `符合 ${_filtered.length} 種${bandLabel}（按相關度排序；最多 30）`
      : `常用 top-30${bandLabel}（${_band === 'all' ? `共 ${_all.length} 種` : `本 band ${totalInBand} 種`}；輸入過濾）`;
    panel.appendChild(el('div', {
      class: 'bg-stone-100 px-2 py-1 text-[10px] text-stone-600 border-b'
    }, headerText));
    _filtered.forEach((s, i) => panel.appendChild(renderRow(s, i)));
  }

  function renderRow(s, i) {
    const cons = s.conservationGrade
      ? `<span class="text-red-700 text-xs ml-1">⚠ ${escHtml(s.conservationGrade)}</span>` : '';
    const badge = eqBadge(s.equationSource);
    const sciStr = s.sci ? `<span class="italic text-stone-700">${escHtml(s.sci)}</span>` : '';
    const familyStr = s.family ? `<span class="text-stone-500"> · ${escHtml(s.family)}</span>` : '';
    const elev = (Number.isFinite(s.elevationMin_m) && Number.isFinite(s.elevationMax_m))
      ? `<span class="text-stone-500"> · ${s.elevationMin_m}-${s.elevationMax_m}m</span>` : '';
    const aliases = (s.aliases?.length)
      ? ` <span class="text-stone-500 text-xs">(${escHtml(s.aliases.slice(0, 3).join(' / '))})</span>` : '';
    const treeType = s.treeType ? `<span class="text-stone-500"> · ${escHtml(s.treeType)}</span>` : '';
    const verifiedMark = s.verified === false ? ' <span class="text-amber-600 text-[10px]">⏳待覆核</span>' : '';
    const row = el('div', {
      class: `px-2 py-1.5 cursor-pointer border-b border-stone-100 ${i === _highlight ? 'bg-blue-50' : 'hover:bg-stone-50'}`,
    });
    row.dataset.idx = i;
    row.innerHTML =
      `<div class="text-sm leading-tight"><span class="mr-1">${badge}</span><b>${escHtml(s.zh)}</b>${cons}${aliases}${verifiedMark}</div>` +
      `<div class="text-xs leading-tight">${sciStr}${familyStr}${treeType}${elev}</div>`;
    // mousedown 而非 click — 避免 input blur 在 click 前觸發 closePanel
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickSpecies(s);
    });
    return row;
  }

  function pickSpecies(s) {
    input.value = s.zh;
    input.dispatchEvent(new Event('input', { bubbles: true })); // 通知 caller
    closePanel();
  }

  function openPanel() {
    if (_open) return;
    _open = true;
    panel.classList.remove('hidden');
    refresh();
  }

  function closePanel() {
    _open = false;
    panel.classList.add('hidden');
  }

  function getMatched() {
    const v = input.value.trim();
    if (!v) return null;
    return _all.find(s => s.zh === v) || null;
  }

  input.addEventListener('focus', openPanel);
  input.addEventListener('input', () => {
    if (!_open) openPanel();
    else refresh();
  });
  input.addEventListener('blur', () => {
    // 延遲讓 mousedown 先 fire
    setTimeout(closePanel, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (!_open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') openPanel();
      return;
    }
    if (e.key === 'ArrowDown') {
      _highlight = Math.min(_highlight + 1, _filtered.length - 1);
      renderPanel();
      // 確保 highlighted row 在視野內
      panel.querySelector(`[data-idx="${_highlight}"]`)?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      _highlight = Math.max(_highlight - 1, 0);
      renderPanel();
      panel.querySelector(`[data-idx="${_highlight}"]`)?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (_highlight >= 0 && _filtered[_highlight]) {
        pickSpecies(_filtered[_highlight]);
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      closePanel();
      e.preventDefault();
    }
  });

  return {
    root: wrapper,
    input,
    getValue: () => input.value.trim(),
    setValue: (v) => { input.value = v || ''; },
    getMatched,                       // 回傳 species object 或 null（自由輸入時）
    cache: () => _all,                // 整份 cache（caller 想批次用）
    // v2.10.6：海拔 band 控制（v2.10.9 DEM auto-detect 透過 setBand({auto:true}) 接入）
    getBand: () => _band,
    isBandUserTouched: () => _userTouched,
    setBand: (b, opts = {}) => {
      if (!BAND_KEYS.includes(b)) return;
      // v2.10.9：auto 模式下若 user 已手動選過 band，不覆蓋（尊重 user 意圖）
      if (opts.auto && _userTouched) return;
      _band = b;
      // auto 模式不寫 localStorage（避免 DEM 結果污染 user 全域偏好）
      if (!opts.auto) {
        _userTouched = true;
        try { localStorage.setItem(LS_BAND_KEY, _band); } catch {}
      }
      if (_open) refresh();
    },
  };
}
