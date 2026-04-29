// ===== plot-qaqc.js — Reviewer QAQC 工作流 utility（v2.7.17）=====
//
// 目的：把「簽發按鈕雛形」升級為「抽樣 → 現場核對 → 誤差計算 → 合格簽發」完整工作流。
// 對標：ISO 14064-3、IPCC GPG（合理保證 reasonable assurance）、TMS 方法學監測計畫、
//      VVB / DOE 第三方查證程序。
//
// 設計：
//   - 樣區層級抽樣（plot-level QC）：reviewer 抽 N 個 plots 重測坡度 + dimensions
//   - 立木層級抽樣留 v2.8 backlog（dbh/height/position 比對）
//   - 誤差閾值：slope ±5°、area ±3%（對齊 IPCC GPG）
//   - 超閾值必須有 resolution（accepted / remeasured / rejected） + 註記
//   - 全部抽樣 plot 都 passed/resolved → 啟用合格簽發

// ===== 預設 qaqcConfig（給 DEFAULT_METHODOLOGY / 新建 project）=====
export const DEFAULT_QAQC_CONFIG = Object.freeze({
  samplingFraction: 0.30,            // 30%（紙漿廠 19 plots → 抽 6）
  minSampleSize: 3,                  // 至少 3 個（小專案防呆）
  slopeThreshold_deg: 5,             // ±5° 內合格
  areaThreshold_pct: 3,              // ±3% 內合格
  requireAllSampledPassed: true,     // 全部抽樣 plot 必須合格才能簽發
  requireResolutionForFailed: true,  // 超閾值必須有處置才能簽發
});

// ===== 樣本量目標（依 config 與總 plots 數）=====
export function computeTargetSampleSize(plotCount, qaqcConfig = DEFAULT_QAQC_CONFIG) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...qaqcConfig };
  const fractional = Math.ceil(plotCount * (cfg.samplingFraction ?? DEFAULT_QAQC_CONFIG.samplingFraction));
  return Math.max(fractional, cfg.minSampleSize ?? DEFAULT_QAQC_CONFIG.minSampleSize);
}

// ===== 隨機抽樣（Fisher–Yates shuffle，種子可選）=====
//   為保留可重現性，可傳 seed（例如 timestamp）；否則用 Math.random
export function pickRandomSample(plots, targetSize, seed = null) {
  const arr = plots.filter(p => p.qaStatus !== 'shell');  // shell 樣區不參與 QAQC
  if (arr.length === 0) return [];
  const k = Math.min(targetSize, arr.length);
  // 簡易 mulberry32 PRNG（讓抽樣可重現）
  const rng = seed != null ? mulberry32(Number(seed)) : Math.random;
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k).map(i => arr[i]);
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== 誤差計算（reviewer save 時觸發；存在 plot.qaqc.*Error_*）=====
//   slopeError_deg：絕對誤差（°）
//   areaError_pct：相對誤差（%，relative to surveyor 原值）
//   withinThreshold：兩者都在閾值內 = true
export function computeQaqcErrors(plot, qaqcVerified, qaqcConfig = DEFAULT_QAQC_CONFIG) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...qaqcConfig };
  const out = {};

  // slope 誤差
  const slopeOrig = Number(plot?.slopeDegrees);
  const slopeNew  = Number(qaqcVerified?.slopeVerified);
  if (Number.isFinite(slopeOrig) && Number.isFinite(slopeNew)) {
    out.slopeError_deg = Math.abs(slopeNew - slopeOrig);
  } else {
    out.slopeError_deg = null;
  }

  // 面積誤差（用 areaHorizontal_m2 比對 — 是碳計算的單位）
  const areaOrig = Number(plot?.areaHorizontal_m2);
  const areaNew  = Number(qaqcVerified?.areaVerifiedHorizontal);
  if (Number.isFinite(areaOrig) && areaOrig > 0 && Number.isFinite(areaNew)) {
    out.areaError_pct = Math.abs((areaNew - areaOrig) / areaOrig) * 100;
  } else {
    out.areaError_pct = null;
  }

  // 是否通過閾值（兩者都過 = true；任一缺值 = null 視為「待重測」）
  const slopeOk = out.slopeError_deg == null
    ? null
    : out.slopeError_deg <= cfg.slopeThreshold_deg;
  const areaOk = out.areaError_pct == null
    ? null
    : out.areaError_pct <= cfg.areaThreshold_pct;
  if (slopeOk == null || areaOk == null) out.withinThreshold = null;
  else out.withinThreshold = slopeOk && areaOk;

  return out;
}

