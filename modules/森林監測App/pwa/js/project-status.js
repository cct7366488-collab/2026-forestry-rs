// ===== project-status.js — v2.7 階段 3：Reviewer 完成審查 =====
// 6 狀態：created → planning → active → review → verified → archived
// 觸發點：
//   methodology 第一次儲存 → created → planning
//   markQA verified                → planning → active（首筆）
//   markQA verified 後全 verified  → active → review + auto-Lock
//   markQA verified→非 verified    → review → active + auto-unlock
//   surveyor 改自己被 flag 的資料  → review → active + auto-unlock（保險）
//   reviewer 完成審查（v2.7）       → review → verified（保留 Lock，autoLockReason='reviewer-approved'）
//   admin 結案                       → verified → archived（封存按鈕，已實作於 forms.archiveProject）

import { fb, state } from './app.js';

export const STATUS = {
  CREATED:  'created',
  PLANNING: 'planning',
  ACTIVE:   'active',
  REVIEW:   'review',
  VERIFIED: 'verified',
  ARCHIVED: 'archived'
};

// 6 子集合白名單（與 firestore.rules / forms.js 一致）
const SUB_COLLECTIONS = ['trees', 'regeneration', 'understory', 'soilCons', 'wildlife', 'harvest'];

// status badge / banner 樣式（v2 統一色階：灰→藍→綠→橘→金→深灰）
export const STATUS_META = {
  created:  { label: '⚙ 設定中',  badgeCls: 'bg-stone-200 text-stone-700',     bannerCls: 'bg-stone-100 border-stone-300 text-stone-700' },
  planning: { label: '📋 規劃中',  badgeCls: 'bg-blue-100 text-blue-800',       bannerCls: 'bg-blue-50 border-blue-200 text-blue-800' },
  active:   { label: '▶ 進行中',   badgeCls: 'bg-green-100 text-green-800',     bannerCls: 'bg-green-50 border-green-200 text-green-800' },
  review:   { label: '🔍 審查中',  badgeCls: 'bg-amber-100 text-amber-800',     bannerCls: 'bg-amber-50 border-amber-300 text-amber-800' },
  verified: { label: '✅ 已查證',  badgeCls: 'bg-yellow-200 text-yellow-900',   bannerCls: 'bg-yellow-50 border-yellow-300 text-yellow-900' },
  archived: { label: '📦 已歸檔',  badgeCls: 'bg-stone-300 text-stone-700',     bannerCls: 'bg-stone-100 border-stone-300 text-stone-700' }
};

export const AUTO_LOCK_REASON_LABEL = {
  'all-verified':     '系統偵測全資料 verified，自動進入審查階段',
  'manual':           'PI 手動鎖定',
  'legacy':           'v2.2 既有手動鎖定（v2.3 升級時保留）',
  'reviewer-approved':'Reviewer 完成審查並查證全案，資料永久鎖定'
};

/** UI helper：status badge HTML（卡片右上 / banner 用） */
export function statusBadgeHTML(status, size = 'sm') {
  const meta = STATUS_META[status] || STATUS_META.active;
  const cls = size === 'lg' ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5';
  return `<span class="${meta.badgeCls} ${cls} rounded">${meta.label}</span>`;
}

/**
 * 計算專案 QA 進度（plots + 全 6 子集合）
 * 排除 qaStatus='shell' 的空殼 plot（不計入 total）
 * 回傳 { total, verified, pending, flagged, rejected }
 */
export async function computeProgress(projectId) {
  const result = { total: 0, verified: 0, pending: 0, flagged: 0, rejected: 0 };
  const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots'));
  const plots = [];
  plotsSnap.forEach(d => plots.push({ id: d.id, qaStatus: d.data().qaStatus }));

  const tally = (qa) => {
    if (qa === 'shell') return;
    result.total++;
    if (qa === 'verified') result.verified++;
    else if (qa === 'flagged') result.flagged++;
    else if (qa === 'rejected') result.rejected++;
    else result.pending++;
  };

  plots.forEach(p => tally(p.qaStatus));

  await Promise.all(plots.flatMap(p =>
    SUB_COLLECTIONS.map(async coll => {
      try {
        const s = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots', p.id, coll));
        s.forEach(d => tally(d.data().qaStatus));
      } catch {}
    })
  ));

  return result;
}

