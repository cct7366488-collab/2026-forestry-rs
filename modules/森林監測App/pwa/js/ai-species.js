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

const LS_API_KEY = 'forestmrv.plantnet.apiKey';
const PLANTNET_BASE = 'https://my-api.plantnet.org/v2/identify';

export function getApiKey() {
  try { return localStorage.getItem(LS_API_KEY) || ''; } catch { return ''; }
}

export function setApiKey(key) {
  try { localStorage.setItem(LS_API_KEY, (key || '').trim()); } catch {}
}

export function clearApiKey() {
  try { localStorage.removeItem(LS_API_KEY); } catch {}
}

// === 主辨識函式 ===
// imageBlob: File | Blob (建議先用 resizeImage 壓到 800px / <500KB)
// opts.project: 'all' (預設, 含台灣) | 'weurope' | ...（Pl@ntNet 地區 project）
// opts.organs: ['auto'] | ['leaf'] | ['flower'] 等（與 images 同陣列順序對應）
// 回傳：[{ score, sci, family, genus, commonNames }, ...] 已 slice(0, 5)
export async function identifySpecies(imageBlob, opts = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const project = opts.project || 'all';
  const organs = opts.organs || ['auto'];

  const formData = new FormData();
  formData.append('images', imageBlob, 'tree.jpg');
  organs.forEach(o => formData.append('organs', o));

  const url = `${PLANTNET_BASE}/${project}?api-key=${encodeURIComponent(apiKey)}&include-related-images=false`;
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
