// ===== ai-species.js — v2.11.0 AI 樹種辨識（線上 Pl@ntNet API） =====
// 使用 Pl@ntNet 免費 API：https://my-api.plantnet.org/v2/identify
//   - free tier 500 req/day/key
//   - 全球 ~40,000 種維管束植物（含台灣常見種）
//   - 多器官支援：leaf / flower / fruit / bark / habit / auto
//   - response: { results: [{ score, species: { scientificNameWithoutAuthor, family, commonNames } }] }
//
// 用法：
//   import { identifySpecies, getApiKey, setApiKey, resizeImage, matchToLocalSpecies } from './ai-species.js';
//   if (!getApiKey()) {  // user 還沒設 key
//     setApiKey(prompt('Pl@ntNet API key?'));
//   }
//   const small = await resizeImage(blob, 800);
//   const top = await identifySpecies(small, { organs: ['leaf'] });
//   const localSp = matchToLocalSpecies(top[0], allSpecies);

// v2.11.4：API key + Proxy URL 從 user-only localStorage 升級為「Firestore 全域 admin > localStorage user」優先序
import { fb, isSystemAdmin, state } from './app.js?v=21131';

const LS_API_KEY = 'forestmrv.plantnet.apiKey';
const LS_PROXY_URL = 'forestmrv.plantnet.proxyUrl';   // v2.11.2：CORS proxy URL（如 Cloudflare Worker）
const LS_LLM_KEY = 'forestmrv.llm.apiKey';            // v2.11.5：LLM (Anthropic Claude) key
const PLANTNET_DIRECT = 'https://my-api.plantnet.org';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
// v2.11.6：可選 model — admin 在設定區下拉選 Sonnet（高品質貴）或 Haiku（快便宜 3 倍）
//   pricing 估算：每次辨識 = 圖 ~1500 tok input + system/user prompt ~500 tok input + JSON 輸出 ~600 tok
//   Sonnet 4.6: $3/M in + $15/M out → ~$0.015/次
//   Haiku 4.5:  $1/M in + $5/M out  → ~$0.005/次
export const LLM_MODELS = {
  'claude-sonnet-4-6':         { label: 'Claude Sonnet 4.6', desc: '高品質、貴 3 倍',   pricePerCall: '~$0.015' },
  'claude-haiku-4-5-20251001': { label: 'Claude Haiku 4.5',  desc: '快、便宜（推薦）',   pricePerCall: '~$0.005' },
};
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';   // v2.11.6：預設 Haiku 省成本
const GLOBAL_AI_DOC = 'app_settings/aiConfig';        // v2.11.4：Firestore 全域 admin 設定路徑

// v2.11.4：模組層 cache 全域設定（一次 fetch / session）
let _globalCache = null;
let _globalPromise = null;

export async function loadGlobalAiConfig(force = false) {
  if (!force && _globalCache !== null) return _globalCache;
  if (!force && _globalPromise) return _globalPromise;
  _globalPromise = (async () => {
    try {
      const ref = fb.doc(fb.db, 'app_settings', 'aiConfig');
      const snap = await fb.getDoc(ref);
      _globalCache = snap.exists() ? snap.data() : {};
      return _globalCache;
    } catch (e) {
      console.warn('[ai-species] Firestore admin config 讀取失敗，fallback localStorage', e);
      _globalCache = {};
      return _globalCache;
    } finally {
      _globalPromise = null;
    }
  })();
  return _globalPromise;
}

// v2.11.4：admin 寫入全域設定（Firestore rules 須限 systemAdmin write）
// v2.11.5：加 llmApiKey 欄位
// v2.11.6：加 llmModel 欄位（admin 選 Sonnet / Haiku）
export async function setGlobalAiConfig({ plantnetApiKey, plantnetProxyUrl, llmApiKey, llmModel }) {
  if (!isSystemAdmin()) throw new Error('僅 admin 可設定全域 AI config');
  const payload = {};
  if (plantnetApiKey != null) payload.plantnetApiKey = String(plantnetApiKey).replace(/[\s​-‍﻿]/g, '');
  if (plantnetProxyUrl != null) payload.plantnetProxyUrl = String(plantnetProxyUrl).trim().replace(/\/+$/, '');
  if (llmApiKey != null) payload.llmApiKey = String(llmApiKey).replace(/[\s​-‍﻿]/g, '');
  if (llmModel != null) payload.llmModel = String(llmModel).trim();
  payload.updatedAt = fb.serverTimestamp();
  payload.updatedBy = state.user?.uid || null;
  const ref = fb.doc(fb.db, 'app_settings', 'aiConfig');
  await fb.setDoc(ref, payload, { merge: true });
  _globalCache = { ..._globalCache, ...payload };  // local cache 同步
}

