// ===== shapefile-loader.js — v2.11.91：ESRI Shapefile → GeoJSON（專案邊界上傳）=====
//
// 用途：專案邊界除既有 GeoJSON 外，新增 ESRI Shapefile 上傳
//       — 使用者可丟 .zip，或直接多選 .shp/.shx/.dbf/.prj/.cpg。
//
// 設計要點（四條，都是踩過的坑或本案特有需求）：
//   (1) 本檔「不 import app.js」— 純解析、零 Firebase 相依。
//       避免 app.js ⇄ 子模組循環 import 造成的 TDZ throw（新模組頂層 destructure fb → 整包白畫面）。
//   (2) shpjs 走 lazy CDN 載入（min 97 KB），只有真的上傳 shapefile 才下載 —
//       不讓野外調查員的 cold load 平白多背 97 KB。離線時給明確錯誤（邊界上傳是辦公室作業，可接受）。
//   (3) DBF 中文編碼：台灣政府圖資常見 Big5(cp950) 且不附 .cpg，逕以 UTF-8 解會變亂碼；
//       而屬性欄位正是「申請帶出地籍」下拉（承租人 / 林班 / 假地號）的資料來源 → 必須解對。
//       策略＝候選編碼（.cpg 宣告 → utf-8 → big5）各解一次，用 CJK / 亂碼比例評分擇優。
//   (4) 輸出一律 GeoJSON FeatureCollection，交回既有 parseProjectBoundaryGeoJson() 做
//       CRS 偵測與 TWD97→WGS84 轉換 → 下游（Leaflet 疊圖 / bbox zoom / properties dropdown）零改動。
//
// 座標系處理分兩段：
//   有 .prj → shpjs（內建 proj4）依 WKT 直接投影到 WGS84；
//   無 .prj → 原值輸出，交給 parseProjectBoundaryGeoJson 的 TWD97/WGS84 自動偵測補位。
//   兩條路都通，所以缺 .prj 不是致命傷（台灣圖資落在 TWD97 偵測範圍內）。

const SHPJS_URL = 'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js';
const SHPJS_TIMEOUT_MS = 20000;

// 使用者可選的副檔名（給 <input accept>）
export const SHAPEFILE_ACCEPT = '.zip,.shp,.shx,.dbf,.prj,.cpg';
const SHAPEFILE_EXTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'];

// ===== shpjs lazy loader =====
let shpLibPromise = null;

function loadShpLib() {
  if (globalThis.shp) return Promise.resolve(globalThis.shp);
  if (shpLibPromise) return shpLibPromise;
  shpLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHPJS_URL;
    s.async = true;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Shapefile 函式庫載入逾時（請確認網路連線；此功能需要連線）'));
    }, SHPJS_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
    }
    s.onload = () => {
      cleanup();
      if (globalThis.shp) resolve(globalThis.shp);
      else reject(new Error('Shapefile 函式庫載入後找不到 shp 物件'));
    };
    s.onerror = () => {
      cleanup();
      shpLibPromise = null;   // 允許重試（暫時斷網）
      reject(new Error('Shapefile 函式庫下載失敗（請確認網路連線）'));
    };
    document.head.appendChild(s);
  });
  return shpLibPromise;
}

// ===== 檔名工具 =====
function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
}
function baseOf(name) {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? String(name) : String(name).slice(0, i);
}

// 這批選檔是不是 shapefile（給 forms.js 分流用；.zip 也算，內容驗證留給解析階段）
export function looksLikeShapefile(files) {
  const list = Array.from(files || []);
  if (list.length === 0) return false;
  return list.some(f => {
    const e = extOf(f.name);
    return e === 'zip' || SHAPEFILE_EXTS.includes(e);
  });
}

