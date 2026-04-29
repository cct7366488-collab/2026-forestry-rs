// ===== migration-v2715.js — 樣區幾何 schema 升級批次標記工具（admin only）=====
//
// 目的：把既有 plots 補上 v2.7.15 新增欄位（slopeDegrees / dimensionType /
// areaHorizontal_m2 / migrationPending=true），標記為「待補登」狀態。
//
// 觸發方式（v2.7.15）：admin 手動在 console 呼叫
//   const m = await import('./js/migration-v2715.js?v=28030');
//   await m.dryRun('PROJECT_ID');                    // 看影響哪些樣區
//   await m.markPending('PROJECT_ID', { execute: true });  // 真的寫入
//
// v2.7.16 UI 落地後：admin 後台會有按鈕觸發 markPending，並把列表渲染成 badge。
//
// 安全機制：
//   - dry-run 預設（不寫入）
//   - 只動 plotShape='circle'|'square' 的舊資料；rectangle 已是新 schema，跳過
//   - 寫入時用 batch（一次最多 500 doc，超過分批）

import { fb } from './app.js?v=28030';
import { MIGRATION_DEFAULTS, computeAreaHorizontal } from './plot-geometry.js?v=28030';

const { db, collection, getDocs, doc, writeBatch } = fb;

// ===== v2.8.3：square → rectangle 20×25 批次轉換 =====
//   背景：台灣永久樣區（林業及自然保育署 / 中華紙漿廠）多採 0.05 ha = 20×25 m 矩形
//        v2.5 schema 預設 'circle' 或 'square'，導致既有 plot 邊界畫成 22.36×22.36 方形
//        而立木實際是依 20×25 量測的 → 大量立木落在邊界外（紅圈描邊）
//   修復：批次轉 shape='square' AND area_m2=500 → shape='rectangle' + plotDimensions={width:20, length:25}
//
//   QAQC 整合：對已 QAQC 重測過的 plot（qaqc.verifiedAt != null）
//     - 清除 dimensionsVerified / areaVerifiedHorizontal / areaError_pct（基於舊 22.36×22.36 假設，已失效）
//     - 重置 withinThreshold = null（待重測）
//     - 清除 resolution / resolutionNote / resolvedAt / resolvedBy
//     - 保留 slopeVerified / slopeError_deg（slope 不受形狀影響）
//     - 保留 inSample / sampledAt / sampledBy / sampleReason（抽樣狀態保留）
//   tree.qaqc 不受影響（樹木 DBH/H/位置與 plot 形狀無關）

export async function dryRunSquareToRectangle(projectId) {
  if (!projectId) throw new Error('projectId 必填');
  const snap = await getDocs(collection(db, `projects/${projectId}/plots`));
  const targets = [];
  let withQaqcCount = 0;
  snap.forEach(d => {
    const p = d.data();
    if (p.shape !== 'square') return;
    if (p.qaStatus === 'shell') return;
    if (Number(p.area_m2) !== 500) return;  // 只動 0.05 ha
    const hadQaqc = !!(p.qaqc?.verifiedAt);
    if (hadQaqc) withQaqcCount++;
    targets.push({
      id: d.id,
      code: p.code,
      hadAreaQaqc: hadQaqc,
      hadResolution: !!(p.qaqc?.resolution),
    });
  });
  console.table(targets);
  console.log(`[dryRun square→rectangle] projectId=${projectId} 共 ${targets.length} 樣區可轉，其中 ${withQaqcCount} 個有既存 QAQC 重測（將被重置）。`);
  return { targets, withQaqcCount };
}