/**
 * 從現況推導應該的 status（migration / 缺欄位時用）
 * legacy locked === true 的維持 review（最保守，design choice 5c）
 */
export function inferStatus(project, progress) {
  if (project.archived === true) return STATUS.ARCHIVED;
  if (project.locked === true)   return STATUS.REVIEW;
  if (progress.total === 0) {
    return project.methodology && project.migratedV1_5 ? STATUS.PLANNING : STATUS.CREATED;
  }
  if (progress.verified === progress.total) return STATUS.REVIEW;
  if (progress.verified > 0) return STATUS.ACTIVE;
  return STATUS.PLANNING;
}

/** 寫 status + 同步 lock / 客戶端 state */
async function writeStatus(project, newStatus, opts = {}) {
  const { triggerLock = false, triggerUnlock = false, autoLockReason = null, by = state.user?.uid || 'system' } = opts;
  const projectRef = fb.doc(fb.db, 'projects', project.id);
  const updates = {
    status: newStatus,
    statusChangedAt: fb.serverTimestamp(),
    statusChangedBy: by
  };
  if (triggerLock) {
    updates.locked = true;
    updates.lockedAt = fb.serverTimestamp();
    updates.lockedBy = by;
    updates.autoLockReason = autoLockReason || 'all-verified';
  }
  if (triggerUnlock) {
    updates.locked = false;
    updates.lockedAt = null;
    updates.lockedBy = null;
    updates.autoLockReason = null;
  }
  await fb.updateDoc(projectRef, updates);
  // sync client state（serverTimestamp 還沒回，先頂著 client 時間，下次 load 會被覆蓋）
  project.status = newStatus;
  project.statusChangedAt = new Date();
  project.statusChangedBy = by;
  if (triggerLock) {
    project.locked = true; project.lockedAt = new Date(); project.lockedBy = by;
    project.autoLockReason = autoLockReason || 'all-verified';
  }
  if (triggerUnlock) {
    project.locked = false; project.lockedAt = null; project.lockedBy = null; project.autoLockReason = null;
  }
}

/**
 * markQA 後的狀態機處理
 * @param oldQa  改之前的 qaStatus（undefined 表示新增）
 * @param newQa  改之後的 qaStatus
 * @returns 'promoted-review' | 'promoted-active' | 'demoted-active' | null
 */
export async function applyStatusAfterQA(project, oldQa, newQa) {
  if (!project || project.archived) return null;
  const cur = project.status || STATUS.ACTIVE;

  // 情境 A：verified → 非 verified（PI 退回審查通過的資料）
  // 觸發 demote: review → active + unlock
  if (oldQa === 'verified' && newQa !== 'verified') {
    if (cur === STATUS.REVIEW) {
      await writeStatus(project, STATUS.ACTIVE, { triggerUnlock: true, by: 'system' });
      return 'demoted-active';
    }
    return null;
  }

  // 情境 B：標 verified — 嘗試 promote
  if (newQa === 'verified') {
    // 首筆 verified：planning/created → active
    if (cur === STATUS.PLANNING || cur === STATUS.CREATED) {
      await writeStatus(project, STATUS.ACTIVE);
    }
    // 全 verified 偵測（O(6 query)）— active 才有資格往 review 跳
    if ((project.status || STATUS.ACTIVE) === STATUS.ACTIVE) {
      const progress = await computeProgress(project.id);
      if (progress.total > 0 && progress.verified === progress.total) {
        await writeStatus(project, STATUS.REVIEW, {
          triggerLock: true,
          autoLockReason: 'all-verified',
          by: 'system'
        });
        return 'promoted-review';
      }
    }
    return 'promoted-active';
  }

  return null;
}

/** surveyor 改自己被 flag 的資料 → 若 status='review' 退回 active + unlock（保險） */
export async function applyStatusAfterSurveyorReset(project, didReset) {
  if (!didReset || !project || project.archived) return null;
  if ((project.status || STATUS.ACTIVE) !== STATUS.REVIEW) return null;
  await writeStatus(project, STATUS.ACTIVE, { triggerUnlock: true, by: 'system' });
  return 'demoted-active';
}