// ===== ZIP 讀取（原生 DecompressionStream，不再多背一個解壓函式庫）=====
// 只做我們需要的：End of Central Directory → Central Directory → 各 entry 的 local header → 資料。
// 讀不動時由呼叫端 fallback 回 shp.parseZip（shpjs 自帶解壓器），所以這裡失敗不是死路。
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('瀏覽器不支援 DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 22) throw new Error('檔案太小，不像 ZIP');

  // 從尾端往前找 EOCD 簽章（comment 最長 65535）
  let eocd = -1;
  const stopAt = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= stopAt; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP（找不到 End of Central Directory）');

  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 格式不支援');
  if (count === 0) throw new Error('ZIP 內沒有檔案');

  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error('ZIP central directory 損毀');
    }
    const flag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, flag, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;                       // 目錄
    if (e.name.includes('__MACOSX')) continue;                // macOS 打包殘渣
    const base = e.name.split('/').pop();
    if (!base || base.startsWith('.')) continue;
    if (!SHAPEFILE_EXTS.includes(extOf(base))) continue;      // 只取我們要的副檔名
    if (e.flag & 0x1) throw new Error('ZIP 有密碼保護，無法讀取');
    if (e.compSize === 0xffffffff) throw new Error('ZIP64 格式不支援');

    if (dv.getUint32(e.localOff, true) !== 0x04034b50) throw new Error('ZIP local header 損毀');
    const nl = dv.getUint16(e.localOff + 26, true);
    const xl = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + nl + xl;
    const raw = u8.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) data = raw.slice();
    else if (e.method === 8) data = await inflateRaw(raw);
    else throw new Error(`ZIP 壓縮方式不支援（method=${e.method}）`);
    out.set(base, data);
  }
  if (out.size === 0) throw new Error('ZIP 內找不到 .shp / .dbf / .prj 等 Shapefile 檔案');
  return out;
}

// ===== DBF 編碼偵測 =====
// .cpg 常見寫法：UTF-8 / 65001 / 950 / ANSI 950 / big5 / cp950 / ISO-8859-1
function cpgToLabel(cpgText) {
  if (!cpgText) return null;
  const t = String(cpgText).trim().toLowerCase();
  if (!t) return null;
  if (t.includes('utf-8') || t.includes('utf8') || t === '65001') return 'utf-8';
  if (t.includes('950') || t.includes('big5')) return 'big5';
  return t.replace(/^ansi\s+/, '');
}

// 評分：CJK 越多越好、U+FFFD（解碼失敗）與 Latin-1 高位區（典型亂碼）扣分
function scoreDecoded(rows) {
  let cjk = 0, bad = 0, latin = 0;
  for (const row of rows) {
    for (const v of Object.values(row || {})) {
      if (typeof v !== 'string') continue;
      for (const ch of v) {
        const c = ch.codePointAt(0);
        if (c === 0xfffd) bad++;
        else if (c >= 0x4e00 && c <= 0x9fff) cjk++;
        else if (c >= 0x80 && c <= 0xff) latin++;
      }
    }
  }
  return { score: cjk * 2 - bad * 4 - latin, cjk, bad };
}

// ===== Shapefile 圖層解析（單一 basename 的一組檔案）=====
async function parseOneLayer(shp, parts, layerName, notes) {
  const geometries = shp.parseShp(
    toArrayBuffer(parts.shp),
    parts.prj ? new TextDecoder('utf-8').decode(parts.prj) : undefined
  );

  let properties = [];
  let encodingUsed = null;
  if (parts.dbf) {
    const dbfBuf = toArrayBuffer(parts.dbf);
    const declared = parts.cpg ? cpgToLabel(new TextDecoder('utf-8').decode(parts.cpg)) : null;
    // 候選編碼依序試、擇優（宣告的優先權重相同，純比解出來的品質）
    const candidates = [];
    for (const label of [declared, 'utf-8', 'big5']) {
      if (label && !candidates.includes(label)) candidates.push(label);
    }
    let best = null;
    for (const label of candidates) {
      let rows;
      try {
        rows = shp.parseDbf(dbfBuf, label);
      } catch (e) {
        continue;   // TextDecoder 不認這個 label
      }
      const s = scoreDecoded(rows);
      if (!best || s.score > best.s.score) best = { label, rows, s };
      if (s.cjk === 0 && s.bad === 0) break;   // 純 ASCII，怎麼解都一樣
    }
    if (best) {
      properties = best.rows;
      encodingUsed = best.label;
      if (declared && declared !== best.label) {
        notes.push(`.cpg 宣告 ${declared}，但實測 ${best.label} 解得較乾淨 → 採用 ${best.label}`);
      } else if (!declared && best.label !== 'utf-8') {
        notes.push(`無 .cpg，自動偵測屬性編碼為 ${best.label}`);
      }
      if (best.s.bad > 0) {
        notes.push(`⚠ 屬性仍有 ${best.s.bad} 個無法解碼字元，中文可能不完整`);
      }
    }
  } else {
    notes.push(`${layerName}：無 .dbf，僅取幾何（屬性為空）`);
  }

  const fc = shp.combine([geometries, properties]);
  return { fc, encodingUsed, hasPrj: !!parts.prj };
}