// v2.11.6：取 effective model — global 設過則用，否則 default Haiku
export async function getEffectiveLlmModel() {
  const global = await loadGlobalAiConfig();
  return (global?.llmModel && LLM_MODELS[global.llmModel]) ? global.llmModel : ANTHROPIC_DEFAULT_MODEL;
}

// v2.11.5：LLM (Anthropic Claude) key 管理
export function getLlmKey() {
  try { return localStorage.getItem(LS_LLM_KEY) || ''; } catch { return ''; }
}
export function setLlmKey(key) {
  const clean = (key || '').replace(/[\s​-‍﻿]/g, '');
  try { localStorage.setItem(LS_LLM_KEY, clean); } catch {}
}
export function clearLlmKey() {
  try { localStorage.removeItem(LS_LLM_KEY); } catch {}
}
export async function getEffectiveLlmKey() {
  const userKey = getLlmKey();
  if (userKey) return userKey;
  const global = await loadGlobalAiConfig();
  return global?.llmApiKey || '';
}

// User 個人 key（localStorage）— override admin 全域用
export function getApiKey() {
  try { return localStorage.getItem(LS_API_KEY) || ''; } catch { return ''; }
}

// v2.11.4：實際使用的 key — user override > admin 全域 > 空字串
export async function getEffectiveApiKey() {
  const userKey = getApiKey();
  if (userKey) return userKey;
  const global = await loadGlobalAiConfig();
  return global?.plantnetApiKey || '';
}

export function setApiKey(key) {
  // v2.11.2：除了 trim 也清掉所有空白與不可見字（防止 PlantNet UI 複製帶到 zero-width 字元）
  const clean = (key || '').replace(/[\s​-‍﻿]/g, '');
  try { localStorage.setItem(LS_API_KEY, clean); } catch {}
}

export function clearApiKey() {
  try { localStorage.removeItem(LS_API_KEY); } catch {}
}

// v2.11.2：Proxy URL（CORS 解決方案）— 例如 Cloudflare Worker 部署的 https://xxx.workers.dev
//   PlantNet 拒絕 browser 直連（origin whitelist）→ 須透過 server-side proxy 轉送
//   設了 proxy URL 後，identifySpecies 改用 ${proxyUrl}/v2/identify/{project}?api-key=...
export function getProxyUrl() {
  try { return localStorage.getItem(LS_PROXY_URL) || ''; } catch { return ''; }
}

// v2.11.4：實際使用的 proxy URL — user override > admin 全域
export async function getEffectiveProxyUrl() {
  const userProxy = getProxyUrl();
  if (userProxy) return userProxy;
  const global = await loadGlobalAiConfig();
  return global?.plantnetProxyUrl || '';
}

export function setProxyUrl(url) {
  // 移除尾部斜線，避免雙斜線
  const clean = (url || '').trim().replace(/\/+$/, '');
  try { localStorage.setItem(LS_PROXY_URL, clean); } catch {}
}

export function clearProxyUrl() {
  try { localStorage.removeItem(LS_PROXY_URL); } catch {}
}

