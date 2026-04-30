// ===== plot-geometry.js — 樣區幾何 + 坡度修正（v2.7.15 schema 升級落地）=====
//
// 目的：把「樣區幾何」與「坡度修正」從隱含假設變成顯式 schema。
// 解決野外實採（沿坡距矩形）與計算/報告（水平投影）之間的單位歧義。
//
// 設計原則（呼應 user feedback「樣區幾何假設」記憶）：
//   - 不預設方形；rectangle 與 circle 同一等公民
//   - dimensionType 兩個都存（input 沿坡距、寫入時計算水平投影）
//   - 既有資料無 slope/dimensions → 預設 slope=0、dimensionType='horizontal'（最保守）
//   - migrationPending=true 標記待補登 → v2.7.16 UI 點 badge 補登
//
// v2.7.15 schema only：本檔僅提供工具函式，UI / 立木分布圖整合在 v2.7.16。

// ----- enum -----
// v2.8.0：plotShape 加 'irregular'（不規則多邊形，依 plotDimensions.vertices 推算面積）
export const PLOT_SHAPES = ['circle', 'square', 'rectangle', 'irregular'];
export const DIMENSION_TYPES = ['slope_distance', 'horizontal'];
export const SLOPE_SOURCES = ['field', 'dem', 'dem_field_avg'];

// ----- 預設值（既有資料 migration 用，最保守）-----
//   舊資料無 slope 欄位 → 假設平地（slope=0、areaHorizontal = areaSlope）
//   舊資料無 dimensionType → 標 'horizontal'（避免錯誤套 cos 校正）
//   v2.8.4：新增 slopeWidthDeg / slopeLengthDeg（雙軸坡度，rectangle 寬邊 / 長邊各自坡度）
//          舊資料 fallback：slopeWidthDeg = slopeLengthDeg = slopeDegrees
export const MIGRATION_DEFAULTS = Object.freeze({
  slopeDegrees: 0,        // 主坡度（= slopeLengthDeg，沿坡為主，下游碳計算/QAQC 仍讀此欄）
  slopeWidthDeg: 0,       // v2.8.4：寬邊坡度（rectangle 寬邊方向，通常沿等高線）
  slopeLengthDeg: 0,      // v2.8.4：長邊坡度（rectangle 長邊方向，通常沿坡）
  slopeAspect: null,      // v2.8.4：淘汰，新表單不再寫入；既有資料保留不動
  slopeSource: null,
  slopeFieldDegrees: null,
  slopeDemDegrees: null,
  dimensionType: 'horizontal',
  migrationPending: true
});

// ===== 角度 / 弧度換算 =====
const DEG2RAD = Math.PI / 180;

// ===== cos 校正：水平投影面積 = 沿坡距面積 × cos(slope) =====
//   slopeDeg ∈ [0, 90]；slope=0 → 不修正（水平地）
//   dimensionType='horizontal' → 不修正（dimensions 已是水平投影）
//   v2.8.4：保留單軸版（向後相容；下游程式如 QAQC error / migration / analytics 仍呼叫）
export function computeAreaHorizontal(area_m2, slopeDeg, dimensionType) {
  return computeAreaHorizontal2D(area_m2, slopeDeg, slopeDeg, dimensionType);
}

// ===== v2.8.4：雙軸 cos 校正 =====
//   水平投影面積 = 沿坡距面積 × cos(slopeWidth) × cos(slopeLength)
//   背景：rectangle 樣區寬邊與長邊可能位於不同坡度（地形折）
//        野外實測時 surveyor 用皮尺沿地表拉，寬/長各自延著各自方向坡度
//   slopeWidthDeg / slopeLengthDeg ∈ [0, 90]；任一 = 0 退化為單軸校正
//   dimensionType='horizontal' → 不修正
export function computeAreaHorizontal2D(area_m2, slopeWidthDeg, slopeLengthDeg, dimensionType) {
  if (!Number.isFinite(area_m2) || area_m2 <= 0) return 0;
  if (dimensionType === 'horizontal') return area_m2;
  const sW = clampSlope(slopeWidthDeg);
  const sL = clampSlope(slopeLengthDeg);
  return area_m2 * Math.cos(sW * DEG2RAD) * Math.cos(sL * DEG2RAD);
}