/** methodology 第一次儲存 → created → planning */
export async function applyStatusAfterMethodologySaved(project) {
  if (!project || project.archived) return null;
  const cur = project.status || STATUS.CREATED;
  if (cur !== STATUS.CREATED) return null;
  await writeStatus(project, STATUS.PLANNING);
  return 'promoted-planning';
}

/**
 * v2.7 階段 3：Reviewer 完成審查 → review → verified
 * 保留 Lock（autoLockReason 改 'reviewer-approved'，lockedBy 改 reviewer uid）
 * 同時寫 verifiedAt / verifiedBy 兩個獨立欄位作為查證歷史紀錄（不可被覆蓋）
 */
export async function applyStatusAfterReviewerApprove(project) {
  if (!project) throw new Error('project required');
  if (project.archived) throw new Error('已封存專案不可再審查');
  const cur = project.status || STATUS.ACTIVE;
  if (cur !== STATUS.REVIEW) throw new Error(`狀態 ${cur} 不可完成審查（需處於 review）`);
  const reviewerUid = state.user?.uid;
  if (!reviewerUid) throw new Error('未登入');

  const projectRef = fb.doc(fb.db, 'projects', project.id);
  const updates = {
    status: STATUS.VERIFIED,
    statusChangedAt: fb.serverTimestamp(),
    statusChangedBy: reviewerUid,
    // Lock 改由 reviewer 持有 + 標 reviewer-approved（區別於 system 自動鎖）
    locked: true,
    lockedAt: fb.serverTimestamp(),
    lockedBy: reviewerUid,
    autoLockReason: 'reviewer-approved',
    // 永久查證紀錄欄位（後續即使狀態再變動也保留）
    verifiedAt: fb.serverTimestamp(),
    verifiedBy: reviewerUid
  };
  await fb.updateDoc(projectRef, updates);

  // sync client state
  project.status = STATUS.VERIFIED;
  project.statusChangedAt = new Date();
  project.statusChangedBy = reviewerUid;
  project.locked = true;
  project.lockedAt = new Date();
  project.lockedBy = reviewerUid;
  project.autoLockReason = 'reviewer-approved';
  project.verifiedAt = new Date();
  project.verifiedBy = reviewerUid;

  return 'promoted-verified';
}

/** PI 手動 toggle Lock — 寫 autoLockReason='manual'，狀態不動 */
export async function applyStatusAfterManualLock(project, locking) {
  const projectRef = fb.doc(fb.db, 'projects', project.id);
  const updates = {
    locked: locking,
    lockedAt: locking ? fb.serverTimestamp() : null,
    lockedBy: locking ? state.user.uid : null,
    autoLockReason: locking ? 'manual' : null
  };
  await fb.updateDoc(projectRef, updates);
  project.locked = locking;
  project.lockedAt = locking ? new Date() : null;
  project.lockedBy = locking ? state.user.uid : null;
  project.autoLockReason = locking ? 'manual' : null;
}

/** Migration: 缺 status 欄位時依現況推導並寫回（in-app self-heal） */
export async function ensureStatusMigrated(project) {
  if (!project) return null;
  if (project.status) return null;  // 已 migrated
  const progress = await computeProgress(project.id);
  const inferred = inferStatus(project, progress);
  const projectRef = fb.doc(fb.db, 'projects', project.id);
  const updates = {
    status: inferred,
    statusChangedAt: fb.serverTimestamp(),
    statusChangedBy: 'system',
    migratedV2_3: true
  };
  // legacy locked 標 reason（design choice 5c）
  if (project.locked === true && inferred === STATUS.REVIEW && !project.autoLockReason) {
    updates.autoLockReason = 'legacy';
  }
  try {
    await fb.updateDoc(projectRef, updates);
    project.status = inferred;
    project.statusChangedBy = 'system';
    project.migratedV2_3 = true;
    if (project.locked === true && !project.autoLockReason) project.autoLockReason = 'legacy';
    return inferred;
  } catch (e) {
    console.warn('[v2.3 status migration] failed', e);
    return null;
  }
}