// === 主辨識函式 ===
// imageBlob: File | Blob (建議先用 resizeImage 壓到 800px / <500KB)
// opts.project: 'all' (預設, 含台灣) | 'weurope' | ...（Pl@ntNet 地區 project）
// opts.organs: ['auto'] | ['leaf'] | ['flower'] 等（與 images 同陣列順序對應）
// 回傳：[{ score, sci, family, genus, commonNames }, ...] 已 slice(0, 5)
export async function identifySpecies(imageBlob, opts = {}) {
  // v2.11.4：effective key/proxy = user localStorage override > admin Firestore global > 空
  const apiKey = await getEffectiveApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const project = opts.project || 'all';
  const organs = opts.organs || ['auto'];

  const formData = new FormData();
  formData.append('images', imageBlob, 'tree.jpg');
  organs.forEach(o => formData.append('organs', o));

  const proxy = await getEffectiveProxyUrl();
  const base = proxy || PLANTNET_DIRECT;
  const url = `${base}/v2/identify/${project}?api-key=${encodeURIComponent(apiKey)}&include-related-images=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);   // 30s timeout
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: formData, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    // v2.11.1：完整回應 log 到 console 方便除錯
    console.error(`[Pl@ntNet API ${res.status}]`, body, '\nRequest URL:', url.replace(apiKey, '***'));
    const bodyExcerpt = body ? body.slice(0, 200) : res.statusText;
    if (res.status === 401) {
      throw new Error(`API key 缺失或格式錯 (401)\n回應：${bodyExcerpt}`);
    }
    if (res.status === 403) {
      throw new Error(
        `Pl@ntNet 拒絕 (403) — 通常原因：\n` +
        `(a) 帳號 email 未驗證（檢查信箱認證信）\n` +
        `(b) key 未完全複製（去 my.plantnet.org 重 generate）\n` +
        `(c) project 'all' 不在 free tier — 試 'weurope' 或 'world-flora' \n` +
        `回應：${bodyExcerpt}`
      );
    }
    if (res.status === 404) throw new Error(`Pl@ntNet 查無此影像 (404)`);
    if (res.status === 429) throw new Error(`API quota 超額 (429) — 等明天 reset 或換 key\n回應：${bodyExcerpt}`);
    throw new Error(`Pl@ntNet ${res.status}: ${bodyExcerpt}`);
  }

  const data = await res.json();
  const top = (data.results || []).slice(0, 5).map(r => ({
    score: r.score || 0,
    sci: r.species?.scientificNameWithoutAuthor || r.species?.scientificName || '',
    family: r.species?.family?.scientificNameWithoutAuthor || '',
    genus: r.species?.genus?.scientificNameWithoutAuthor || '',
    commonNames: r.species?.commonNames || [],
  }));
  return top;
}

// === v2.11.14：iNaturalist 中文名查詢（PlantNet 字典外 fallback）===
// PlantNet commonNames 通常只有英文（e.g. "Sea hearse"）；iNat /v1/taxa 可帶 locale=zh-TW 回 preferred_common_name
//   - 免 API key、CORS open（瀏覽器直連 OK）
//   - 對台灣常見種覆蓋率高（已驗證 Hernandia nymphaeifolia → 蓮葉桐）
//   - 模組內 in-memory cache + sessionStorage 持久化（避免重複辨識同一物種重複打 API）
//   - 失敗（404/timeout/無 zh）一律回 null，caller 自行 fallback
//
// v2.11.17（G）：速率守門 — module-level 串行佇列確保 ≥ 600ms 間距（≤ 100 req/min；iNat free
//   tier 限 100/min）+ 遇 429 exponential backoff retry（1s → 2s → 4s，最多 3 次），全敗回 null
//   不擋 UI。
const INAT_API = 'https://api.inaturalist.org/v1/taxa';
const SS_INAT_CACHE_PREFIX = 'forestmrv.inat.zhTW.';
const _inatMemCache = new Map();   // sci → zh string | null
const INAT_MIN_SPACING_MS = 600;   // ≤ 100 req/min；保守值
const INAT_MAX_RETRIES = 3;
let _inatNextSlot = 0;             // 下次允許 fetch 的時間戳（ms）

// v2.11.17：串行排程 — 確保兩次 fetch 至少間隔 INAT_MIN_SPACING_MS
async function _waitForInatSlot() {
  const now = Date.now();
  const wait = Math.max(0, _inatNextSlot - now);
  _inatNextSlot = Math.max(now, _inatNextSlot) + INAT_MIN_SPACING_MS;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

export async function lookupChineseName(sci) {
  if (!sci) return null;
  const key = sci.trim().toLowerCase();
  if (_inatMemCache.has(key)) return _inatMemCache.get(key);
  // sessionStorage cache（同 session 內不重複打）
  try {
    const cached = sessionStorage.getItem(SS_INAT_CACHE_PREFIX + key);
    if (cached !== null) {
      const v = cached === '' ? null : cached;
      _inatMemCache.set(key, v);
      return v;
    }
  } catch {}

  const url = `${INAT_API}?q=${encodeURIComponent(sci)}&rank=species&locale=zh-TW&per_page=3`;

  // v2.11.17：retry loop 處理 429
  let backoffMs = 1000;
  for (let attempt = 0; attempt < INAT_MAX_RETRIES; attempt++) {
    await _waitForInatSlot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      console.warn('[iNat zh-TW lookup] fetch failed', sci, e?.message || e);
      _cacheInat(key, null);
      clearTimeout(timer);
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      // Rate limited — exponential backoff + retry（不寫 cache，下次同學名仍會試）
      console.warn(`[iNat zh-TW lookup] 429 rate limit (attempt ${attempt + 1}/${INAT_MAX_RETRIES}), backoff ${backoffMs}ms`);
      if (attempt < INAT_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, backoffMs));
        backoffMs *= 2;
        continue;
      }
      // 最後一次仍 429 → 放棄、cache null（避免短時間內反覆打）
      _cacheInat(key, null);
      return null;
    }

    if (!res.ok) {
      _cacheInat(key, null);
      return null;
    }

    let data;
    try { data = await res.json(); } catch { _cacheInat(key, null); return null; }
    // 找學名完全相符的那一筆（iNat search 偶會回相近種）
    const exact = (data.results || []).find(r => (r.name || '').toLowerCase().trim() === key);
    const zh = exact?.preferred_common_name || data.results?.[0]?.preferred_common_name || null;
    // iNat 對沒有 locale 翻譯時 preferred_common_name 會 fallback 給英文 → 用 english_common_name 比對排除
    const englishFallback = exact?.english_common_name || data.results?.[0]?.english_common_name || null;
    const finalZh = (zh && zh !== englishFallback && /[一-鿿]/.test(zh)) ? zh : null;
    _cacheInat(key, finalZh);
    return finalZh;
  }
  // 理論上不應到達
  _cacheInat(key, null);
  return null;
}

function _cacheInat(key, value) {
  _inatMemCache.set(key, value);
  try { sessionStorage.setItem(SS_INAT_CACHE_PREFIX + key, value || ''); } catch {}
}

// === v2.11.17（F1）：把 AI 字典外 + iNat/LLM resolved 的物種補進 species 字典（verified=false）===
// docId 用 zh（與 import-wizard 一致），verified=false + addedFrom 標 ai-identify-{iNat,LLM}，
// admin 在「⏳ 待補充」filter 看到 → 1-鍵 verify。已存在則跳過（不覆寫已 verified / 既有資料）。
// 同 session dedup：相同 (zh, sci) 只寫一次。
const _suggestedSession = new Set();   // session-level dedup key: `${docId}|${sci}`

export async function suggestSpeciesFromAi({ sci, zh, family, source }) {
  if (!sci || !zh) return { ok: false, reason: 'missing-data' };
  if (source !== 'iNat' && source !== 'LLM') return { ok: false, reason: 'bad-source' };
  // docId 規則跟 import-wizard 對齊：用 zh，禁止 '/' 與保留字 '.'/'..'
  let docId = String(zh).trim().replace(/\//g, '_');
  if (!docId) return { ok: false, reason: 'bad-docid-empty' };
  if (docId === '.' || docId === '..') docId = '_' + docId;
  const sessionKey = `${docId}|${String(sci).trim()}`;
  if (_suggestedSession.has(sessionKey)) return { ok: false, reason: 'session-dedup' };
  _suggestedSession.add(sessionKey);

  try {
    const ref = fb.doc(fb.db, 'species', docId);
    const snap = await fb.getDoc(ref);
    if (snap.exists()) {
      // 不覆寫既有 doc（不論 verified=true/false） — admin 領域，避免污染
      return { ok: false, reason: 'exists', docId };
    }
    await fb.setDoc(ref, {
      zh: String(zh).trim(),
      sci: String(sci).trim(),
      family: family ? String(family).trim() : null,
      conservationGrade: null,
      verified: false,
      addedFrom: source === 'iNat' ? 'ai-identify-iNat' : 'ai-identify-LLM',
      addedAt: fb.serverTimestamp(),
      addedBy: state.user?.uid || null,
    });
    return { ok: true, docId };
  } catch (e) {
    console.warn('[suggestSpeciesFromAi]', sci, '→', zh, e?.message || e);
    return { ok: false, reason: 'firestore-error', error: e?.message || String(e) };
  }
}

// === 把 AI 結果（latin sci）對應到 Firestore species 224 種 ===
// 若 sci 完全相符 → 回 species 物件；否則回 null（caller 提示「字典外，請手動輸入」）
export function matchToLocalSpecies(aiResult, allSpecies) {
  if (!allSpecies || !aiResult?.sci) return null;
  const aiSci = aiResult.sci.toLowerCase().trim();
  // 完全匹配
  let m = allSpecies.find(s => (s.sci || '').toLowerCase().trim() === aiSci);
  if (m) return m;
  // 退而求其次：屬+種（去掉 var. / subsp.）
  const aiBase = aiSci.replace(/\s+(var|subsp|f)\.?\s+\S+/g, '').trim();
  m = allSpecies.find(s => {
    const localBase = (s.sci || '').toLowerCase().replace(/\s+(var|subsp|f)\.?\s+\S+/g, '').trim();
    return localBase === aiBase;
  });
  return m || null;
}

// v2.11.5：把 PlantNet top-N 候選 + 圖片送 LLM 補 characteristics/habitat/imageQuality
//   抄參考系統設計：LLM 扮演「臺灣植物學家」回 JSON
//   單次 call 涵蓋全部候選 + image quality（成本控制）
//   用 Anthropic Claude Messages API + dangerous-direct-browser-access header
export async function enrichWithLLM(imageBlob, candidates, opts = {}) {
  const llmKey = await getEffectiveLlmKey();
  if (!llmKey) throw new Error('NO_LLM_KEY');
  if (!candidates || candidates.length === 0) return null;

  const small = await resizeImage(imageBlob, 800);
  const base64 = await blobToBase64(small);
  const mediaType = small.type || 'image/jpeg';

  const top3 = candidates.slice(0, 3);
  const candidateList = top3.map((c, i) => `${i + 1}. ${c.sci}${c.commonNames?.[0] ? `（${c.commonNames[0]}）` : ''}`).join('\n');

  const systemPrompt = `你是專業的臺灣植物學家，專精於臺灣原生樹種與常見造林樹種的辨識。使用者提供一張植物照片 + Pl@ntNet 已給的 ${top3.length} 個候選學名。

請針對每個候選，依照片實際內容判斷其合理性，給：
- chineseName: 此物種的繁體中文常用名（**必填**；以臺灣最通用的中文名為準，例如 Hernandia nymphaeifolia → 蓮葉桐、Cinnamomum camphora → 樟樹；若無公認中文名才回空字串，**禁止音譯**或自創名稱）
- characteristics: 此物種的辨識特徵（葉形、樹皮、樹形等，1-2 句中文）
- habitat: 臺灣常見海拔/棲地（1 句中文，例如「中海拔 1500-2500m 雲霧帶」）
- isNative: 是否為臺灣原生種（boolean）
- notes: 任何補充提醒（與其他相似種如何區分、保育狀態等；無則空字串）

並評估**照片本身的品質**：
- imageQuality: "good"（清晰，可辨識）/ "poor"（過暗/模糊/角度差/非植物）/ "unknown"
- imageQualityReason: 一句中文說明（例如「葉片清晰可見」/「光線過暗無法判斷葉緣」）

回覆**純 JSON**，不加 \\\`\\\`\\\` 包裝：
{"imageQuality":"good","imageQualityReason":"...","candidates":[{"sci":"...","chineseName":"...","characteristics":"...","habitat":"...","isNative":true,"notes":""},...]}`;

  const userPrompt = `候選清單（依 Pl@ntNet 信心由高到低）：\n${candidateList}\n\n請評估照片並給出 JSON。`;

  // v2.11.6：opts.model > effective (global > default Haiku)
  const model = opts.model || await getEffectiveLlmModel();
  const body = {
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: userPrompt }
      ]
    }]
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': llmKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.text()).slice(0, 300); } catch {}
    console.error(`[Anthropic ${res.status}]`, detail);
    if (res.status === 401) throw new Error(`Anthropic API key 無效 (401)`);
    if (res.status === 429) throw new Error(`Anthropic quota 超額 (429)`);
    throw new Error(`Anthropic ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Parse JSON（容錯：剝 ```json 包裝）
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('LLM 回傳非 JSON：' + text.slice(0, 200));
  }
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // 「data:image/jpeg;base64,XXX」→ 取 XXX
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// === 圖片壓縮（client-side，避免大檔上傳浪費頻寬+被 Pl@ntNet 拒絕）===
// Pl@ntNet 接受 < 4MB；800px JPEG q=0.85 通常 < 200KB
export async function resizeImage(blob, maxWidth = 800, quality = 0.85) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.src = url;
    });
    if (img.width <= maxWidth) return blob;     // 已夠小，不壓
    const ratio = maxWidth / img.width;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