export async function convertSquareToRectangle(projectId, opts = {}) {
  const { execute = false, width = 20, length = 25 } = opts;
  if (!projectId) throw new Error('projectId 必填');
  const snap = await getDocs(collection(db, `projects/${projectId}/plots`));
  const targets = [];
  snap.forEach(d => {
    const p = d.data();
    if (p.shape !== 'square') return;
    if (p.qaStatus === 'shell') return;
    if (Number(p.area_m2) !== 500) return;
    targets.push({ id: d.id, ref: d.ref, data: p });
  });

  console.log(`[convertSquareToRectangle] 將更新 ${targets.length} 樣區為 rectangle ${width}×${length}`);
  if (!execute) {
    console.log('[convertSquareToRectangle] dry-run（execute=false）— 未寫入。要真的寫入請傳 { execute: true }。');
    return { dryRun: true, count: targets.length, targets: targets.map(t => ({ id: t.id, code: t.data.code })) };
  }

  const slopeOf = (p) => Number.isFinite(p.slopeDegrees) ? p.slopeDegrees : 0;
  const dimTypeOf = (p) => p.dimensionType || 'horizontal';
  const newArea = width * length;
  if (newArea !== 500) console.warn(`[convertSquareToRectangle] width × length = ${newArea} ≠ 500，異常`);

  // 分批 commit（Firestore batch 上限 500）
  const CHUNK = 400;
  let written = 0, qaqcReset = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const t of slice) {
      const p = t.data;
      const slope = slopeOf(p);
      const dimType = dimTypeOf(p);
      const patch = {
        shape: 'rectangle',
        plotDimensions: { width, length },
        // area_m2 不變（500），areaHorizontal_m2 重算（slope/dimensionType 沒變，理論上同值）
        areaHorizontal_m2: computeAreaHorizontal(newArea, slope, dimType),
        migrationPending: false,
        updatedAt: fb.serverTimestamp(),
      };
      // QAQC 重置（若有重測過）— 但限定為 area-related 欄位；slope 重測 + 抽樣狀態保留
      if (p.qaqc?.verifiedAt) {
        const newQaqc = { ...p.qaqc };
        newQaqc.dimensionsVerified = null;
        newQaqc.areaVerifiedHorizontal = null;
        newQaqc.areaError_pct = null;
        // withinThreshold 由 slope + area 共同決定；area 重置 → 整體重測
        newQaqc.withinThreshold = null;
        newQaqc.resolution = null;
        newQaqc.resolutionNote = null;
        newQaqc.resolvedAt = null;
        newQaqc.resolvedBy = null;
        // KEEP: inSample, sampledAt/By/Reason, slopeVerified, slopeError_deg, verifiedAt/By
        // verifiedAt 保留以記錄「曾經 verified」，但 dimensionsVerified=null 標示重測過期
        patch.qaqc = newQaqc;
        qaqcReset++;
      }
      batch.update(t.ref, patch);
    }
    await batch.commit();
    written += slice.length;
    console.log(`[convertSquareToRectangle] committed batch ${Math.floor(i / CHUNK) + 1}（累計 ${written}/${targets.length}）`);
  }
  console.log(`[convertSquareToRectangle] ✓ 完成，共 ${written} 樣區轉為 rectangle ${width}×${length}（其中 ${qaqcReset} 個 QAQC 面積重測已重置）。`);
  return { dryRun: false, count: written, qaqcResetCount: qaqcReset };
}

// ===== Dry-run：列出受影響樣區 =====
export async function dryRun(projectId) {
  if (!projectId) throw new Error('projectId 必填');
  const snap = await getDocs(collection(db, `projects/${projectId}/plots`));
  const candidates = [];
  snap.forEach(d => {
    const p = d.data();
    // 缺新欄位 → 候選
    const needs = (
      p.slopeDegrees == null ||
      p.dimensionType == null ||
      p.areaHorizontal_m2 == null
    );
    if (needs) {
      candidates.push({
        id: d.id,
        code: p.code,
        shape: p.shape,
        area_m2: p.area_m2,
        hasSlope: p.slopeDegrees != null,
        hasDimType: p.dimensionType != null,
        hasAreaH: p.areaHorizontal_m2 != null,
      });
    }
  });
  console.table(candidates);
  console.log(`[dryRun] projectId=${projectId} 共 ${candidates.length} / ${snap.size} 樣區待補登。`);
  return candidates;
}

// ===== 批次寫入：標 migrationPending=true + 補預設值 =====
export async function markPending(projectId, opts = {}) {
  const { execute = false } = opts;
  if (!projectId) throw new Error('projectId 必填');
  const snap = await getDocs(collection(db, `projects/${projectId}/plots`));
  const targets = [];
  snap.forEach(d => {
    const p = d.data();
    if (p.slopeDegrees != null && p.dimensionType != null && p.areaHorizontal_m2 != null) return;
    const patch = {};
    if (p.slopeDegrees == null)        patch.slopeDegrees = MIGRATION_DEFAULTS.slopeDegrees;
    if (p.slopeAspect === undefined)   patch.slopeAspect = MIGRATION_DEFAULTS.slopeAspect;
    if (p.slopeSource === undefined)   patch.slopeSource = MIGRATION_DEFAULTS.slopeSource;
    if (p.dimensionType == null)       patch.dimensionType = MIGRATION_DEFAULTS.dimensionType;
    if (p.areaHorizontal_m2 == null) {
      patch.areaHorizontal_m2 = computeAreaHorizontal(
        p.area_m2,
        patch.slopeDegrees ?? p.slopeDegrees,
        patch.dimensionType ?? p.dimensionType
      );
    }
    if (p.migrationPending == null)    patch.migrationPending = true;
    targets.push({ id: d.id, ref: d.ref, patch });
  });

  console.log(`[markPending] projectId=${projectId} 將更新 ${targets.length} 樣區`);
  if (!execute) {
    console.log('[markPending] dry-run（execute=false）— 未寫入。要真的寫入請傳 { execute: true }。');
    return { dryRun: true, count: targets.length, targets };
  }

  // 分批 commit（Firestore batch 上限 500）
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    slice.forEach(t => batch.update(t.ref, t.patch));
    await batch.commit();
    written += slice.length;
    console.log(`[markPending] committed batch ${Math.floor(i / CHUNK) + 1}（累計 ${written}/${targets.length}）`);
  }
  console.log(`[markPending] ✓ 完成，共寫入 ${written} 樣區。`);
  return { dryRun: false, count: written };
}