// ===== 單 plot QAQC 狀態（給 UI chip / 統計用）=====
//   'not_sampled'：不在樣本內
//   'pending'：在樣本內，尚未重測
//   'passed'：在樣本內，已重測，誤差通過閾值
//   'failed_unresolved'：在樣本內，已重測，誤差超閾值，無處置
//   'failed_resolved'：在樣本內，已重測，誤差超閾值，已有處置
export function getPlotQaqcStatus(plot) {
  const q = plot?.qaqc || {};
  if (!q.inSample) return 'not_sampled';
  if (q.verifiedAt == null && q.slopeVerified == null && q.areaVerifiedHorizontal == null) {
    return 'pending';
  }
  if (q.withinThreshold === true) return 'passed';
  if (q.withinThreshold === false) {
    return q.resolution ? 'failed_resolved' : 'failed_unresolved';
  }
  return 'pending';  // 缺值（如僅填一個欄位）也視為 pending
}

export const QAQC_STATUS_META = Object.freeze({
  not_sampled:        { label: '不在抽樣',  badge: '⚪',   color: '#a8a29e', cls: 'bg-stone-100 text-stone-600' },
  pending:            { label: '待重測',    badge: '🟡',   color: '#d97706', cls: 'bg-amber-100 text-amber-800' },
  passed:             { label: '通過',     badge: '✅',   color: '#16a34a', cls: 'bg-green-100 text-green-800' },
  failed_unresolved:  { label: '超閾待處置', badge: '❌',   color: '#dc2626', cls: 'bg-red-100 text-red-800' },
  failed_resolved:    { label: '已處置',    badge: '🟢',   color: '#0f766e', cls: 'bg-teal-100 text-teal-800' },
});

export const RESOLUTION_LABEL = Object.freeze({
  accepted:   '可接受（reviewer 判斷誤差屬正常範圍）',
  remeasured: '重新量測（surveyor / 第三方再量）',
  rejected:   '退回（資料不採信，需重做）',
});

// ===== 簽發前檢查（v2.7 reviewer-approve 整合）=====
//   傳入：所有 plot 陣列（已含 qaqc 子結構）+ qaqcConfig
//   回傳：{ canApprove, reasons, summary } 給 UI 顯示
export function checkApprovalGate(plots, qaqcConfig = DEFAULT_QAQC_CONFIG) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...qaqcConfig };
  const summary = {
    totalPlots: 0,
    sampled: 0,
    pending: 0,
    passed: 0,
    failedResolved: 0,
    failedUnresolved: 0,
  };
  const reasons = [];

  for (const p of plots) {
    if (p.qaStatus === 'shell') continue;
    summary.totalPlots++;
    const s = getPlotQaqcStatus(p);
    if (s === 'not_sampled') continue;
    summary.sampled++;
    if (s === 'pending') summary.pending++;
    else if (s === 'passed') summary.passed++;
    else if (s === 'failed_resolved') summary.failedResolved++;
    else if (s === 'failed_unresolved') summary.failedUnresolved++;
  }

  // 條件 1：抽樣數須達目標
  const target = computeTargetSampleSize(summary.totalPlots, cfg);
  if (summary.sampled < target) {
    reasons.push(`抽樣數不足：已抽 ${summary.sampled} / 目標 ${target}（${(cfg.samplingFraction * 100).toFixed(0)}% × ${summary.totalPlots} plots）`);
  }

  // 條件 2：所有抽樣 plot 都不能 pending
  if (summary.pending > 0) {
    reasons.push(`還有 ${summary.pending} 個抽樣 plot 待重測`);
  }

  // 條件 3：超閾值必須有處置
  if (cfg.requireResolutionForFailed && summary.failedUnresolved > 0) {
    reasons.push(`還有 ${summary.failedUnresolved} 個抽樣 plot 超閾值且無處置`);
  }

  return {
    canApprove: reasons.length === 0,
    reasons,
    summary,
  };
}

// ===== 誤差統計（給 UI 統計面板用）=====
export function computeErrorStats(plots) {
  const slopeErrs = [];
  const areaErrs = [];
  for (const p of plots) {
    const q = p.qaqc;
    if (!q || !q.inSample) continue;
    if (Number.isFinite(q.slopeError_deg)) slopeErrs.push(q.slopeError_deg);
    if (Number.isFinite(q.areaError_pct))  areaErrs.push(q.areaError_pct);
  }
  return {
    slope: descStats(slopeErrs, '°'),
    area:  descStats(areaErrs, '%'),
  };
}

function descStats(arr, unit) {
  if (arr.length === 0) return { n: 0, mean: null, max: null, std: null, unit };
  const n = arr.length;
  const sum = arr.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const max = Math.max(...arr);
  const sqDiff = arr.reduce((a, b) => a + (b - mean) ** 2, 0);
  const std = Math.sqrt(sqDiff / n);
  return { n, mean, max, std, unit };
}

// ===== 預設 qaqc map（給新建 plot；不會自動進抽樣）=====
export function defaultQaqc() {
  return {
    inSample: false,
    sampledAt: null,
    sampledBy: null,
    sampleReason: null,
    slopeVerified: null,
    dimensionsVerified: null,
    areaVerifiedHorizontal: null,
    verifiedAt: null,
    verifiedBy: null,
    slopeError_deg: null,
    areaError_pct: null,
    withinThreshold: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    resolvedBy: null,
  };
}