// ===== 反向：從水平投影面積反算沿坡距面積（罕用，但保留對稱）=====
export function computeAreaSlope(areaHorizontal_m2, slopeDeg) {
  return computeAreaSlope2D(areaHorizontal_m2, slopeDeg, slopeDeg);
}

export function computeAreaSlope2D(areaHorizontal_m2, slopeWidthDeg, slopeLengthDeg) {
  if (!Number.isFinite(areaHorizontal_m2) || areaHorizontal_m2 <= 0) return 0;
  const sW = clampSlope(slopeWidthDeg);
  const sL = clampSlope(slopeLengthDeg);
  const denom = Math.cos(sW * DEG2RAD) * Math.cos(sL * DEG2RAD);
  return denom > 1e-6 ? areaHorizontal_m2 / denom : areaHorizontal_m2;
}

// ===== 立木座標換算（沿坡距 ↔ 水平投影）=====
//   v2.8.4：升級為雙軸 — X 方向用 slopeWidthDeg、Y 方向用 slopeLengthDeg
//   保留單軸版本（slopeDeg 同時應用兩軸），向後相容
//   dimensionType 決定 input：
//     'slope_distance'：input 是沿坡 → 乘 cos(slope) 得水平投影
//     'horizontal'：input 已是水平 → 直接回傳
export function localToHorizontal(localX_m, localY_m, slopeDeg, dimensionType) {
  return localToHorizontal2D(localX_m, localY_m, slopeDeg, slopeDeg, dimensionType);
}

export function localToHorizontal2D(localX_m, localY_m, slopeWidthDeg, slopeLengthDeg, dimensionType) {
  if (dimensionType === 'horizontal') return { x: localX_m, y: localY_m };
  const sW = clampSlope(slopeWidthDeg);
  const sL = clampSlope(slopeLengthDeg);
  return {
    x: localX_m * Math.cos(sW * DEG2RAD),
    y: localY_m * Math.cos(sL * DEG2RAD)
  };
}

export function horizontalToLocal(horizX_m, horizY_m, slopeDeg) {
  return horizontalToLocal2D(horizX_m, horizY_m, slopeDeg, slopeDeg);
}

export function horizontalToLocal2D(horizX_m, horizY_m, slopeWidthDeg, slopeLengthDeg) {
  const sW = clampSlope(slopeWidthDeg);
  const sL = clampSlope(slopeLengthDeg);
  const cosW = Math.cos(sW * DEG2RAD);
  const cosL = Math.cos(sL * DEG2RAD);
  return {
    x: cosW > 1e-6 ? horizX_m / cosW : horizX_m,
    y: cosL > 1e-6 ? horizY_m / cosL : horizY_m
  };
}

// ===== v2.8.4：從水平名目尺寸（如 20×25）+ 兩坡度 → 沿坡距尺寸（surveyor 拉皮尺要拉的長度）=====
//   nominalWidth / nominalLength：方法學定的水平名目尺寸（rectangle 預設 20 / 25）
//   寬邊沿坡距 = nominalWidth / cos(slopeWidth)；長邊沿坡距 = nominalLength / cos(slopeLength)
//   應用：plot form 用戶輸入坡度 → 自動填寬/長欄位
export function nominalToSlopeDistance(nominalWidth, nominalLength, slopeWidthDeg, slopeLengthDeg) {
  const sW = clampSlope(slopeWidthDeg);
  const sL = clampSlope(slopeLengthDeg);
  const cosW = Math.cos(sW * DEG2RAD);
  const cosL = Math.cos(sL * DEG2RAD);
  return {
    widthSlope: cosW > 1e-6 ? nominalWidth / cosW : nominalWidth,
    lengthSlope: cosL > 1e-6 ? nominalLength / cosL : nominalLength
  };
}