function toArrayBuffer(u8) {
  if (u8 instanceof ArrayBuffer) return u8;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// 把 shpjs 可能回傳的 FeatureCollection / FeatureCollection[] 攤平成 features 陣列
function flattenToFeatures(result) {
  const out = [];
  const push = (fc) => {
    if (!fc) return;
    if (Array.isArray(fc)) { fc.forEach(push); return; }
    if (fc.type === 'FeatureCollection') out.push(...(fc.features || []));
    else if (fc.type === 'Feature') out.push(fc);
  };
  push(result);
  return out;
}

// ===== 主入口 =====
// 入：File[]（.zip 或 .shp/.shx/.dbf/.prj/.cpg 任意組合）
// 出：{ geojson: FeatureCollection, meta: { layers, featureCount, encoding, hasPrj, notes[] } }
// 幾何仍是原始座標系（有 .prj 已投影到 WGS84）→ 交給 parseProjectBoundaryGeoJson 收尾。
export async function shapefileFilesToGeoJson(files) {
  const list = Array.from(files || []);
  if (list.length === 0) throw new Error('沒有選到檔案');

  const shp = await loadShpLib();
  const notes = [];

  // 收集所有可用檔案（zip 展開 + 直接選的散檔）
  const parts = new Map();   // basename → { shp, dbf, prj, cpg }
  const addPart = (fileName, bytes) => {
    const e = extOf(fileName);
    if (!SHAPEFILE_EXTS.includes(e)) return;
    const b = baseOf(fileName);
    if (!parts.has(b)) parts.set(b, {});
    parts.get(b)[e] = bytes;
  };

  let zipFallback = null;
  for (const f of list) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (extOf(f.name) === 'zip') {
      try {
        const entries = await readZipEntries(buf.buffer);
        for (const [name, bytes] of entries) addPart(name, bytes);
      } catch (e) {
        // 自家 ZIP 讀取失敗 → 留給 shpjs 自帶解壓器（代價：DBF 編碼只能聽 .cpg 的）
        notes.push(`ZIP 直讀失敗（${e.message}），改用內建解壓器 — 若無 .cpg，中文屬性可能亂碼`);
        zipFallback = buf.buffer;
      }
    } else {
      addPart(f.name, buf);
    }
  }

  let features = [];
  let encoding = null;
  let hasPrj = false;
  const layers = [];

  for (const [name, p] of parts) {
    if (!p.shp) {
      notes.push(`「${name}」缺 .shp，略過（Shapefile 必須含 .shp）`);
      continue;
    }
    const { fc, encodingUsed, hasPrj: prj } = await parseOneLayer(shp, p, name, notes);
    const fs = flattenToFeatures(fc);
    features.push(...fs);
    layers.push(`${name}（${fs.length} 筆）`);
    if (encodingUsed && !encoding) encoding = encodingUsed;
    if (prj) hasPrj = true;
  }

  if (features.length === 0 && zipFallback) {
    const fc = await shp.parseZip(zipFallback);
    features = flattenToFeatures(fc);
    if (features.length) layers.push(`內建解壓器（${features.length} 筆）`);
  }

  if (layers.length === 0) {
    throw new Error('找不到 .shp — Shapefile 至少需要 .shp（建議同時附 .dbf / .prj / .shx）');
  }
  if (features.length === 0) {
    throw new Error('Shapefile 內沒有任何圖形');
  }

  // 幾何型別檢查：專案邊界要面，點/線要講清楚而不是丟一句「無 Polygon」
  const types = new Set(features.map(f => f?.geometry?.type).filter(Boolean));
  const hasPolygon = types.has('Polygon') || types.has('MultiPolygon');
  if (!hasPolygon) {
    throw new Error(
      `此 Shapefile 為 ${[...types].join(' / ') || '未知'} 類型，專案邊界需要面（Polygon / MultiPolygon）。` +
      '若原始資料是線（界線），請先在 GIS 軟體轉為面圖層再上傳。'
    );
  }
  if (types.size > 1) {
    notes.push(`混合幾何型別（${[...types].join(' / ')}），非面的圖形會被忽略`);
  }

  // 缺 .prj 不擋：下游 parseProjectBoundaryGeoJson 會自動判 TWD97 / WGS84
  if (!hasPrj) notes.push('無 .prj，改由座標範圍自動判斷 TWD97 / WGS84');

  return {
    geojson: { type: 'FeatureCollection', features },
    meta: { layers, featureCount: features.length, encoding, hasPrj, notes },
  };
}
