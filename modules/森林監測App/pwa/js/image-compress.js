// ===== image-compress.js — 上傳前本地影像壓縮（v2.11.94）=====
//
// 為什麼要有：手機原檔動輒 4–8 MB。超過 5 MB 會被 storage.rules 直接擋掉（調查員只看到一句 toast
// 就沒了）；沒被擋掉的，一次上傳 20 張在野外行動網路下也是漫長等待。1600px 長邊對「樣方俯拍佐證」
// 與「物種鑑定照」的判讀綽綽有餘，壓完通常落在 300–600 KB。
//
// 設計原則（全部偏保守，寧可不壓也不要擋住調查員）：
//   - 小於門檻的檔案原封不動 —— 避免對已經很小的圖二次失真
//   - 壓完反而變大（PNG 去壓成 JPEG 有時會）就用原檔
//   - 解碼失敗、canvas 失敗、toBlob 回 null …任何一步出錯一律退回原檔，只在 console warn
//   - 不自行處理 EXIF 旋轉：瀏覽器繪製 <img> 時已套用 EXIF 方向，drawImage 沿用該結果
//
// 本模組零相依（不 import app.js），故不受 app.js ⇄ 子模組循環 import 的 TDZ 雷影響。

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.85;
export const PHOTO_COMPRESS_ABOVE = 1.2 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;   // 與 storage.rules 的上限一致
export const PHOTO_DECODE_TIMEOUT_MS = 8000;

// 載入 <img> 並保證「一定會有結果」。
//   不用 img.decode()：實測有瀏覽器環境下，圖片明明已載入（naturalWidth 有值）decode() 的
//   promise 卻永遠不 resolve —— 那會讓調查員的照片停在「處理照片中…」回不來，比不壓縮更糟。
//   onload/onerror 是最老最穩的路；再加逾時，任何卡住都會走到 catch 退回原檔。
function loadImage(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('影像解碼逾時')), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('影像解碼失敗')); };
    img.src = url;
  });
}

// 入：File / Blob；出：壓縮後的 File，或原物件（不符條件或失敗時）
export async function compressImageFile(file, {
  maxEdge = PHOTO_MAX_EDGE,
  quality = PHOTO_JPEG_QUALITY,
  compressAbove = PHOTO_COMPRESS_ABOVE,
  timeoutMs = PHOTO_DECODE_TIMEOUT_MS,
} = {}) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.size <= compressAbove) return file;
  let url = null;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url, timeoutMs);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return file;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const baseName = (file.name || 'photo').replace(/\.[a-zA-Z0-9]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    console.warn('[photo] 壓縮失敗，改用原檔', e);
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