// ===== plotDimensions 結構驗證 =====
//   shape='circle'    → { radius }
//   shape='square'    → { side } 或 { width, length } 且 width===length
//   shape='rectangle' → { width, length }
//   shape='irregular' → { vertices: [{x,y},...] }（v2.8.0；3-50 頂點，深度驗證見 plot-polygon.js）
export function validatePlotDimensions(shape, dimensions) {
  if (!shape || !PLOT_SHAPES.includes(shape)) {
    return { ok: false, error: `不支援的 shape: ${shape}（允許: ${PLOT_SHAPES.join(', ')}）` };
  }
  if (!dimensions || typeof dimensions !== 'object') {
    return { ok: false, error: 'dimensions 必須為物件' };
  }
  if (shape === 'circle') {
    const r = Number(dimensions.radius);
    if (!Number.isFinite(r) || r <= 0) return { ok: false, error: 'circle 需 radius > 0' };
    return { ok: true };
  }
  if (shape === 'square') {
    const side = Number(dimensions.side ?? dimensions.width ?? dimensions.length);
    if (!Number.isFinite(side) || side <= 0) return { ok: false, error: 'square 需 side（或 width/length）> 0' };
    return { ok: true };
  }
  if (shape === 'rectangle') {
    const w = Number(dimensions.width), l = Number(dimensions.length);
    if (!Number.isFinite(w) || w <= 0) return { ok: false, error: 'rectangle 需 width > 0' };
    if (!Number.isFinite(l) || l <= 0) return { ok: false, error: 'rectangle 需 length > 0' };
    return { ok: true };
  }
  // irregular（v2.8.0）— 淺驗證（深驗證在 plot-polygon.js#validatePolygon）
  if (shape === 'irregular') {
    if (!Array.isArray(dimensions.vertices) || dimensions.vertices.length < 3) {
      return { ok: false, error: 'irregular 需 vertices 陣列且 ≥ 3 頂點（深度驗證請呼叫 plot-polygon.js#validatePolygon）' };
    }
    return { ok: true };
  }
  return { ok: false, error: `未實作 shape=${shape} 的驗證` };
}

// ===== 從 plotDimensions 推算名目面積（沿坡距 or 水平投影，取決於 dimensionType）=====
//   v2.8.0：irregular 用 Shoelace 公式（呼叫 plot-polygon.js）
//   為避免循環 import，這裡只做基本算法 — circle/square/rectangle；irregular 由 caller 預先算好填 dimensions._cachedArea
export function dimensionsToArea(shape, dimensions) {
  if (shape === 'circle') {
    const r = Number(dimensions?.radius);
    return Number.isFinite(r) && r > 0 ? Math.PI * r * r : 0;
  }
  if (shape === 'square') {
    const side = Number(dimensions?.side ?? dimensions?.width ?? dimensions?.length);
    return Number.isFinite(side) && side > 0 ? side * side : 0;
  }
  if (shape === 'rectangle') {
    const w = Number(dimensions?.width), l = Number(dimensions?.length);
    return Number.isFinite(w) && Number.isFinite(l) && w > 0 && l > 0 ? w * l : 0;
  }
  if (shape === 'irregular') {
    // 簡單 Shoelace（避免從 plot-polygon.js 循環引入）
    const verts = dimensions?.vertices;
    if (!Array.isArray(verts) || verts.length < 3) return 0;
    let sum = 0;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[i], b = verts[(i + 1) % n];
      const ax = Array.isArray(a) ? a[0] : a?.x;
      const ay = Array.isArray(a) ? a[1] : a?.y;
      const bx = Array.isArray(b) ? b[0] : b?.x;
      const by = Array.isArray(b) ? b[1] : b?.y;
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return 0;
      sum += ax * by - bx * ay;
    }
    return Math.abs(sum) / 2;
  }
  return 0;
}

// ===== slope 範圍夾取 =====
function clampSlope(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 90) return 90;
  return n;
}

