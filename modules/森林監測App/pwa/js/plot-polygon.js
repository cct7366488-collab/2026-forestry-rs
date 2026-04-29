// ===== plot-polygon.js — irregular plot 不規則多邊形 utility（v2.8.0）=====
//
// 目的：支援樣區劃設於不規則邊界（地形破碎、林班界、防火帶切割、私有地籍）。
//
// 設計：
//   - 頂點以「local meters 相對 plot.locationTWD97」儲存（與既有 rectangle plotDimensions 一致）
//   - Firestore 不支援陣列內陣列，所以 vertices 用 [{x, y}, ...] 物件陣列存
//   - 內部演算法用 [[x, y], ...] 陣列陣列（更接近教科書寫法）
//   - 強制 CCW（counter-clockwise）順序，閉合不需重複第一點
//   - strict 自交驗證（自交多邊形 Shoelace 會算錯，必擋）
//   - 3 ≤ 頂點數 ≤ 50（防 abuse + 涵蓋 99% 實務）
//
// 公式：
//   Shoelace area = |Σᵢ (xᵢ × yᵢ₊₁ − xᵢ₊₁ × yᵢ)| / 2
//   Point-in-polygon = ray casting（向 +X 射線計交點奇偶）
//   Self-intersection = 對非相鄰邊兩兩做 segment-segment intersect 測試
//
// IPCC 對齊：areaHorizontal_m2 = shoelaceArea × cos(slope) （dimensionType='slope_distance' 時）

export const VERTEX_MIN = 3;
export const VERTEX_MAX = 50;

// ===== 形式轉換 =====
//   db 存 [{x, y}, ...]；演算法用 [[x, y], ...]
export function vertsToArrays(verts) {
  if (!Array.isArray(verts)) return [];
  return verts.map(v => Array.isArray(v) ? v : [Number(v.x), Number(v.y)]);
}
export function arraysToVerts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(a => Array.isArray(a) ? { x: Number(a[0]), y: Number(a[1]) } : a);
}

// ===== Shoelace 面積（m²；輸入頂點為 local meters）=====
export function shoelaceArea(verts) {
  const a = vertsToArrays(verts);
  const n = a.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = a[i];
    const [xj, yj] = a[(i + 1) % n];
    sum += xi * yj - xj * yi;
  }
  return Math.abs(sum) / 2;
}

// ===== 多邊形帶符號面積（>0 = CCW，<0 = CW）=====
export function signedArea(verts) {
  const a = vertsToArrays(verts);
  const n = a.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = a[i];
    const [xj, yj] = a[(i + 1) % n];
    sum += xi * yj - xj * yi;
  }
  return sum / 2;
}

// ===== 確保 CCW 順序（CW → 反轉）=====
export function ensureCCW(verts) {
  return signedArea(verts) < 0 ? [...verts].reverse() : verts;
}

// ===== 自交檢查（O(n²)，3–50 頂點足以接受）=====
//   遍歷所有非相鄰邊對，看是否相交
//   相鄰邊（共用頂點）必相連於該頂點，不算自交
export function isSimplePolygon(verts) {
  const a = vertsToArrays(verts);
  const n = a.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const A = a[i], B = a[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // 跳過相鄰邊（i 與 i±1 共用頂點）
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const C = a[j], D = a[(j + 1) % n];
      if (segmentsIntersect(A, B, C, D)) return false;
    }
  }
  return true;
}

// ===== 線段相交（嚴格相交，不含端點接觸）=====
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
function cross(a, b, c) {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

// ===== 點對多邊形（ray casting）=====
export function isPointInPolygon(x, y, verts) {
  const a = vertsToArrays(verts);
  const n = a.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ===== 邊界框（給散布圖座標範圍用）=====
export function computeBbox(verts) {
  const a = vertsToArrays(verts);
  if (a.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of a) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

// ===== 重心（多邊形 centroid，非 bbox 中心）=====
export function computeCentroid(verts) {
  const a = vertsToArrays(verts);
  const n = a.length;
  if (n < 3) return { x: 0, y: 0 };
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = a[i];
    const [xj, yj] = a[(i + 1) % n];
    const f = xi * yj - xj * yi;
    cx += (xi + xj) * f;
    cy += (yi + yj) * f;
    area += f;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) return { x: a[0][0], y: a[0][1] };
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

// ===== 完整驗證（給 forms / rules 用）=====
//   回傳 { ok, error?, vertices?（normalised CCW + 去重）}
export function validatePolygon(verts) {
  if (!Array.isArray(verts)) return { ok: false, error: 'vertices 必須為陣列' };
  if (verts.length < VERTEX_MIN) return { ok: false, error: `頂點數需 ≥ ${VERTEX_MIN}（目前 ${verts.length}）` };
  if (verts.length > VERTEX_MAX) return { ok: false, error: `頂點數需 ≤ ${VERTEX_MAX}（目前 ${verts.length}）` };
  // 數值有效性
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const x = Array.isArray(v) ? v[0] : v?.x;
    const y = Array.isArray(v) ? v[1] : v?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: `頂點 #${i + 1} 座標非有效數字` };
    }
  }
  // 移除連續重複頂點（誤填 / 上傳資料常見）
  const a = vertsToArrays(verts);
  const dedup = [a[0]];
  for (let i = 1; i < a.length; i++) {
    const prev = dedup[dedup.length - 1];
    if (Math.abs(a[i][0] - prev[0]) > 1e-6 || Math.abs(a[i][1] - prev[1]) > 1e-6) {
      dedup.push(a[i]);
    }
  }
  // 移除最後一點若與第一點相同（GeoJSON 格式常見閉合重複）
  if (dedup.length > 1) {
    const first = dedup[0], last = dedup[dedup.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
      dedup.pop();
    }
  }
  if (dedup.length < VERTEX_MIN) return { ok: false, error: `去重後頂點數 ${dedup.length} 不足（< ${VERTEX_MIN}）` };
  // 自交檢查
  if (!isSimplePolygon(dedup)) return { ok: false, error: '多邊形自交（邊互相穿越）— 請檢查頂點順序或改用簡單多邊形' };
  // 面積 > 0（避免退化）
  const area = shoelaceArea(dedup);
  if (area < 1) return { ok: false, error: `面積過小（${area.toFixed(3)} m² < 1 m²）— 多邊形可能退化或單位錯誤` };
  // CCW 強制
  const ccw = signedArea(dedup) < 0 ? [...dedup].reverse() : dedup;
  return { ok: true, vertices: arraysToVerts(ccw), area };
}

