// ===== migration-v2715.js — 樣區幾何 schema 升級批次標記工具（admin only）=====
//
// 目的：把既有 plots 補上 v2.7.15 新增欄位（slopeDegrees / dimensionType /
// areaHorizontal_m2 / migrationPending=true），標記為「待補登」狀態。
//
// 觸發方式（v2.7.15）：admin 手動在 console 呼叫
//   const m = await import('./js/migration-v2715.js?v=28020');
//   await m.dryRun('PROJECT_ID');                    // 看影響哪些樣區
//   await m.markPending('PROJECT_ID', { execute: true });  // 真的寫入
//
// v2.7.16 UI 落地後：admin 後台會有按鈕觸發 markPending，並把列表渲染成 badge。
//
// 安全機制：
//   - dry-run 預設（不寫入）
//   - 只動 plotShape='circle'|'square' 的舊資料；rectangle 已是新 schema，跳過
//   - 寫入時用 batch（一次最多 500 doc，超過分批）

import { fb } from './app.js?v=28020';
import { MIGRATION_DEFAULTS, computeAreaHorizontal } from './plot-geometry.js?v=28020';

const { db, collection, getDocs, doc, writeBatch } = fb;

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