// ===== slope 來源欄位驗證（dem_field_avg 時兩個 source 都要有）=====
export function validateSlopeFields(plot) {
  const { slopeSource, slopeFieldDegrees, slopeDemDegrees } = plot || {};
  if (slopeSource == null) return { ok: true };  // 未設定 = 待補登，pass
  if (!SLOPE_SOURCES.includes(slopeSource)) {
    return { ok: false, error: `不支援的 slopeSource: ${slopeSource}` };
  }
  if (slopeSource === 'dem_field_avg') {
    if (!Number.isFinite(slopeFieldDegrees) || !Number.isFinite(slopeDemDegrees)) {
      return { ok: false, error: 'slopeSource=dem_field_avg 需同時有 slopeFieldDegrees 與 slopeDemDegrees' };
    }
  }
  return { ok: true };
}

// ===== 整合：plot 寫入前的 enrich（自動補 areaHorizontal_m2 + 預設值）=====
//   呼叫時機：forms.js openPlotForm submit / import wizard final write
//   v2.7.15：本函式已可用；v2.7.16 UI 落地後接上。
//   v2.8.4：升級為雙軸 — slopeWidthDeg / slopeLengthDeg 各自存；slopeDegrees 同步為 slopeLengthDeg（向後相容）
export function enrichPlotOnWrite(plotData, methodology) {
  const out = { ...plotData };

  // 1. dimensionType：plot 層覆蓋 methodology 預設
  const dimType = out.dimensionType
    || methodology?.dimensionType
    || MIGRATION_DEFAULTS.dimensionType;
  out.dimensionType = dimType;

  // 2. slope 欄位預設（雙軸；向後相容單軸）
  //    優先序：明確指定的 width/length > 舊單軸 slopeDegrees > 0
  const fallbackSlope = Number.isFinite(out.slopeDegrees) ? out.slopeDegrees : MIGRATION_DEFAULTS.slopeDegrees;
  if (out.slopeWidthDeg == null)  out.slopeWidthDeg  = fallbackSlope;
  if (out.slopeLengthDeg == null) out.slopeLengthDeg = fallbackSlope;
  // 主坡度 = 長邊坡度（沿坡為主，下游碳計算/QAQC 仍讀此欄）
  out.slopeDegrees = out.slopeLengthDeg;

  // 3. areaHorizontal_m2 自動算（雙軸）
  const baseArea = Number.isFinite(out.area_m2) ? out.area_m2 : 0;
  out.areaHorizontal_m2 = computeAreaHorizontal2D(baseArea, out.slopeWidthDeg, out.slopeLengthDeg, dimType);

  // 4. areaSlope_m2：沿坡距名目面積（dimensionType='slope_distance' 時 = area_m2；否則反推雙軸）
  out.areaSlope_m2 = dimType === 'slope_distance'
    ? baseArea
    : computeAreaSlope2D(baseArea, out.slopeWidthDeg, out.slopeLengthDeg);

  return out;
}

// ===== 讀取時的補洞（既有資料無新欄位 → 視為待補登）=====
//   不寫回 db；只在 client 端讀取後 normalize，避免下游 NaN。
//   v2.8.4：新增 slopeWidthDeg / slopeLengthDeg fallback（從舊 slopeDegrees）
export function normalizePlotOnRead(plot) {
  if (!plot) return plot;
  const out = { ...plot };
  if (out.dimensionType == null) out.dimensionType = MIGRATION_DEFAULTS.dimensionType;
  if (out.slopeDegrees == null)  out.slopeDegrees  = MIGRATION_DEFAULTS.slopeDegrees;
  // v2.8.4：雙軸 fallback — 舊資料無 slopeWidthDeg/slopeLengthDeg → 用 slopeDegrees 同值補
  if (out.slopeWidthDeg == null)  out.slopeWidthDeg  = out.slopeDegrees;
  if (out.slopeLengthDeg == null) out.slopeLengthDeg = out.slopeDegrees;
  if (out.areaHorizontal_m2 == null) {
    out.areaHorizontal_m2 = computeAreaHorizontal2D(out.area_m2, out.slopeWidthDeg, out.slopeLengthDeg, out.dimensionType);
  }
  // migrationPending 缺失視為 true（既有資料未走過新欄位流程）
  if (out.migrationPending == null && (plot.slopeDegrees == null || plot.dimensionType == null)) {
    out.migrationPending = true;
  }
  return out;
}