// ===== GeoJSON 解析 =====
//   支援：FeatureCollection（取第一個 Polygon）/ Feature / Polygon / MultiPolygon（取第一個）
//   座標自動偵測：lat/lng 範圍 → WGS84，否則 TWD97 absolute
//   plotCenterTwd97：{ x, y } — plot.locationTWD97，用來做 local 偏移
export function parseGeoJsonPolygon(geojson, plotCenterTwd97, twd97ToWgs84Fn = null, wgs84ToTwd97Fn = null) {
  if (!geojson) throw new Error('GeoJSON 為空');
  let coordinates;
  // 取出 Polygon 的 coordinates
  const root = geojson.type ? geojson : null;
  if (!root) throw new Error('GeoJSON 缺 type 欄位');
  if (root.type === 'FeatureCollection') {
    const f = (root.features || []).find(ft => ft.geometry?.type === 'Polygon' || ft.geometry?.type === 'MultiPolygon');
    if (!f) throw new Error('FeatureCollection 內無 Polygon / MultiPolygon');
    coordinates = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
  } else if (root.type === 'Feature') {
    if (root.geometry?.type === 'Polygon') coordinates = root.geometry.coordinates;
    else if (root.geometry?.type === 'MultiPolygon') coordinates = root.geometry.coordinates[0];
    else throw new Error(`Feature.geometry.type='${root.geometry?.type}' 不支援（需 Polygon/MultiPolygon）`);
  } else if (root.type === 'Polygon') {
    coordinates = root.coordinates;
  } else if (root.type === 'MultiPolygon') {
    coordinates = root.coordinates[0];
  } else {
    throw new Error(`不支援的 GeoJSON type: ${root.type}`);
  }
  if (!coordinates || coordinates.length === 0) throw new Error('Polygon coordinates 為空');
  const ring = coordinates[0];  // 取外環，洞先忽略
  if (!Array.isArray(ring) || ring.length < 3) throw new Error('外環頂點 < 3');

  // 偵測座標系（TWD97 約 [200000, 400000] × [2400000, 2800000]；WGS84 約 [120, 122] × [22, 25]）
  const sample = ring[0];
  if (!Array.isArray(sample) || sample.length < 2) throw new Error('coordinates 元素格式錯誤');
  const isWgs84 = Math.abs(sample[0]) < 360 && Math.abs(sample[1]) < 90;

  // 轉成 absolute TWD97 → 再減去 plot 中心 → local m
  const absTwd97 = ring.map(c => {
    const [a, b] = c;
    if (isWgs84) {
      if (typeof wgs84ToTwd97Fn !== 'function') throw new Error('WGS84 GeoJSON 需要 wgs84ToTwd97 函式');
      const t = wgs84ToTwd97Fn(a, b);  // (lng, lat) → {x, y}
      return [t.x, t.y];
    }
    return [Number(a), Number(b)];
  });
  if (!plotCenterTwd97 || !Number.isFinite(plotCenterTwd97.x) || !Number.isFinite(plotCenterTwd97.y)) {
    throw new Error('plot.locationTWD97 缺值，無法計算 local 座標 — 請先設定樣區 GPS');
  }
  const local = absTwd97.map(([x, y]) => [x - plotCenterTwd97.x, y - plotCenterTwd97.y]);
  return { vertices: arraysToVerts(local), srcSystem: isWgs84 ? 'WGS84' : 'TWD97' };
}

// ===== 立木分布散布圖：邊界 path（給 Canvas / SVG 用）=====
//   給定 mxToPx, myToPy，回傳一個 [px, py] 陣列（依顯示空間）
export function vertsToPxPath(verts, mxToPx, myToPy) {
  return vertsToArrays(verts).map(([x, y]) => [mxToPx(x), myToPy(y)]);
}
