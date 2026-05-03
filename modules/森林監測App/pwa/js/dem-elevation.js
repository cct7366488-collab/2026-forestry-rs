// ===== dem-elevation.js — v2.10.9 DEM 海拔自動偵測 =====
// 用 open-meteo 免費 elevation API（無需 key）查詢 plot GPS → 海拔（m）
//   端點: https://api.open-meteo.com/v1/elevation?latitude=lat&longitude=lng
//   回應: { elevation: [m] }
//   解析度: ~90m (NASA SRTM 衍生)，台灣山區誤差 ±10-30m
//   對於低 / 中 / 高 band 切分（500m / 1500m）綽綽有餘
//
// 用法：
//   import { getElevation, elevationToBand } from './dem-elevation.js';
//   const elev = await getElevation(23.5, 120.5);   // → 1234.5 (m) 或 null
//   const band = elevationToBand(elev);              // → 'low' | 'mid' | 'high' | null

// 模組層 cache — key="lat,lng" 四位小數（~10m 精度）
const _cache = new Map();

export async function getElevation(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_cache.has(key)) return _cache.get(key);
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);    // 10s timeout
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const elev = Array.isArray(data?.elevation) ? data.elevation[0] : null;
    // sanity check：台灣 -50 ~ 4500m（玉山 3952m，外加緩衝）
    if (typeof elev !== 'number' || elev < -50 || elev > 4500) {
      console.warn('[dem-elevation] 異常 elevation', elev, '@', lat, lng);
      _cache.set(key, null);
      return null;
    }
    _cache.set(key, elev);
    return elev;
  } catch (e) {
    console.warn('[dem-elevation] open-meteo fetch failed', e);
    _cache.set(key, null);                              // 失敗也 cache，避免重複打 API
    return null;
  }
}

// 海拔 → band（與 species-picker ELEV_BANDS 切分一致）
//   低 < 500m / 中 500-1500m / 高 > 1500m
export function elevationToBand(elev) {
  if (typeof elev !== 'number') return null;
  if (elev < 500) return 'low';
  if (elev <= 1500) return 'mid';
  return 'high';
}

export function bandLabel(band) {
  return band === 'low' ? '低海拔'
       : band === 'mid' ? '中海拔'
       : band === 'high' ? '高海拔'
       : '未知';
}
