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
export const PLOT_SHAPES = ['circle', 'square', 'rectangle'];
export const DIMENSION_TYPES = ['slope_distance', 'horizontal'];
export const SLOPE_SOURCES = ['field', 'dem', 'dem_field_avg'];

// ----- 預設值（既有資料 migration 用，最保守）-----
//   舊資料無 slope 欄位 → 假設平地（slope=0、areaHorizontal = areaSlope）
//   舊資料無 dimensionType → 標 'horizontal'（避免錯誤套 cos 校正）
export const MIGRATION_DEFAULTS = Object.freeze({
  slopeDegrees: 0,
  slopeAspect: null,
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
export function computeAreaHorizontal(area_m2, slopeDeg, dimensionType) {
  if (!Number.isFinite(area_m2) || area_m2 <= 0) return 0;
  if (dimensionType === 'horizontal') return area_m2;
  const s = clampSlope(slopeDeg);
  return area_m2 * Math.cos(s * DEG2RAD);
}

// ===== 反向：從水平投影面積反算沿坡距面積（罕用，但保留對稱）=====
export function computeAreaSlope(areaHorizontal_m2, slopeDeg) {
  if (!Number.isFinite(areaHorizontal_m2) || areaHorizontal_m2 <= 0) return 0;
  const s = clampSlope(slopeDeg);
  const cos = Math.cos(s * DEG2RAD);
  return cos > 1e-6 ? areaHorizontal_m2 / cos : areaHorizontal_m2;
}

// ===== 立木座標換算（沿坡距 ↔ 水平投影）=====
//   只在 Y 方向（沿坡方向）做 cos 校正；X 方向（沿等高線）不變。
//   dimensionType 決定 input：
//     'slope_distance'：input 是沿坡 → 乘 cos(slope) 得水平投影
//     'horizontal'：input 已是水平 → 直接回傳
export function localToHorizontal(localX_m, localY_m, slopeDeg, dimensionType) {
  if (dimensionType === 'horizontal') return { x: localX_m, y: localY_m };
  const s = clampSlope(slopeDeg);
  return { x: localX_m, y: localY_m * Math.cos(s * DEG2RAD) };
}

export function horizontalToLocal(horizX_m, horizY_m, slopeDeg) {
  const s = clampSlope(slopeDeg);
  const cos = Math.cos(s * DEG2RAD);
  return { x: horizX_m, y: cos > 1e-6 ? horizY_m / cos : horizY_m };
}

// ===== plotDimensions 結構驗證 =====
//   shape='circle'    → { radius }
//   shape='square'    → { side } 或 { width, length } 且 width===length
//   shape='rectangle' → { width, length }
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
  // rectangle
  const w = Number(dimensions.width), l = Number(dimensions.length);
  if (!Number.isFinite(w) || w <= 0) return { ok: false, error: 'rectangle 需 width > 0' };
  if (!Number.isFinite(l) || l <= 0) return { ok: false, error: 'rectangle 需 length > 0' };
  return { ok: true };
}

// ===== 從 plotDimensions 推算名目面積（沿坡距 or 水平投影，取決於 dimensionType）=====
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
export function enrichPlotOnWrite(plotData, methodology) {
  const out = { ...plotData };

  // 1. dimensionType：plot 層覆蓋 methodology 預設
  const dimType = out.dimensionType
    || methodology?.dimensionType
    || MIGRATION_DEFAULTS.dimensionType;
  out.dimensionType = dimType;

  // 2. slope 欄位預設
  if (out.slopeDegrees == null) out.slopeDegrees = MIGRATION_DEFAULTS.slopeDegrees;

  // 3. areaHorizontal_m2 自動算
  const baseArea = Number.isFinite(out.area_m2) ? out.area_m2 : 0;
  out.areaHorizontal_m2 = computeAreaHorizontal(baseArea, out.slopeDegrees, dimType);

  // 4. areaSlope_m2：沿坡距名目面積（dimensionType='slope_distance' 時 = area_m2；否則反推）
  out.areaSlope_m2 = dimType === 'slope_distance'
    ? baseArea
    : computeAreaSlope(baseArea, out.slopeDegrees);

  return out;
}

// ===== 讀取時的補洞（既有資料無新欄位 → 視為待補登）=====
//   不寫回 db；只在 client 端讀取後 normalize，避免下游 NaN。
export function normalizePlotOnRead(plot) {
  if (!plot) return plot;
  const out = { ...plot };
  if (out.dimensionType == null) out.dimensionType = MIGRATION_DEFAULTS.dimensionType;
  if (out.slopeDegrees == null)  out.slopeDegrees  = MIGRATION_DEFAULTS.slopeDegrees;
  if (out.areaHorizontal_m2 == null) {
    out.areaHorizontal_m2 = computeAreaHorizontal(out.area_m2, out.slopeDegrees, out.dimensionType);
  }
  // migrationPending 缺失視為 true（既有資料未走過新欄位流程）
  if (out.migrationPending == null && (plot.slopeDegrees == null || plot.dimensionType == null)) {
    out.migrationPending = true;
  }
  return out;
}
