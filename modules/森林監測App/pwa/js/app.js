// ===== app.js — v1.5 主程式：5 角色 + Lock + QA + memberUids =====

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject, listAll
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

import { firebaseConfig } from "../firebase-config.js?v=27150";
import * as forms from "./forms.js?v=27150";
import * as analytics from "./analytics.js?v=27150";
import * as importWizard from "./import-wizard.js?v=27150";
import { renderTreeDistribution } from "./distribution.js?v=27150";   // v2.6.2：立木分布散布圖
import { renderSpeciesDict, disposeSpeciesDict } from "./species-admin.js?v=27150";   // v2.7.10：admin 樹種字典管理
import { calcTreeMetrics as calcTreeMetricsImpl, speciesParamsLabel as speciesParamsLabelImpl } from "./species-equations.js?v=27150";
// v2.3：階段 2 — 狀態機 + 自動偵測送審；v2.7：階段 3 — Reviewer 完成審查
import { STATUS, STATUS_META, AUTO_LOCK_REASON_LABEL, statusBadgeHTML, ensureStatusMigrated, applyStatusAfterManualLock, applyStatusAfterReviewerApprove, applyStatusRevertVerified, computeProgress } from "./project-status.js?v=27150";

// ===== Firebase init =====
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);
const storage = getStorage(app);

proj4.defs("EPSG:3826", "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs");

// ===== 全域狀態 =====
export const state = {
  user: null,
  userDoc: null,
  project: null,
  plot: null,
  unsubscribers: []
};

// ===== 角色判斷 =====
export function isSystemAdmin() {
  return state.userDoc?.systemRole === 'admin' || state.userDoc?.globalRole === 'admin';
}
export function projectRole() {
  if (!state.project) return null;
  return state.project.members?.[state.user.uid] || null;
}
export function isPi() { return projectRole() === 'pi'; }
// v1.7.0：dataManager 角色移除（auto migration 在 renderProjectHome 中執行）
// 保留 isDataManager() 為相容 stub，永遠回傳 false（避免 import 端誤用）
export function isDataManager() { return false; }
export function isSurveyor() { return projectRole() === 'surveyor'; }
export function isReviewer() { return projectRole() === 'reviewer'; }
// v1.7.1.3：system admin 不管專案角色是什麼，都享 PI 權限（god view）
export function canQA() { return isPi() || isSystemAdmin(); }
export function canCollect() { return isPi() || isSurveyor() || isSystemAdmin(); }
export function isLocked() { return state.project?.locked === true; }

// 預設方法學（v1.5 新專案/無 methodology 的舊專案 fallback）
// v2.0：擴展 understory（地被植物）/ soilCons（水土保持）兩模組可開關
// v2.7.15：新增 dimensionType（沿坡距 / 水平投影），plotShape 擴充 'rectangle'（plot 層支援，methodology 仍可指定預設）
export const DEFAULT_METHODOLOGY = {
  targetPlotCount: 50,
  plotShape: 'circle',                           // v2.7.15：'circle' | 'square' | 'rectangle'
  plotAreaOptions: [400, 500, 1000],
  // v2.7.15：dimensionType 決定 plot.area_m2 / plotDimensions 的單位語意
  //   'slope_distance'：野外實採（皮尺沿坡）→ 寫入時自動算 areaHorizontal_m2
  //   'horizontal'：已是水平投影（DEM 推導 / 補登時換算過）→ 不再修正
  //   舊資料無此欄位 → normalizePlotOnRead 預設 'horizontal'（最保守，避免錯誤套 cos）
  dimensionType: 'slope_distance',
  // v2.5：plotOriginType 決定立木 X/Y 座標如何解釋
  //   'center'：plot.GPS = 樣區中心點，皮尺距中心 4 象限（X/Y 可正可負）— 林保署永久樣區常用
  //   'corner'：plot.GPS = 樣區左下角，皮尺從左下往右北（X/Y 恆為正）
  plotOriginType: 'center',
  required: { photos: false, branchHeight: false, pestSymptoms: false },
  modules: {
    plot: true, tree: true, regeneration: true,
    understory: false,    // v2.0：地被植物 5 點樣方法
    soilCons: false,      // v2.0：水土保持 5 點觀測（取代舊 soil 命名）
    wildlife: false,      // v2.1：野生動物（4 種方法）
    harvest: false,       // v2.2：經濟收穫（土肉桂為首；通用化名稱）
    disturbance: false    // 預留
  },
  // v2.0：各模組獨立必填規則
  understoryConfig: {
    quadratSize: '1x1',           // '1x1' | '2x2' | '5x5'
    quadratCodes: ['N', 'E', 'S', 'W', 'C'],
    requirePhotos: true            // 樣方俯拍照片強制
  },
  soilConsConfig: {
    stationCodes: ['N', 'E', 'S', 'W', 'C'],
    requirePhotos: true,            // 定點照片強制（比對基礎）
    eventTypes: ['routine', 'post-typhoon', 'post-rain', 'post-construction']
  },
  // v2.1：野生動物模組
  wildlifeConfig: {
    methods: ['direct', 'sign', 'cam', 'audio'],   // 啟用的方法
    requirePhotos: false,                           // 預設不強制（音訊調查通常無照片）
    blurSensitive: true                             // 匯出時對保育類 I 級加 ⚠ 標記（未來可實作 blur）
  },
  // v2.2：經濟收穫模組（通用化命名 — 未來可支援愛玉/咖啡等）
  harvestConfig: {
    species: ['土肉桂'],                            // 白名單：可採收樹種（PI 設定）
    requirePhotos: true,                            // 採前/採後/產品照片必填
    moistureDefault: 0.5                            // 預設含水率（用於從鮮重估乾重）
  },
  description: ''
};

// ===== 工具 =====
export const fb = {
  app, db, auth, storage,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint, collectionGroup,
  storageRef, uploadBytes, getDownloadURL, deleteObject, listAll
};

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

export function wgs84ToTwd97(lng, lat) {
  const [x, y] = proj4("EPSG:4326", "EPSG:3826", [lng, lat]);
  return { x: Math.round(x), y: Math.round(y) };
}
export function twd97ToWgs84(x, y) {
  const [lng, lat] = proj4("EPSG:3826", "EPSG:4326", [x, y]);
  return { lng, lat };
}

// v1.6.21：樹種別計算移到 species-equations.js（移植自 carbon-volume-calculator skill）
// 以下被淘汰的 SPECIES_PARAMS 與 calcTreeMetrics（v1.6.20 我自編、結構錯誤）已被新版取代
// 重新 export 以維持外部 API 介面（forms.js 仍 import）
export const calcTreeMetrics = calcTreeMetricsImpl;
export const speciesParamsLabel = speciesParamsLabelImpl;

// （v1.6.20 自編的形數法 SPECIES_PARAMS 與 calcTreeMetrics 已刪除，全部移到 species-equations.js）

// QA badge HTML
export function qaBadge(status) {
  const labels = { pending: '待審核', verified: '已通過', flagged: '⚠ 待修正', rejected: '✕ 已駁回' };
  const cls = `qa-badge qa-${status || 'pending'}`;
  return `<span class="${cls}">${labels[status] || labels.pending}</span>`;
}

// 匿名化 createdBy（reviewer 視角用）
const _anonMap = new Map();
let _anonCounter = 0;
export function anonName(uid) {
  if (!uid) return '—';
  if (!_anonMap.has(uid)) {
    _anonMap.set(uid, `調查員${String.fromCharCode(65 + (_anonCounter++ % 26))}`);
  }
  return _anonMap.get(uid);
}

// v1.5.2 Bug #5：uid → displayName 快取（給 Lock by / createdBy 等顯示用）
const _userLabelCache = new Map();
export async function prefetchUserLabels(uids) {
  const todo = [...new Set(uids)].filter(u => u && !_userLabelCache.has(u));
  if (!todo.length) return;
  await Promise.all(todo.map(async (uid) => {
    try {
      const us = await getDoc(doc(db, 'users', uid));
      if (us.exists()) {
        const d = us.data();
        _userLabelCache.set(uid, d.displayName || d.email || uid.slice(0, 8));
      } else {
        _userLabelCache.set(uid, uid.slice(0, 8));
      }
    } catch {
      _userLabelCache.set(uid, uid.slice(0, 8));
    }
  }));
}
export function userLabel(uid, fallback = '?') {
  if (!uid) return fallback;
  if (uid === state.user?.uid) return '我';
  return _userLabelCache.get(uid) || uid.slice(0, 8);
}

// v2.3：狀態列 banner（取代原本只顯示 lock 的 banner，加 status 顏色 + 原因）
function renderStatusBanner() {
  const banner = $('#lock-banner');
  if (!banner) return;
  const p = state.project;
  if (!p) return;
  const status = p.status || STATUS.ACTIVE;
  const meta = STATUS_META[status] || STATUS_META.active;
  const isLockedNow = p.locked === true;
  const reason = p.autoLockReason;
  const reasonText = AUTO_LOCK_REASON_LABEL[reason] || '';

  // 不顯示 banner 的狀況：未鎖定 且 active/planning/created（讓主畫面乾淨）
  if (!isLockedNow && (status === STATUS.ACTIVE || status === STATUS.PLANNING || status === STATUS.CREATED)) {
    banner.classList.add('hidden');
    renderReviewerApprovalCard();  // v2.7：reviewer 卡也跟著隱藏（demote 後同步）
    return;
  }
  banner.classList.remove('hidden');
  banner.className = `${meta.bannerCls} border text-sm px-3 py-2 rounded mb-3`;

  const parts = [`<div class="flex items-center gap-2 flex-wrap"><b>${meta.label}</b>`];
  if (isLockedNow) parts.push(`<span class="text-xs px-2 py-0.5 bg-stone-700 text-white rounded">🔒 已鎖定</span>`);
  parts.push(`</div>`);

  if (isLockedNow && reasonText) {
    const at = p.lockedAt ? fmtDate(p.lockedAt) : '';
    const by = p.lockedBy ? userLabel(p.lockedBy, '系統') : '系統';
    parts.push(`<div class="text-xs mt-1 opacity-80">${reasonText}${at ? ` · ${at}` : ''}${by && by !== '系統' && reason !== 'all-verified' ? ` · 由 ${by}` : ''}</div>`);
  }
  if (status === STATUS.VERIFIED) {
    // v2.7：reviewer-approved 的細節已由上方 reasonText 顯示（含 by + 日期）
    // 這裡補一條提示：資料永久查證，不可再 markQA
    parts.push(`<div class="text-xs mt-1 opacity-80">✅ 全案已查證 — 資料永久鎖定，無法再 markQA。如需修正請洽 admin 退回。</div>`);
  }
  if (status === STATUS.ARCHIVED) {
    parts.push(`<div class="text-xs mt-1 opacity-80">本專案已歸檔（資料保留唯讀）</div>`);
  }
  banner.innerHTML = parts.join('');

  // v2.7：reviewer 完成審查卡（同樣是 plots tab 共用區，跟 lock-banner 一起隨 status 切換）
  renderReviewerApprovalCard();
}

// v2.7.9：admin god view 後門按鈕工廠 — verified 狀態下退回 review / active
function makeRevertBtn(targetStatus, label, hint) {
  const cls = targetStatus === STATUS.REVIEW
    ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
    : 'bg-stone-100 hover:bg-stone-200 text-stone-800 border-stone-300';
  const b = el('button', {
    class: `flex-1 border ${cls} px-3 py-1.5 rounded text-xs font-medium`,
    title: hint,
  }, label);
  b.onclick = async () => {
    const targetLabel = targetStatus === STATUS.REVIEW ? '審查中（review）' : '作業中（active）';
    const lockNote = targetStatus === STATUS.REVIEW
      ? '\n• 保留 Lock（reviewer 可繼續審查）'
      : '\n• 自動 Unlock（PI 可重新編輯）';
    if (!confirm(`admin 後門：退回為「${targetLabel}」？\n\n• 清除 verifiedAt / verifiedBy 完成紀錄${lockNote}\n• 此操作會記錄在 statusChangedAt / statusChangedBy\n\n確定退回？`)) return;
    try {
      b.disabled = true;
      b.textContent = '⏳ 處理中…';
      await applyStatusRevertVerified(state.project, targetStatus);
      toast(`已退回為${targetLabel}`, 4000);
      renderStatusBanner();
      renderReviewerApprovalCard();
    } catch (e) {
      toast('退回失敗：' + e.message);
      b.disabled = false;
      b.textContent = label;
    }
  };
  return b;
}

// v2.7：Reviewer 完成審查卡 — reviewer/admin 角色 + status=review/verified 才顯示
function renderReviewerApprovalCard() {
  const card = $('#reviewer-approval-card');
  const btn = $('#btn-reviewer-approve');
  const statusEl = $('#reviewer-approval-status');
  if (!card || !btn || !statusEl) return;
  const p = state.project;
  if (!p) { card.classList.add('hidden'); return; }
  const cur = p.status || STATUS.ACTIVE;
  const canApprove = (isReviewer() || isSystemAdmin());

  if (!canApprove) { card.classList.add('hidden'); return; }

  if (cur === STATUS.VERIFIED) {
    card.classList.remove('hidden');
    btn.classList.add('hidden');
    const by = userLabel(p.verifiedBy || p.lockedBy, '系統');
    const at = p.verifiedAt ? fmtDate(p.verifiedAt) : (p.lockedAt ? fmtDate(p.lockedAt) : '—');
    statusEl.innerHTML = `<div class="text-green-700 font-medium">✅ 全案已查證</div>
      <div class="text-xs text-stone-600 mt-1">由 ${by} 於 ${at} 完成審查</div>`;
    // v2.7.9：admin god view 後門 — 退回 review / active（reviewer 不顯示）
    if (isSystemAdmin()) {
      const revertRow = el('div', { class: 'flex gap-2 mt-2 pt-2 border-t border-stone-200' },
        el('span', { class: 'text-xs text-stone-500 self-center' }, '⚙️ admin：'),
        makeRevertBtn(STATUS.REVIEW,  '↩️ 退回為審查中', '保留 Lock — reviewer 可繼續審查'),
        makeRevertBtn(STATUS.ACTIVE,  '↩️ 退回為作業中', '自動 Unlock — PI 可重新編輯')
      );
      statusEl.appendChild(revertRow);
    }
    return;
  }
  if (cur === STATUS.REVIEW) {
    card.classList.remove('hidden');
    btn.classList.remove('hidden');
    statusEl.innerHTML = `<div class="text-amber-700">🔍 全資料 verified，等待 reviewer 完成審查</div>
      <div class="text-xs text-stone-500 mt-1">完成後資料永久查證、不可再 markQA。如需退回，請對任一筆 markQA flag/reject。</div>`;
    btn.disabled = false;
    btn.textContent = '✅ 完成審查並查證全案';
    btn.onclick = async () => {
      if (!confirm('完成審查後：\n• 專案狀態 → ✅ 已查證\n• 全部資料永久鎖定，不可再修改或 markQA\n• 無法再退回 review（除非 admin 介入）\n\n確定通過全案？')) return;
      try {
        btn.disabled = true;
        btn.textContent = '⏳ 處理中…';
        await applyStatusAfterReviewerApprove(state.project);
        toast('✅ 已完成審查，全案查證', 4000);
        renderStatusBanner();
      } catch (e) {
        toast('完成審查失敗：' + e.message);
        btn.disabled = false;
        btn.textContent = '✅ 完成審查並查證全案';
      }
    };
    return;
  }
  card.classList.add('hidden');
}

// 套用 data-role-show 屬性，僅顯示符合當前角色的元素
export function applyRoleVisibility(root = document) {
  const r = projectRole();
  const rPiEdit = r === 'pi' ? 'pi-edit' : null;  // 區分 pi 編輯權
  $$('[data-role-show]', root).forEach(node => {
    const allowed = node.dataset.roleShow.split(',').map(s => s.trim());
    let show = false;
    if (allowed.includes(r)) show = true;
    if (allowed.includes('admin') && isSystemAdmin()) show = true;
    if (allowed.includes(rPiEdit)) show = true;
    if (show) node.classList.remove('hidden');
    else node.classList.add('hidden');
  });
}

// ===== Modal =====
export function openModal(title, bodyEl) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  $('#modal').classList.remove('hidden');
  $('#modal-backdrop').classList.remove('hidden');
  modalDrag?.reset();  // v1.6.15：每次開 modal 重置拖移位置
}
export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-backdrop').classList.add('hidden');
}
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', closeModal);

// v1.6.15：modal 標題列拖移（支援滑鼠與觸控；用 Pointer Events 統一 API）
const modalDrag = (() => {
  const modal = $('#modal');
  if (!modal) return null;
  const card = modal.querySelector('.bg-white');
  const header = card?.querySelector(':scope > .flex');  // 標題列（第一個 flex 容器）
  if (!card || !header) return null;

  let tx = 0, ty = 0, dragging = false, startX = 0, startY = 0;
  header.style.cursor = 'move';
  header.style.userSelect = 'none';
  header.style.touchAction = 'none';

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;  // 點關閉鈕時不啟動拖移
    dragging = true;
    try { header.setPointerCapture(e.pointerId); } catch {}
    startX = e.clientX - tx;
    startY = e.clientY - ty;
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx = e.clientX - startX;
    ty = e.clientY - startY;
    card.style.transform = `translate(${tx}px, ${ty}px)`;
  });
  const stop = () => { dragging = false; };
  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);

  return {
    reset() {
      tx = 0; ty = 0;
      card.style.transform = '';
    }
  };
})();

// ===== 離線偵測 =====
function updateOnlineStatus() {
  const banner = $('#offline-banner');
  if (navigator.onLine) banner.classList.add('hidden');
  else banner.classList.remove('hidden');
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ===== Service Worker =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(err => console.warn('SW reg failed', err));
}

// ===== Auth =====
function renderTopnav() {
  const nav = $('#topnav');
  nav.innerHTML = '';
  if (state.user) {
    const roleLabel = isSystemAdmin() ? ' [admin]' : '';
    nav.appendChild(el('span', { class: 'text-stone-200 text-xs hidden sm:inline' },
      (state.userDoc?.displayName || state.user.email) + roleLabel));
    nav.appendChild(el('button', {
      class: 'border border-white/30 px-2 py-1 rounded text-xs',
      onclick: async () => { await signOut(auth); location.hash = ''; }
    }, '登出'));
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (user) {
    const uref = doc(db, 'users', user.uid);
    const usnap = await getDoc(uref);
    if (!usnap.exists()) {
      await setDoc(uref, {
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        systemRole: 'member',
        createdAt: serverTimestamp()
      });
      state.userDoc = (await getDoc(uref)).data();
    } else {
      state.userDoc = usnap.data();
    }
  } else {
    state.userDoc = null;
  }
  renderTopnav();
  route();
});

// v1.5.5：popup 被 COOP / popup-blocker 擋時 fallback 到 redirect
// （signInWithPopup 在某些瀏覽器設定下會被 Cross-Origin-Opener-Policy 擋 window.close 回拋）
const POPUP_FAIL_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/web-storage-unsupported',
  'auth/operation-not-supported-in-this-environment'
]);
async function googleLogin() {
  const provider = new GoogleAuthProvider();
  // v1.6.1：每次都顯示帳號選擇器，避免一鍵登入到上次用過的帳號
  // （單人多帳號時：PI cct7366488@gmail.com / surveyor chenchaurtzuhn7@gmail.com）
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (POPUP_FAIL_CODES.has(e.code) || /Cross-Origin-Opener-Policy/i.test(e.message || '')) {
      toast('改用全頁跳轉登入...');
      try { await signInWithRedirect(auth, provider); }
      catch (e2) { toast('Google 登入失敗：' + e2.message); }
    } else {
      toast('Google 登入失敗：' + e.message);
    }
  }
}
// 註：redirect 完成後的 user，Firebase SDK 會自動透過 onAuthStateChanged listener 派送，
// 不需要手動呼叫 getRedirectResult（除非要取 OAuth credential / access token）
async function emailLogin(email, password) {
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (e) { toast('登入失敗：' + e.message); }
}
async function emailSignup(email, password) {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    toast('註冊成功，已自動登入');
  } catch (e) { toast('註冊失敗：' + e.message); }
}

// ===== Router =====
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const m1 = h.match(/^\/p\/([^\/]+)\/plot\/([^\/]+)$/);
  if (m1) return { route: 'plot', projectId: m1[1], plotId: m1[2] };
  const m2 = h.match(/^\/p\/([^\/]+)$/);
  if (m2) return { route: 'project', projectId: m2[1] };
  if (h === '/species') return { route: 'species' };  // v2.7.10：admin 樹種字典管理
  return { route: 'projects' };
}

let _initialNav = true;
// v1.6.10：route token 防止 onAuthStateChanged 雙觸發或 hashchange 競態導致兩份畫面疊加
let _routeId = 0;

// v2.3.1：export 給 forms.js 在 markQA / submit 後觸發重繪
// 用法：state.project = null; state.plot = null; await rerouteCurrentView();
export async function rerouteCurrentView() { return route(); }

// v2.3.4：reroute 前記住 plot detail 當前 sub-tab，重繪後恢復（避免每次 markQA 都跳回立木調查）
let _pendingSubtab = null;
export function captureCurrentSubtab() {
  const active = document.querySelector('.subtab-link.font-medium');
  if (active?.dataset.subtab) _pendingSubtab = active.dataset.subtab;
}
export function consumePendingSubtab() {
  const t = _pendingSubtab;
  _pendingSubtab = null;
  return t;
}

async function route() {
  const myId = ++_routeId;
  state.unsubscribers.forEach(u => u());
  state.unsubscribers = [];

  const main = $('#app');
  main.innerHTML = '';

  if (!state.user) { _initialNav = true; return renderLogin(main); }

  const r = parseHash();

  // v1.7.1.4：移除登入後自動跳轉到 lastProjectId 邏輯
  // 統一所有角色（admin / pi / surveyor / reviewer）落在「我的專案」清單，方便切專案
  // localStorage 'lastProjectId' 仍會被寫入（renderProjectHome / renderPlotDetail），但不再被讀取做 auto-redirect
  _initialNav = false;

  if (myId !== _routeId) return;
  // v2.7.10：route 切換時先清掉 species-admin 的 onSnapshot listener（避免離開頁面後仍持續監聽）
  if (r.route !== 'species') disposeSpeciesDict();
  if (r.route === 'projects') {
    await renderProjects(main);
  } else if (r.route === 'project') {
    localStorage.setItem('lastProjectId', r.projectId);
    await renderProjectHome(main, r.projectId);
  } else if (r.route === 'plot') {
    localStorage.setItem('lastProjectId', r.projectId);
    await renderPlotDetail(main, r.projectId, r.plotId);
  } else if (r.route === 'species') {
    // v2.7.10：admin 樹種字典管理（非 admin 進來只看到空白 — 較簡單，rules 也會擋寫入）
    if (!isSystemAdmin()) {
      main.innerHTML = '<div class="bg-amber-50 border border-amber-300 rounded p-4 text-amber-900 text-sm">此頁面僅限 system admin 使用。<a href="#/" class="underline">返回專案列表</a></div>';
      return;
    }
    await renderSpeciesDict(main);
  }
}
window.addEventListener('hashchange', route);

// ===== Views =====
function renderLogin(root) {
  const tpl = $('#view-login').content.cloneNode(true);
  root.appendChild(tpl);
  $('#btn-google').addEventListener('click', googleLogin);
  $('#form-email-login').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    emailLogin(fd.get('email'), fd.get('password'));
  });
  $('#btn-signup').addEventListener('click', () => {
    const fd = new FormData($('#form-email-login'));
    emailSignup(fd.get('email'), fd.get('password'));
  });
}

async function renderProjects(root) {
  // v1.6.12：DOM 寫入前再清 root，防 race append 兩份模板
  root.innerHTML = '';
  const tpl = $('#view-projects').content.cloneNode(true);
  root.appendChild(tpl);

  const newBtn = $('#btn-new-project');
  const dictBtn = $('#btn-species-dict');
  if (!isSystemAdmin()) {
    newBtn.classList.add('hidden');
    if (dictBtn) dictBtn.classList.add('hidden');
  } else {
    newBtn.addEventListener('click', () => forms.openProjectForm());
    if (dictBtn) dictBtn.classList.remove('hidden');  // v2.7.10：admin 才顯示樹種字典管理入口
  }

  const list = $('#project-list');

  // admin: 看全部；非 admin: where('memberUids', 'array-contains', uid)
  console.log('[projects query]', { uid: state.user.uid, email: state.user.email, isSystemAdmin: isSystemAdmin() });
  const q = isSystemAdmin()
    ? query(collection(db, 'projects'))
    : query(collection(db, 'projects'), where('memberUids', 'array-contains', state.user.uid));

  const unsub = onSnapshot(q, snap => {
    console.log('[projects snapshot]', { size: snap.size, ids: snap.docs.map(d => d.id) });
    list.innerHTML = '';
    if (snap.empty) {
      const msg = isSystemAdmin()
        ? '還沒有專案。點右上「＋ 新專案」建立第一個。'
        : `你還沒被邀請加入任何專案。請聯絡計畫主持人，提供你的登入 email：${state.user.email}（uid: ${state.user.uid.slice(0, 8)}）`;
      list.appendChild(el('div', {
        class: 'col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-4 text-stone-700 text-sm'
      }, msg));
      return;
    }
    // v1.6.19：分作用中與已封存兩組
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const active = all.filter(p => !p.archived);
    const archived = all.filter(p => p.archived);

    const renderCard = (data, isArchived) => {
      const role = data.members?.[state.user.uid] || (isSystemAdmin() ? 'admin' : '?');
      const roleLabel = { pi: '主持人', surveyor: '調查員', reviewer: '審查委員', admin: '系統管理者' }[role] || role;
      // v2.3：status badge（archived 用 archivedBadge 表示，其他狀態都顯示）
      const statusVal = isArchived ? STATUS.ARCHIVED : (data.status || STATUS.ACTIVE);
      const statusBadge = el('span', { html: statusBadgeHTML(statusVal) });
      const lockBadge = (data.locked && !isArchived && data.status !== STATUS.REVIEW && data.status !== STATUS.VERIFIED)
        ? el('span', { class: 'text-xs bg-stone-200 text-stone-700 px-2 py-0.5 rounded ml-1', title: AUTO_LOCK_REASON_LABEL[data.autoLockReason] || '已鎖定' }, '🔒 已 Lock')
        : null;
      const archivedBadge = null;  // v2.3：合併到 statusBadge
      // admin only：依封存狀態顯示不同按鈕組
      const adminActions = isSystemAdmin() ? el('div', { class: 'flex gap-1 ml-1' },
        ...(isArchived ? [
          el('button', {
            class: 'text-xs bg-blue-600 text-white px-2 py-0.5 rounded',
            title: '還原為作用中專案',
            onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); forms.unarchiveProject(data); }
          }, '↺ 解封存'),
          el('button', {
            class: 'text-xs bg-red-600 text-white px-2 py-0.5 rounded',
            title: '永久刪除（無法救回）',
            onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); forms.deleteProjectCascade(data); }
          }, '🗑 永久刪除')
        ] : [
          el('button', {
            class: 'text-xs bg-amber-600 text-white px-2 py-0.5 rounded',
            title: '案件結束時封存（資料保留）',
            onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); forms.archiveProject(data); }
          }, '📦 封存')
        ])
      ) : null;
      return el('a', {
        href: `#/p/${data.id}`,
        class: `block bg-white rounded-xl shadow p-4 transition ${isArchived ? 'opacity-60 hover:opacity-100' : 'hover:shadow-md'}`
      },
        el('div', { class: 'flex justify-between items-start gap-2 flex-wrap' },
          el('h3', { class: 'font-semibold' }, data.name),
          el('div', { class: 'flex items-center flex-wrap gap-1' },
            statusBadge,
            el('span', { class: 'text-xs bg-stone-100 px-2 py-0.5 rounded' }, roleLabel),
            lockBadge,
            archivedBadge,
            adminActions
          )
        ),
        el('p', { class: 'text-sm text-stone-500 mt-1' }, data.code),
        data.description ? el('p', { class: 'text-sm text-stone-600 mt-2' }, data.description) : null
      );
    };

    active.forEach(p => list.appendChild(renderCard(p, false)));

    if (archived.length > 0) {
      const archivedSection = el('div', { class: 'col-span-2 mt-4' },
        el('div', { class: 'flex items-center gap-2 mb-2' },
          el('h2', { class: 'text-sm font-semibold text-stone-600' }, `📦 已封存（${archived.length}）`),
          el('button', {
            id: 'btn-toggle-archived',
            class: 'text-xs text-blue-600 hover:underline',
            onclick: (ev) => {
              ev.preventDefault();
              const wrap = $('#archived-list');
              wrap.classList.toggle('hidden');
              ev.target.textContent = wrap.classList.contains('hidden') ? '顯示' : '隱藏';
            }
          }, '顯示')
        ),
        el('div', { id: 'archived-list', class: 'hidden grid sm:grid-cols-2 gap-4' },
          ...archived.map(p => renderCard(p, true))
        )
      );
      list.appendChild(archivedSection);
    }
  }, err => {
    list.innerHTML = `<div class="col-span-2 bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm">載入失敗：${err.message}</div>`;
  });
  state.unsubscribers.push(unsub);
}

async function renderProjectHome(root, projectId) {
  const myId = _routeId;  // v1.6.12：搶 token 防 race
  const pref = doc(db, 'projects', projectId);
  const psnap = await getDoc(pref);
  if (myId !== _routeId) return;
  if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
  state.project = { id: projectId, ...psnap.data() };
  // v1.5.2 Bug #5：預取所有成員 + lockedBy 的 displayName，避免 UI 顯示 uid 片段
  // v2.7：補 verifiedBy（reviewer-approved 後 verified banner 要顯示 reviewer 名）
  prefetchUserLabels([
    ...Object.keys(state.project.members || {}),
    state.project.lockedBy,
    state.project.verifiedBy
  ].filter(Boolean));

  // 🩹 v1.7.0：dataManager 角色自動 migration → pi（靜默，PI 開啟時觸發）
  if (state.project.members?.[state.user.uid] === 'pi') {
    const m = { ...state.project.members };
    let dmFound = false;
    for (const [uid, role] of Object.entries(m)) {
      if (role === 'dataManager') { m[uid] = 'pi'; dmFound = true; }
    }
    if (dmFound) {
      try {
        await updateDoc(doc(db, 'projects', projectId), { members: m });
        state.project.members = m;
        console.log('[v1.7.0 migration] dataManager → pi 完成');
      } catch (e) { console.warn('dataManager migration 失敗', e); }
    }
  }

  // 🩹 v1.5.2：PI 每次開啟都檢查 memberUids ↔ members 同步（自癒，不靠 migratedV1_5）
  if (state.project.members?.[state.user.uid] === 'pi') {
    const expectUids = Object.keys(state.project.members || {}).sort();
    const actualUids = [...(state.project.memberUids || [])].sort();
    if (expectUids.join(',') !== actualUids.join(',')) {
      console.warn('[memberUids 不同步，自動修正]', { expected: expectUids, actual: actualUids });
      try {
        await updateDoc(doc(db, 'projects', projectId), { memberUids: expectUids });
        state.project.memberUids = expectUids;
        toast('已同步成員清單');
      } catch (e) { console.error('memberUids 同步失敗', e); }
    }
  }

  // 🩹 v1.0 → v1.5 自動 migration：若當前用戶是 pi 且專案未 migration → 自動補
  if (state.project.members?.[state.user.uid] === 'pi' && !state.project.migratedV1_5) {
    try {
      // (a) 補專案層欄位
      const projUpdates = {};
      if (!state.project.memberUids) projUpdates.memberUids = Object.keys(state.project.members || {});
      if (!state.project.pi) projUpdates.pi = state.user.uid;
      if (!state.project.methodology) projUpdates.methodology = { ...DEFAULT_METHODOLOGY };
      if (state.project.locked === undefined) projUpdates.locked = false;

      // (b) 補 plots/trees/regeneration 的 qaStatus
      const plotsSnap = await getDocs(collection(db, 'projects', projectId, 'plots'));
      const writeOps = [];
      for (const plotDoc of plotsSnap.docs) {
        if (!plotDoc.data().qaStatus) {
          writeOps.push(updateDoc(plotDoc.ref, { qaStatus: 'pending' }));
        }
        const treesSnap = await getDocs(collection(db, 'projects', projectId, 'plots', plotDoc.id, 'trees'));
        treesSnap.forEach(td => {
          if (!td.data().qaStatus) writeOps.push(updateDoc(td.ref, { qaStatus: 'pending' }));
        });
        const regenSnap = await getDocs(collection(db, 'projects', projectId, 'plots', plotDoc.id, 'regeneration'));
        regenSnap.forEach(rd => {
          if (!rd.data().qaStatus) writeOps.push(updateDoc(rd.ref, { qaStatus: 'pending' }));
        });
      }
      await Promise.all(writeOps);

      // (c) 標記已 migration（避免每次開都跑）
      projUpdates.migratedV1_5 = true;
      await updateDoc(pref, projUpdates);
      Object.assign(state.project, projUpdates);

      const totalMigrated = Object.keys(projUpdates).length - 1 + writeOps.length;
      if (totalMigrated > 0) {
        toast(`已升級到 v1.5（補了 ${writeOps.length} 筆子資料 qaStatus）`, 4000);
      }
    } catch (e) { console.warn('Auto-migration failed:', e); }
  }

  // 補預設 methodology（舊專案 fallback，給非 pi 看時用）
  if (!state.project.methodology) state.project.methodology = { ...DEFAULT_METHODOLOGY };

  // 🩹 v2.3 階段 2：缺 status 自動推導（含 legacy locked → review）
  // 所有角色都可觸發（rules 對 status / autoLockReason / migratedV2_3 寫入限 PI/admin，其他角色 silent fail）
  if (!state.project.status && (state.project.members?.[state.user.uid] === 'pi' || isSystemAdmin())) {
    try {
      const inferred = await ensureStatusMigrated(state.project);
      if (inferred) {
        console.log('[v2.3 status migration]', inferred);
        if (inferred === 'review' && state.project.autoLockReason === 'legacy') {
          toast(`已升級到 v2.3：保留既有 Lock 為審查中狀態`, 4000);
        }
      }
    } catch (e) { console.warn('Status migration failed:', e); }
  }
  // 非 PI/admin 看到舊專案：先在 client state 補 status 避免 UI undefined
  if (!state.project.status) state.project.status = STATUS.ACTIVE;

  if (myId !== _routeId) return;
  // v1.6.12：DOM 寫入前再清 root，雙重保險（onAuthStateChanged 雙觸發 race）
  root.innerHTML = '';
  const tpl = $('#view-project-home').content.cloneNode(true);
  root.appendChild(tpl);
  bindData(root, 'project', state.project);

  // 套用角色顯示矩陣
  applyRoleVisibility();

  // v2.3：lock-banner 升級為狀態列（同時顯示 status 與 lock 原因）
  renderStatusBanner();

  // tab 切換
  $$('.tab-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const tab = a.dataset.tab;
    $$('.tab-link').forEach(x => { x.classList.remove('border-forest-700', 'font-medium'); x.classList.add('border-transparent', 'text-stone-600'); });
    a.classList.add('border-forest-700', 'font-medium');
    a.classList.remove('border-transparent', 'text-stone-600');
    $$('[data-tab-content]').forEach(s => s.classList.add('hidden'));
    $(`[data-tab-content="${tab}"]`).classList.remove('hidden');
    if (tab === 'dashboard') analytics.renderDashboard(state.project);
    if (tab === 'map') analytics.renderMap(state.project);
    if (tab === 'design') renderDesign();
    if (tab === 'pending') renderPending();
    if (tab === 'myflagged') renderMyFlagged();
    if (tab === 'settings') renderSettings();
  }));

  // 樣區清單（即時）
  $('#btn-new-plot').addEventListener('click', () => {
    if (isLocked()) return toast('資料已 Lock，無法新增');
    forms.openPlotForm(state.project);
  });

  const plotsRef = collection(db, 'projects', projectId, 'plots');
  const qPlots = query(plotsRef, orderBy('createdAt', 'desc'));
  // v1.7.0：取得專案 surveyor 清單（給 PI 指派用）
  const surveyors = Object.entries(state.project.members || {})
    .filter(([uid, role]) => role === 'surveyor')
    .map(([uid]) => ({ uid, label: userLabel(uid, uid.slice(0, 6)) }));

  const unsub = onSnapshot(qPlots, async snap => {
    const list = $('#plot-list');
    list.innerHTML = '';
    const allDocs = snap.docs;
    // v2.6.1（修）：對每個 plot 各 query subcollection 統計 verified ratio
    //   原本用 collectionGroup 抓全部，但 Firestore Rules 對 collectionGroup query 拿不到 projectId 父路徑變數
    //   會 permission-denied → 改用 Promise.all 對每個 plot 並行跑單獨 collection query
    // v2.7.2：從 trees-only 擴成依 methodology.modules 動態 — 每個 plot × 啟用模組各跑一次 getDocs
    //   不啟用的模組完全跳過，避免無謂 read；total=0 的也不存 map（卡片不顯示空 chip）
    const mods = state.project.methodology?.modules || {};
    const enabledColls = SUBCOLL_CHIP_META.filter(m => mods[m.modKey]).map(m => m.coll);
    // qaByPlot: plotId → Map<coll, { total, verified }>
    const qaByPlot = new Map();
    try {
      const statsList = await Promise.all(
        allDocs.flatMap(d =>
          enabledColls.map(async coll => {
            const ref = fb.collection(fb.db, 'projects', projectId, 'plots', d.id, coll);
            const csnap = await fb.getDocs(ref);
            let total = 0, verified = 0;
            csnap.forEach(td => {
              total++;
              if (td.data().qaStatus === 'verified') verified++;
            });
            return { plotId: d.id, coll, total, verified };
          })
        )
      );
      statsList.forEach(s => {
        if (s.total === 0) return;
        if (!qaByPlot.has(s.plotId)) qaByPlot.set(s.plotId, new Map());
        qaByPlot.get(s.plotId).set(s.coll, { total: s.total, verified: s.verified });
      });
    } catch (e) { console.warn('[v2.7.2 subcoll qa stats]', e); }
    const target = state.project.methodology?.targetPlotCount;
    // v1.7.0：surveyor 視角過濾 — 只看被指派 + 自己 createdBy 的
    // v1.7.1.3：admin 不被過濾（god view 永遠看全部）
    const surveyorView = isSurveyor() && !isSystemAdmin();
    const visible = surveyorView
      ? allDocs.filter(d => {
          const dd = d.data();
          return dd.assignedTo === state.user.uid || dd.createdBy === state.user.uid;
        })
      : allDocs;
    $('#plot-progress').textContent = target
      ? `（${visible.length} / ${target}${surveyorView ? '，全專案 ' + allDocs.length : ''}）`
      : `（${visible.length}${surveyorView && visible.length !== allDocs.length ? '，全專案 ' + allDocs.length : ''}）`;

    // v1.7.1：PI 視角偵測「有空殼但沒 surveyor」→ 顯示提示 banner
    if (canQA() && !isLocked()) {
      const shellCount = allDocs.filter(d => !d.data().location).length;
      const unassignedShells = allDocs.filter(d => !d.data().location && !d.data().assignedTo).length;
      if (shellCount > 0 && surveyors.length === 0) {
        list.appendChild(el('div', {
          class: 'col-span-2 bg-blue-50 border border-blue-300 rounded-lg p-3 text-sm flex items-center justify-between gap-2 flex-wrap'
        },
          el('div', {},
            el('div', { class: 'font-semibold text-blue-800' }, '💡 下一步：邀請調查員'),
            el('div', { class: 'text-blue-700 text-xs mt-1' },
              `已建立 ${shellCount} 個空殼樣區，但專案內還沒有任何調查員。請到「設定」分頁加成員，回來這裡才能分派。`)
          ),
          el('a', { href: '#', class: 'bg-blue-600 text-white px-3 py-1.5 rounded text-sm whitespace-nowrap',
            onclick: (ev) => {
              ev.preventDefault();
              const tab = document.querySelector('.tab-link[data-tab="settings"]');
              if (tab) tab.click();
            }
          }, '前往設定 →')
        ));
      } else if (unassignedShells > 0 && surveyors.length > 0) {
        list.appendChild(el('div', {
          class: 'col-span-2 bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm'
        },
          el('div', { class: 'text-amber-800' },
            `📌 仍有 ${unassignedShells} 個空殼樣區尚未指派。每張卡片下方下拉選單可指定 surveyor。`)
        ));
      }
    }

    if (visible.length === 0) {
      list.appendChild(el('p', { class: 'text-stone-500 text-sm col-span-2' },
        isSurveyor() ? '你還沒有被指派的樣區。請聯絡 PI。' : '尚無樣區。'));
      return;
    }
    visible.forEach(d => {
      const dd = d.data();
      const isShell = !dd.location;  // 沒 GPS = 空殼
      const assignedLabel = dd.assignedTo
        ? (dd.assignedTo === state.user.uid ? '指派給我' : `指派給 ${userLabel(dd.assignedTo, dd.assignedTo.slice(0,6))}`)
        : null;
      // 卡片標頭：code + badges
      const headerRight = el('div', { class: 'flex items-center gap-1 flex-wrap' });
      if (isShell) headerRight.appendChild(el('span', { class: 'text-xs bg-stone-200 text-stone-700 px-2 py-0.5 rounded' }, '🔘 待調查'));
      else headerRight.appendChild(el('div', { html: qaBadge(dd.qaStatus) }));
      // v2.6.1：sub-collection 子計數 chip（避免 plot.qaStatus 誤導：plot ✓ 但子集合未審）
      // v2.6.1b：chip 加 data-* 屬性，event listener 才能定位增量更新
      // v2.7.2：從 trees-only 擴成依 methodology.modules 動態，每個有資料的模組各一個 chip
      const plotQa = qaByPlot.get(d.id);
      if (plotQa) {
        // 依 SUBCOLL_CHIP_META 的固定順序渲染（避免 Map 迭代順序差異），保持卡片穩定
        SUBCOLL_CHIP_META.forEach(meta => {
          const stats = plotQa.get(meta.coll);
          if (stats && stats.total > 0) {
            headerRight.appendChild(buildSubcollChipEl(d.id, meta.coll, stats.verified, stats.total));
          }
        });
      }
      // v1.7.1：未指派 shell 補「📌 待指派」紅字（PI 視角）
      if (isShell && !dd.assignedTo && canQA()) {
        headerRight.appendChild(el('span', { class: 'text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded' }, '📌 待指派'));
      }
      // 卡片
      const card = el('a', {
        href: `#/p/${projectId}/plot/${d.id}`,
        class: `block bg-white rounded-xl shadow hover:shadow-md p-4 ${isShell ? 'border-2 border-dashed border-stone-300' : ''}`
      },
        el('div', { class: 'flex justify-between items-start' },
          el('h3', { class: 'font-semibold' }, dd.code),
          headerRight
        ),
        el('p', { class: 'text-sm text-stone-500' },
          `${dd.forestUnit || ''} · ${dd.shape === 'circle' ? '圓' : '方'} ${dd.area_m2 || '?'}m²`),
        el('p', { class: 'text-xs text-stone-400 mt-1' },
          isShell
            ? '尚未開始調查'
            : `${fmtDate(dd.establishedAt)} · ${isReviewer() ? anonName(dd.createdBy) : userLabel(dd.createdBy, '—')}`)
      );
      // PI 視角：加指派下拉（不讓進入連結 stopPropagation）
      if (canQA() && surveyors.length > 0 && !isLocked()) {
        const sel = el('select', {
          class: 'mt-2 text-xs border rounded px-1 py-0.5 w-full',
          onclick: (ev) => ev.preventDefault(),
          onchange: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            forms.assignPlotToSurveyor(state.project, { id: d.id, ...dd }, ev.target.value || null);
          }
        });
        sel.appendChild(el('option', { value: '' }, '— 未指派 —'));
        surveyors.forEach(s => {
          const opt = el('option', { value: s.uid }, s.label);
          if (s.uid === dd.assignedTo) opt.setAttribute('selected', 'true');
          sel.appendChild(opt);
        });
        card.appendChild(sel);
      } else if (assignedLabel) {
        card.appendChild(el('p', { class: 'text-xs text-blue-700 mt-1' }, `📌 ${assignedLabel}`));
      }
      list.appendChild(card);
    });
  });
  state.unsubscribers.push(unsub);

  // 計算 pending / myflagged badge 數
  refreshBadgeCounts(projectId);

  // export buttons
  $('#btn-export-xlsx').addEventListener('click', () => analytics.exportXlsx(state.project));
  $('#btn-export-csv-plots').addEventListener('click', () => analytics.exportCsv(state.project, 'plots'));
  $('#btn-export-csv-trees').addEventListener('click', () => analytics.exportCsv(state.project, 'trees'));
  $('#btn-export-csv-regen').addEventListener('click', () => analytics.exportCsv(state.project, 'regeneration'));
  // v2.0
  $('#btn-export-csv-understory')?.addEventListener('click', () => analytics.exportCsv(state.project, 'understory'));
  $('#btn-export-csv-soilcons')?.addEventListener('click', () => analytics.exportCsv(state.project, 'soilCons'));
  // v2.1 / v2.2
  $('#btn-export-csv-wildlife')?.addEventListener('click', () => analytics.exportCsv(state.project, 'wildlife'));
  $('#btn-export-csv-harvest')?.addEventListener('click', () => analytics.exportCsv(state.project, 'harvest'));
}

async function refreshBadgeCounts(projectId) {
  // pending count（pi/dataManager 才算）
  if (canQA()) {
    try {
      const ps = await getDocs(query(collection(db, 'projects', projectId, 'plots'), where('qaStatus', '==', 'pending')));
      $('#pending-count').textContent = ps.size > 0 ? ps.size : '';
    } catch {}
  }
  // myflagged count（surveyor 才算）
  if (isSurveyor()) {
    try {
      const ps = await getDocs(query(
        collection(db, 'projects', projectId, 'plots'),
        where('createdBy', '==', state.user.uid),
        where('qaStatus', '==', 'flagged')
      ));
      $('#myflagged-count').textContent = ps.size > 0 ? ps.size : '';
    } catch {}
  }
}

function renderDesign() {
  const m = state.project.methodology || DEFAULT_METHODOLOGY;
  const reqList = Object.entries(m.required || {}).filter(([k, v]) => v).map(([k]) => k).join(', ') || '無強制必填';
  const modList = Object.entries(m.modules || {}).filter(([k, v]) => v).map(([k]) => k).join(', ');
  $('#methodology-display').innerHTML = `
    <div><b>樣區目標數</b>：${m.targetPlotCount}</div>
    <div><b>樣區形狀</b>：${m.plotShape === 'circle' ? '圓形' : '方形'}</div>
    <div><b>樣區面積（允許值）</b>：${(m.plotAreaOptions || []).join(' / ')} m²</div>
    <div><b>啟用模組</b>：${modList}</div>
    <div><b>強制必填欄位</b>：${reqList}</div>
    <div><b>方法學說明</b>：<div class="text-stone-600 mt-1 whitespace-pre-wrap">${m.description || '（未填寫）'}</div></div>
  `;
  $('#btn-edit-methodology').onclick = () => {
    if (isLocked()) return toast('資料已 Lock，無法修改');
    forms.openMethodologyForm(state.project);
  };
  // v1.7.0：批量建立空殼樣區
  const batchBtn = $('#btn-batch-plots');
  if (batchBtn) {
    batchBtn.onclick = () => {
      if (isLocked()) return toast('資料已 Lock，無法新增');
      forms.openBatchPlotsForm(state.project);
    };
  }
}

async function renderPending() {
  const list = $('#pending-list');
  list.innerHTML = '<div class="p-4 text-stone-500 text-sm">載入中...</div>';
  try {
    const items = [];
    // 抓 plots
    const ps = await getDocs(query(collection(db, 'projects', state.project.id, 'plots'), where('qaStatus', '==', 'pending')));
    ps.forEach(d => items.push({ kind: 'plot', plotId: d.id, ...d.data() }));
    // 抓 trees + regen（每個 plot 跑一次）— v1.5 簡化：只抓 plot 層
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div class="p-4 text-stone-500 text-sm">沒有待審核項目 🎉</div>';
      return;
    }
    items.forEach(it => {
      const row = el('div', { class: 'p-3 border-b flex justify-between items-center' },
        el('div', {},
          el('div', { class: 'font-medium' }, `${it.code} (${it.kind})`),
          el('div', { class: 'text-xs text-stone-500' },
            `${isReviewer() ? anonName(it.createdBy) : userLabel(it.createdBy, '—')} · ${fmtDate(it.createdAt)}`)
        ),
        el('div', { class: 'flex gap-1' },
          el('button', {
            class: 'text-xs bg-green-600 text-white px-2 py-1 rounded',
            onclick: () => forms.markQA(state.project, it.plotId, null, 'verified')
          }, '✓ verified'),
          el('button', {
            class: 'text-xs bg-amber-500 text-white px-2 py-1 rounded',
            onclick: () => forms.markQA(state.project, it.plotId, null, 'flagged')
          }, '⚠ flag'),
          el('button', {
            class: 'text-xs bg-red-600 text-white px-2 py-1 rounded',
            onclick: () => forms.markQA(state.project, it.plotId, null, 'rejected')
          }, '✕ reject'),
          el('a', { href: `#/p/${state.project.id}/plot/${it.plotId}`, class: 'text-xs text-forest-700 underline ml-2' }, '開啟')
        )
      );
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<div class="p-4 text-red-700 text-sm">載入失敗：${e.message}</div>`;
  }
}

async function renderMyFlagged() {
  const list = $('#myflagged-list');
  list.innerHTML = '<div class="p-4 text-stone-500 text-sm">載入中...</div>';
  try {
    const ps = await getDocs(query(
      collection(db, 'projects', state.project.id, 'plots'),
      where('createdBy', '==', state.user.uid),
      where('qaStatus', 'in', ['flagged', 'rejected'])
    ));
    list.innerHTML = '';
    if (ps.empty) {
      list.innerHTML = '<div class="p-4 text-stone-500 text-sm">沒有被 flag/rejected 的資料 🎉</div>';
      return;
    }
    ps.forEach(d => {
      const it = d.data();
      list.appendChild(el('a', {
        href: `#/p/${state.project.id}/plot/${d.id}`,
        class: 'block p-3 border-b hover:bg-stone-50'
      },
        el('div', { class: 'flex justify-between items-center' },
          el('div', {},
            el('div', { class: 'font-medium' }, it.code),
            el('div', { class: 'text-xs text-stone-500' }, fmtDate(it.createdAt))
          ),
          el('div', { html: qaBadge(it.qaStatus) })
        ),
        it.qaComment ? el('div', { class: 'text-sm text-stone-600 mt-1 italic' }, `「${it.qaComment}」`) : null
      ));
    });
  } catch (e) {
    list.innerHTML = `<div class="p-4 text-red-700 text-sm">載入失敗：${e.message}</div>`;
  }
}

async function renderSettings() {
  const list = $('#member-list');
  list.innerHTML = '';
  const members = state.project.members || {};
  for (const [uid, role] of Object.entries(members)) {
    let label = uid;
    try {
      const us = await getDoc(doc(db, 'users', uid));
      if (us.exists()) label = `${us.data().displayName} (${us.data().email})`;
    } catch {}
    const roleLabel = { pi: '主持人', surveyor: '調查員', reviewer: '審查委員' }[role] || role;
    list.appendChild(el('div', { class: 'flex justify-between' },
      el('span', {}, label),
      el('span', { class: 'text-stone-500' }, roleLabel)
    ));
  }
  // 加成員（v1.7.1.2：加 try/catch 顯示錯誤；admin 自動將自己升為 pi 防呆）
  $('#form-add-member').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').trim();
    let role = fd.get('role');
    try {
      const usnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
      if (usnap.empty) { toast('找不到此 email — 請對方先登入過一次'); return; }
      const targetUid = usnap.docs[0].id;
      // 防呆：admin 加自己時強制設為 pi（避免管理員自己降權）
      if (targetUid === state.user.uid && isSystemAdmin() && role !== 'pi') {
        if (confirm('偵測到你正把自己加為「' + role + '」，要改為「主持人 (pi)」嗎？\n（admin 通常需要 PI 角色才能管理專案）')) {
          role = 'pi';
        }
      }
      const newMembers = { ...members, [targetUid]: role };
      const newMemberUids = Object.keys(newMembers);
      await updateDoc(doc(db, 'projects', state.project.id), { members: newMembers, memberUids: newMemberUids });
      state.project.members = newMembers;
      state.project.memberUids = newMemberUids;
      toast(`已加入：${email} 為 ${role}`);
      renderSettings();
    } catch (err) {
      console.error('加成員失敗:', err);
      toast('加入失敗：' + err.message + '（你目前的角色可能無權變更成員）');
    }
  };
  // v1.7.0：dataManager 選項已從 HTML 移除，舊資料 auto migrate 到 pi（在 renderProjectHome 處理）

  // v2.3：狀態 + Lock 切換（合併顯示）
  const lockStatus = $('#lock-status');
  const lockBtn = $('#btn-toggle-lock');
  const curStatus = state.project.status || STATUS.ACTIVE;
  const meta = STATUS_META[curStatus] || STATUS_META.active;
  const reason = state.project.autoLockReason;
  const reasonText = AUTO_LOCK_REASON_LABEL[reason] || '';
  const lines = [`<div class="flex items-center gap-2 flex-wrap mb-1"><span class="${meta.badgeCls} text-sm px-3 py-1 rounded font-semibold">${meta.label}</span></div>`];
  if (state.project.locked) {
    lines.push(`<div>🔒 <b>已 Lock</b>${reasonText ? `（${reasonText}）` : ''} — 由 ${userLabel(state.project.lockedBy, '系統')} 於 ${fmtDate(state.project.lockedAt)} 鎖定</div>`);
  } else {
    lines.push(`<div>🔓 未鎖定 — 所有授權成員可正常寫入</div>`);
  }
  if (reason === 'all-verified') {
    lines.push(`<div class="text-xs text-stone-500 mt-1">⚙️ 系統自動鎖定。若需修正資料，請對某筆標 ⚠ flag / ✕ reject 即會自動退回 active 並解鎖。</div>`);
  }
  lockStatus.innerHTML = lines.join('');

  // Lock 按鈕：review / verified 隱藏（系統管控）；其他狀態給 PI 手動切換
  const isAutoLocked = state.project.locked && (reason === 'all-verified' || reason === 'legacy');
  if (curStatus === STATUS.VERIFIED || curStatus === STATUS.ARCHIVED) {
    lockBtn.classList.add('hidden');
  } else if (isAutoLocked) {
    // 系統自動 lock：顯示提示按鈕但禁用，引導使用者用 markQA 退回
    lockBtn.classList.remove('hidden');
    lockBtn.textContent = '🔒 系統自動鎖定（請對任一筆標 flag 退回）';
    lockBtn.className = 'bg-stone-300 text-stone-600 px-4 py-2 rounded text-sm cursor-not-allowed';
    lockBtn.disabled = true;
    lockBtn.onclick = (e) => { e.preventDefault(); toast('系統自動鎖定無法手動解除，請對某筆 markQA flag/reject'); };
  } else {
    lockBtn.classList.remove('hidden');
    lockBtn.disabled = false;
    if (state.project.locked) {
      lockBtn.textContent = 'Unlock 專案';
      lockBtn.className = 'bg-amber-600 text-white px-4 py-2 rounded text-sm';
    } else {
      lockBtn.textContent = 'Lock 專案';
      lockBtn.className = 'bg-stone-700 text-white px-4 py-2 rounded text-sm';
    }
    lockBtn.onclick = async () => {
      const newState = !state.project.locked;
      if (!confirm(newState ? '確定 Lock 整個專案？所有成員將無法寫入。' : '確定 Unlock 專案？')) return;
      try {
        await applyStatusAfterManualLock(state.project, newState);
        toast(newState ? '已 Lock（手動）' : '已 Unlock');
        renderSettings();
        renderStatusBanner();
      } catch (e) { toast('操作失敗：' + e.message); }
    };
  }

  // seed demo（admin/pi 可見）
  const seedBtn = $('#btn-seed');
  if (isPi() || isSystemAdmin()) {
    seedBtn.onclick = () => forms.seedDemoData(state.project);
  } else {
    seedBtn.closest('.bg-white').classList.add('hidden');
  }

  // Excel 批次匯入（雛形 / DRY-RUN）— PI 與 admin 可見
  const importBtn = $('#btn-import-excel');
  if (importBtn && (isPi() || isSystemAdmin())) {
    importBtn.onclick = () => {
      if (isLocked()) return toast('資料已 Lock，無法匯入');
      importWizard.openImportWizard(state.project);
    };
  }

  // v1.6.19：admin 專案管理區塊（封存 / 永久刪除依狀態切換顯示）
  if (isSystemAdmin()) {
    const settingsView = $('[data-tab-content="settings"]');
    if (settingsView && !settingsView.querySelector('#admin-danger-zone')) {
      const isArchived = state.project.archived === true;
      const dangerZone = el('div', {
        id: 'admin-danger-zone',
        class: `${isArchived ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'} border rounded-lg p-4 mt-4`
      },
        el('h3', { class: `font-semibold ${isArchived ? 'text-red-800' : 'text-amber-800'} mb-2` },
          isArchived ? '⚠️ 危險區（已封存專案）' : '專案管理（限系統管理員）'),
        el('p', { class: `text-sm ${isArchived ? 'text-red-700' : 'text-amber-700'} mb-3` },
          isArchived
            ? '此專案已封存。可永久刪除（無法救回）或解封存還原。'
            : '案件結束後請使用「封存」— 資料完整保留在 Firebase 雲端，只是從作用中清單移除。'),
        isArchived
          ? el('div', { class: 'flex gap-2 flex-wrap' },
              el('button', {
                class: 'bg-blue-600 text-white px-4 py-2 rounded text-sm',
                onclick: () => forms.unarchiveProject(state.project)
              }, '↺ 解封存'),
              el('button', {
                class: 'bg-red-600 text-white px-4 py-2 rounded text-sm',
                onclick: () => forms.deleteProjectCascade(state.project)
              }, '🗑 永久刪除（無法救回）')
            )
          : el('button', {
              class: 'bg-amber-600 text-white px-4 py-2 rounded text-sm',
              onclick: () => forms.archiveProject(state.project)
            }, '📦 封存專案')
      );
      settingsView.appendChild(dangerZone);
    }
  }
}

async function renderPlotDetail(root, projectId, plotId) {
  const myId = _routeId;  // v1.6.10：搶到 token，後續任何 await 結束都比對
  if (!state.project || state.project.id !== projectId) {
    const psnap = await getDoc(doc(db, 'projects', projectId));
    if (myId !== _routeId) return;
    if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
    state.project = { id: projectId, ...psnap.data() };
    if (!state.project.methodology) state.project.methodology = { ...DEFAULT_METHODOLOGY };
  }
  const pref = doc(db, 'projects', projectId, 'plots', plotId);
  const psnap = await getDoc(pref);
  if (myId !== _routeId) return;
  if (!psnap.exists()) { toast('找不到樣區'); location.hash = `#/p/${projectId}`; return; }
  state.plot = { id: plotId, ...psnap.data() };
  // v1.5.2 Bug #5：直接從 plot detail 入口（深連結）也要預取
  // v2.7：補 verifiedBy
  await prefetchUserLabels([
    ...Object.keys(state.project.members || {}),
    state.project.lockedBy,
    state.project.verifiedBy,
    state.plot.createdBy
  ].filter(Boolean));
  if (myId !== _routeId) return;

  // v1.6.10：DOM 寫入前再清一次 root，雙重保險避免 race append
  root.innerHTML = '';
  const tpl = $('#view-plot-detail').content.cloneNode(true);
  root.appendChild(tpl);
  $('[data-back-to-project]').setAttribute('href', `#/p/${projectId}`);

  const loc = state.plot.location;
  const t97 = state.plot.locationTWD97;
  bindData(root, 'plot', {
    code: state.plot.code,
    forestUnit: state.plot.forestUnit || '—',
    shape: state.plot.shape === 'circle' ? '圓形' : '方形',
    area_m2: state.plot.area_m2,
    wgs84: loc ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : '—',
    twd97: t97 ? `(${t97.x}, ${t97.y})` : '—',
    establishedAt: fmtDate(state.plot.establishedAt),
    createdBy: isReviewer() ? anonName(state.plot.createdBy) : userLabel(state.plot.createdBy, '—'),
    insideBoundary: state.plot.insideBoundary === false ? '⚠ 範圍外' : '✅',
    notes: state.plot.notes || '—'
  });

  applyRoleVisibility();

  // 顯示 QA 狀態 + QA 動作（僅 pi/dataManager）
  const qaBar = el('div', { class: 'mt-2 flex items-center gap-2 flex-wrap' },
    el('div', { html: qaBadge(state.plot.qaStatus) })
  );
  // v1.5.2 Bug #7：plot detail 永遠顯示 Lock 視覺指示
  if (isLocked()) {
    qaBar.appendChild(el('span', {
      class: 'text-xs bg-stone-700 text-white px-2 py-0.5 rounded',
      title: `由 ${userLabel(state.project.lockedBy)} 於 ${fmtDate(state.project.lockedAt)} 鎖定`
    }, '🔒 已鎖定'));
  }
  if (state.plot.qaComment) {
    qaBar.appendChild(el('span', { class: 'text-xs italic text-stone-600' }, `「${state.plot.qaComment}」`));
  }
  if (canQA() && !isLocked()) {
    qaBar.appendChild(el('button', { class: 'text-xs bg-green-600 text-white px-2 py-0.5 rounded',
      onclick: () => forms.markQA(state.project, plotId, null, 'verified') }, '✓ verified'));
    qaBar.appendChild(el('button', { class: 'text-xs bg-amber-500 text-white px-2 py-0.5 rounded',
      onclick: () => forms.markQA(state.project, plotId, null, 'flagged') }, '⚠ flag'));
    qaBar.appendChild(el('button', { class: 'text-xs bg-red-600 text-white px-2 py-0.5 rounded',
      onclick: () => forms.markQA(state.project, plotId, null, 'rejected') }, '✕ reject'));
  }
  $('[data-bind="plot.code"]').parentElement.appendChild(qaBar);

  // v1.6.10：照片 thumbnail（點開全螢幕）— inline style 確保 80x80 不受 Tailwind CDN 影響
  // v1.6.11：加「📷 加照片」獨立按鈕（不必進編輯表單，現場拍立傳）
  const photos = state.plot.photos || [];
  const canAddPhoto = !isLocked() && (
    isPi() || isDataManager() ||
    (isSurveyor() && state.plot.createdBy === state.user.uid)
  );
  if (photos.length > 0 || canAddPhoto) {
    const photoBar = el('div', { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center' });
    photos.forEach(p => {
      photoBar.appendChild(el('a', {
        href: p.url, target: '_blank', rel: 'noopener',
        style: 'display:inline-block;line-height:0', title: p.name || '照片'
      },
        el('img', {
          src: p.url, loading: 'lazy',
          style: 'width:80px;height:80px;object-fit:cover;border-radius:4px;border:1px solid #d6d3d1'
        })
      ));
    });
    if (canAddPhoto) {
      photoBar.appendChild(el('button', {
        type: 'button',
        style: 'width:80px;height:80px;border:2px dashed #a8a29e;border-radius:4px;background:#fafaf9;color:#57534e;font-size:12px;cursor:pointer;line-height:1.2',
        onclick: () => forms.quickAddPhoto(state.project, state.plot)
      }, '📷 加照片'));
    }
    $('[data-bind="plot.code"]').parentElement.appendChild(photoBar);
  }

  // sub-tabs
  $$('.subtab-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const t = a.dataset.subtab;
    $$('.subtab-link').forEach(x => { x.classList.remove('border-forest-700', 'font-medium'); x.classList.add('border-transparent', 'text-stone-600'); });
    a.classList.add('border-forest-700', 'font-medium');
    a.classList.remove('border-transparent', 'text-stone-600');
    $$('[data-subtab-content]').forEach(s => s.classList.add('hidden'));
    $(`[data-subtab-content="${t}"]`).classList.remove('hidden');
    // v2.6.2：切到 distribution 時重 render（hidden → visible 後容器寬度才正確）
    if (t === 'distribution') rerenderDistribution();
  }));

  // v2.3.4：reroute 後恢復原 sub-tab（避免每次 markQA 跳回「立木調查」預設）
  // 必須在 methodology 顯示控制（toggle hidden）之後才呼叫，否則點到 hidden tab
  setTimeout(() => {
    const restore = consumePendingSubtab();
    if (!restore || restore === 'trees') return;
    const tab = $(`.subtab-link[data-subtab="${restore}"]`);
    if (tab && !tab.classList.contains('hidden')) tab.click();
  }, 0);

  $('#btn-new-tree').addEventListener('click', () => {
    if (isLocked()) return toast('資料已 Lock');
    forms.openTreeForm(state.project, state.plot);
  });
  $('#btn-new-regen').addEventListener('click', () => {
    if (isLocked()) return toast('資料已 Lock');
    forms.openRegenForm(state.project, state.plot);
  });
  $('#btn-edit-plot').addEventListener('click', () => {
    if (isLocked()) return toast('資料已 Lock');
    forms.openPlotForm(state.project, state.plot);
  });
  // v2.3.9：標題行常駐「✎ 編輯樣區」按鈕 — 跟 sub-tab 內的舊按鈕同行為
  const editPlotHeaderBtn = $('#btn-edit-plot-header');
  if (editPlotHeaderBtn) {
    editPlotHeaderBtn.addEventListener('click', () => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openPlotForm(state.project, state.plot);
    });
  }
  // v2.3.9：GPS 缺失警示（plot.location 為 null 時顯示）— 直接連到編輯表單
  const gpsWarning = $('#plot-gps-warning');
  if (gpsWarning && !state.plot.location) {
    gpsWarning.innerHTML = '';
    const canEditNow = canCollect() && !isLocked();
    const warning = el('div', {
      class: 'mt-2 inline-flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 px-3 py-1.5 rounded text-xs flex-wrap'
    },
      el('span', { class: 'font-semibold' }, '⚠ 尚未設定 GPS 座標'),
      canEditNow ? el('button', {
        class: 'bg-amber-600 hover:bg-amber-700 text-white px-2 py-0.5 rounded text-xs font-medium',
        onclick: () => forms.openPlotForm(state.project, state.plot)
      }, '✎ 點此設定') : el('span', { class: 'text-amber-700' }, '（無編輯權限）')
    );
    gpsWarning.appendChild(warning);
  }

  // v2.0/v2.1/v2.2：依 methodology 顯示新 subtabs
  const mods = state.project.methodology?.modules || {};
  const understoryTab = $('[data-subtab="understory"]');
  const soilConsTab = $('[data-subtab="soilcons"]');
  const wildlifeTab = $('[data-subtab="wildlife"]');     // v2.1
  const harvestTab = $('[data-subtab="harvest"]');       // v2.2
  if (understoryTab) understoryTab.classList.toggle('hidden', !mods.understory);
  if (soilConsTab) soilConsTab.classList.toggle('hidden', !mods.soilCons);
  if (wildlifeTab) wildlifeTab.classList.toggle('hidden', !mods.wildlife);
  if (harvestTab) harvestTab.classList.toggle('hidden', !mods.harvest);

  const btnNewUnderstory = $('#btn-new-understory');
  const btnNewSoilCons = $('#btn-new-soilcons');
  const btnNewWildlife = $('#btn-new-wildlife');         // v2.1
  const btnNewHarvest = $('#btn-new-harvest');           // v2.2
  if (btnNewUnderstory) {
    btnNewUnderstory.addEventListener('click', () => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openUnderstoryForm(state.project, state.plot);
    });
  }
  if (btnNewSoilCons) {
    btnNewSoilCons.addEventListener('click', () => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openSoilConsForm(state.project, state.plot);
    });
  }
  if (btnNewWildlife) {
    btnNewWildlife.addEventListener('click', () => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openWildlifeForm(state.project, state.plot);
    });
  }
  if (btnNewHarvest) {
    btnNewHarvest.addEventListener('click', () => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openHarvestForm(state.project, state.plot);
    });
  }

  const treesRef = collection(db, 'projects', projectId, 'plots', plotId, 'trees');
  const unsubT = onSnapshot(query(treesRef, orderBy('treeNum', 'asc')), snap => {
    renderTreeList(snap, projectId, plotId);
  });
  state.unsubscribers.push(unsubT);

  const regenRef = collection(db, 'projects', projectId, 'plots', plotId, 'regeneration');
  const unsubR = onSnapshot(query(regenRef, orderBy('createdAt', 'asc')), snap => {
    renderRegenList(snap, projectId, plotId);
  });
  state.unsubscribers.push(unsubR);

  // v2.0：地被植物 list 訂閱
  if (mods.understory) {
    const usRef = collection(db, 'projects', projectId, 'plots', plotId, 'understory');
    const unsubU = onSnapshot(query(usRef, orderBy('surveyDate', 'desc')), snap => {
      renderUnderstoryList(snap, projectId, plotId);
    });
    state.unsubscribers.push(unsubU);
  }
  // v2.0：水保 list 訂閱
  if (mods.soilCons) {
    const scRef = collection(db, 'projects', projectId, 'plots', plotId, 'soilCons');
    const unsubS = onSnapshot(query(scRef, orderBy('surveyDate', 'desc')), snap => {
      renderSoilConsList(snap, projectId, plotId);
    });
    state.unsubscribers.push(unsubS);
  }
  // v2.1：野生動物 list 訂閱
  if (mods.wildlife) {
    const wlRef = collection(db, 'projects', projectId, 'plots', plotId, 'wildlife');
    const unsubW = onSnapshot(query(wlRef, orderBy('surveyDate', 'desc')), snap => {
      renderWildlifeList(snap, projectId, plotId);
    });
    state.unsubscribers.push(unsubW);
  }
  // v2.2：經濟收穫 list 訂閱
  if (mods.harvest) {
    const hvRef = collection(db, 'projects', projectId, 'plots', plotId, 'harvest');
    const unsubH = onSnapshot(query(hvRef, orderBy('harvestDate', 'desc')), snap => {
      renderHarvestList(snap, projectId, plotId);
    });
    state.unsubscribers.push(unsubH);
  }
}

// v1.5.2：subDoc 列上的 QA 按鈕組（直接 append 三顆按鈕到 td，不包 span）
// stopPropagation 避免觸發 row 的 onclick（編輯）

// v2.7.2：plot 卡片 sub-collection QA chip 系統（從 v2.6.1 trees-only 擴成依 methodology.modules 動態）
// 設計：methodology.modules 的 key 與 Firestore subcollection 名稱有對應差異（tree → trees），統一用此表查
const SUBCOLL_CHIP_META = [
  { coll: 'trees',        modKey: 'tree',         icon: '🌳', label: '立木' },
  { coll: 'regeneration', modKey: 'regeneration', icon: '🌱', label: '更新' },
  { coll: 'understory',   modKey: 'understory',   icon: '🌿', label: '地被' },
  { coll: 'soilCons',     modKey: 'soilCons',     icon: '⛰️', label: '水保' },
  { coll: 'wildlife',     modKey: 'wildlife',     icon: '🦌', label: '野生動物' },
  { coll: 'harvest',      modKey: 'harvest',      icon: '🌰', label: '收穫' },
];
const SUBCOLL_CHIP_BY_COLL = Object.fromEntries(SUBCOLL_CHIP_META.map(m => [m.coll, m]));

// v2.7.2：sub-collection chip element 工廠（給 renderPlots 與 mrv:qa-changed listener 共用）
function buildSubcollChipEl(plotId, coll, verified, total) {
  const meta = SUBCOLL_CHIP_BY_COLL[coll];
  if (!meta) return el('span');  // 未知 coll 不顯示
  const allVerified = verified === total;
  const noneVerified = verified === 0;
  const chipCls = allVerified
    ? 'bg-green-100 text-green-800'
    : noneVerified
      ? 'bg-stone-100 text-stone-600'
      : 'bg-amber-100 text-amber-800';
  const statusIcon = allVerified ? '✓' : '⏳';
  return el('span', {
    class: `text-xs px-2 py-0.5 rounded ${chipCls}`,
    'data-qa-chip-plot': plotId,
    'data-qa-chip-coll': coll,
    'data-qa-chip-total': String(total),
    'data-qa-chip-verified': String(verified),
    title: `${meta.label}審核進度（verified / 總筆數）`
  }, `${meta.icon} ${verified}/${total} ${statusIcon}`);
}

// v2.7.2：監聽 markQA 廣播 — sub-doc verified 改變時，找對應 plot + coll 的 chip 增量更新
//   v2.6.1b 原本只支援 trees，今天擴成所有 sub-collection（regen/understory/soilCons/wildlife/harvest）
//   只 mount 一次，後續 navigate 也持續生效（state.unsubscribers 不收這個 — 整個 app lifetime）
if (typeof window !== 'undefined' && !window.__mrvQaListenerMounted) {
  window.__mrvQaListenerMounted = true;
  window.addEventListener('mrv:qa-changed', (ev) => {
    const { plotId, subColl, oldStatus, newStatus } = ev.detail || {};
    if (!SUBCOLL_CHIP_BY_COLL[subColl]) return;  // 未知 coll
    const chip = document.querySelector(
      `[data-qa-chip-plot="${plotId}"][data-qa-chip-coll="${subColl}"]`
    );
    if (!chip) return;  // 樣區清單頁不在當前 view、或該 plot/coll 沒 chip（total=0），無需更新
    const total = parseInt(chip.dataset.qaChipTotal, 10);
    let verified = parseInt(chip.dataset.qaChipVerified, 10);
    if (oldStatus !== 'verified' && newStatus === 'verified') verified++;
    else if (oldStatus === 'verified' && newStatus !== 'verified') verified--;
    else return;  // 沒實質改變（例如 flagged → rejected）— 不影響 verified 計數
    chip.replaceWith(buildSubcollChipEl(plotId, subColl, verified, total));
  });
}

function appendQaButtons(parent, plotId, subDoc) {
  // v2.6.1：subDoc 場景給 cell 加 id，讓 markQA 寫入後可局部更新（不用整頁 reroute）
  if (subDoc) {
    parent.dataset.qaCellId = `qa-cell-${subDoc.coll}-${subDoc.id}`;
  }
  const mk = (bg, label, status) => el('button', {
    class: `qa-action-btn text-xs ${bg} text-white px-1.5 py-0.5 rounded ml-1 align-middle`,
    title: status,
    onclick: (ev) => {
      ev.stopPropagation();
      forms.markQA(state.project, plotId, subDoc, status);
    }
  }, label);
  parent.appendChild(mk('bg-green-600', '✓', 'verified'));
  parent.appendChild(mk('bg-amber-500', '⚠', 'flagged'));
  parent.appendChild(mk('bg-red-600', '✕', 'rejected'));
}

// v2.6.2：散布圖共用最後一次 snapshot — 切到 distribution sub-tab 時不需重 fetch
let _lastTreeSnap = null;
function rerenderDistribution() {
  if (!_lastTreeSnap || !state.plot || !state.project) return;
  renderTreeDistribution(_lastTreeSnap, state.plot, state.project.methodology, {
    onTreeClick: (id, data) => {
      if (isLocked()) return toast('資料已 Lock');
      forms.openTreeForm(state.project, state.plot, { id, ...data });
    }
  });
}

function renderTreeList(snap, projectId, plotId) {
  _lastTreeSnap = snap;   // v2.6.2：留給 distribution 用
  const list = $('#tree-list');
  $('#tree-count').textContent = `（${snap.size} 株）`;
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無立木記錄。</p>';
    $('#tree-summary').innerHTML = '';
    rerenderDistribution();   // v2.6.2：空樣區也讓 distribution 顯示「尚無立木」
    return;
  }
  let totalBA = 0, totalV = 0, sumDbh = 0, sumH = 0;
  const rows = snap.docs.map(d => {
    const t = d.data();
    totalBA += t.basalArea_m2 || 0;
    totalV += t.volume_m3 || 0;
    sumDbh += t.dbh_cm || 0;
    sumH += t.height_m || 0;
    const v = t.vitality;
    const vlabel = { healthy: '健康', weak: '衰弱', 'standing-dead': '枯立', fallen: '倒伏' }[v] || v;
    // v1.6.13：照片 indicator（📷 N）顯示在樹種後面
    const photoCount = (t.photos || []).length;
    const photoTag = photoCount > 0 ? ` <span style="font-size:11px;color:#57534e">📷${photoCount}</span>` : '';
    const speciesCell = el('td', { html: t.speciesZh + (t.conservationGrade ? ' ⚠' : '') + photoTag + ' ' + qaBadge(t.qaStatus) });
    if (canQA() && !isLocked()) {
      appendQaButtons(speciesCell, plotId, { coll: 'trees', id: d.id });
    }
    // v2.5：X/Y 欄（兩數都有才顯示，否則顯示 —）
    const xyText = (Number.isFinite(t.localX_m) && Number.isFinite(t.localY_m))
      ? `${t.localX_m.toFixed(1)}, ${t.localY_m.toFixed(1)}`
      : '—';
    return el('tr', {
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openTreeForm(state.project, state.plot, { id: d.id, ...t });
      }
    },
      // v2.3.3：# 欄位顯示完整 treeCode（舊資料 fallback：plot.code + 補零 treeNum）
      el('td', {}, t.treeCode || `${state.plot.code}-${String(t.treeNum || 0).padStart(3, '0')}`),
      speciesCell,
      el('td', {}, (t.dbh_cm || 0).toFixed(1)),
      el('td', {}, (t.height_m || 0).toFixed(1)),
      el('td', { class: 'text-xs text-stone-600 font-mono' }, xyText),  // v2.5
      el('td', {}, el('span', { class: `badge badge-${v}` }, vlabel)),
      el('td', {}, (t.volume_m3 || 0).toFixed(3))
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {},
      el('tr', {},
        el('th', {}, '#'), el('th', {}, '樹種 / QA'),
        el('th', {}, 'DBH (cm)'), el('th', {}, 'H (m)'),
        el('th', {}, 'X, Y (m)'),  // v2.5
        el('th', {}, '活力'), el('th', {}, '材積 (m³)')
      )
    ),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);

  const n = snap.size;
  $('#tree-summary').innerHTML = '';
  const cells = [
    ['平均 DBH', `${(sumDbh / n).toFixed(1)} cm`],
    ['平均 H', `${(sumH / n).toFixed(1)} m`],
    ['總斷面積', `${totalBA.toFixed(2)} m²`],
    ['總材積', `${totalV.toFixed(2)} m³`]
  ];
  cells.forEach(([k, v]) =>
    $('#tree-summary').appendChild(el('div', {},
      el('div', { class: 'text-xs text-stone-500' }, k),
      el('div', { class: 'font-semibold' }, v)
    ))
  );

  // v2.6.2：每次 snap 更新都重 render distribution（即使在 hidden 也存 _lastTreeSnap，sub-tab 切過去用 rerender）
  rerenderDistribution();
}

function renderRegenList(snap, projectId, plotId) {
  const list = $('#regen-list');
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無更新記錄。</p>';
    return;
  }
  const rows = snap.docs.map(d => {
    const r = d.data();
    const speciesCell = el('td', { html: r.speciesZh + ' ' + qaBadge(r.qaStatus) });
    if (canQA() && !isLocked()) {
      appendQaButtons(speciesCell, plotId, { coll: 'regeneration', id: d.id });
    }
    return el('tr', {
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openRegenForm(state.project, state.plot, { id: d.id, ...r });
      }
    },
      speciesCell,
      el('td', {}, r.heightClass),
      el('td', {}, String(r.count)),
      el('td', {}, r.competitionCover_pct != null ? `${r.competitionCover_pct}%` : '—')
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, el('th', {}, '樹種 / QA'), el('th', {}, '苗高分級'), el('th', {}, '株數'), el('th', {}, '競爭植被'))),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}

function bindData(root, prefix, data) {
  $$(`[data-bind^="${prefix}."]`, root).forEach(node => {
    const key = node.dataset.bind.slice(prefix.length + 1);
    const val = data[key];
    node.textContent = val == null ? '' : String(val);
  });
}

// ===== v2.0：地被植物列表渲染 =====
function renderUnderstoryList(snap, projectId, plotId) {
  const list = $('#understory-list');
  if (!list) return;
  $('#understory-count') && ($('#understory-count').textContent = `（${snap.size} 樣方次）`);
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無地被樣方紀錄。</p>';
    return;
  }
  const rows = snap.docs.map(d => {
    const u = d.data();
    const dateStr = u.surveyDate?.toDate ? u.surveyDate.toDate().toISOString().slice(0, 10) : (u.surveyDate ? new Date(u.surveyDate).toISOString().slice(0, 10) : '—');
    const speciesCount = (u.species || []).length;
    const invasiveCount = u.invasiveCount || 0;
    const photoTag = (u.photos || []).length > 0 ? ` <span style="font-size:11px;color:#57534e">📷${(u.photos || []).length}</span>` : '';
    const stationLabel = { N: '北', E: '東', S: '南', W: '西', C: '中' }[u.quadratCode] || u.quadratCode;
    const speciesCell = el('td', { html: `${stationLabel} (${u.quadratSize})${photoTag} ${qaBadge(u.qaStatus)}` });
    if (canQA() && !isLocked()) {
      appendQaButtons(speciesCell, plotId, { coll: 'understory', id: d.id });
    }
    return el('tr', {
      class: invasiveCount > 0 ? 'bg-orange-50' : '',
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openUnderstoryForm(state.project, state.plot, { id: d.id, ...u });
      }
    },
      el('td', {}, dateStr),
      el('td', {}, u.surveyRound || '—'),
      speciesCell,
      el('td', {}, `${u.totalCoverage ?? 0}%`),
      el('td', {}, String(speciesCount)),
      el('td', {}, invasiveCount > 0 ? el('span', { class: 'text-orange-700 font-medium' }, `⚠ ${invasiveCount}`) : '0')
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {},
      el('th', {}, '調查日'), el('th', {}, '場次'), el('th', {}, '位置 / QA'),
      el('th', {}, '總覆蓋'), el('th', {}, '物種數'), el('th', {}, '入侵種')
    )),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}

// ===== v2.1：野生動物列表渲染（method 分組 + 保育等級色階）=====
function renderWildlifeList(snap, projectId, plotId) {
  const list = $('#wildlife-list');
  if (!list) return;
  $('#wildlife-count') && ($('#wildlife-count').textContent = `（${snap.size} 筆）`);
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無野生動物紀錄。</p>';
    return;
  }
  const consColor = { 'I': '#dc2626', 'II': '#f97316', 'III': '#eab308' };
  const methodLabel = { direct: '🔭 目擊', sign: '🐾 痕跡', cam: '📷 相機', audio: '🔊 鳴聲' };
  const rows = snap.docs.map(d => {
    const w = d.data();
    const dateStr = w.surveyDate?.toDate ? w.surveyDate.toDate().toISOString().slice(0, 10) : (w.surveyDate ? new Date(w.surveyDate).toISOString().slice(0, 10) : '—');
    const photoTag = (w.photos || []).length > 0 ? ` <span style="font-size:11px;color:#57534e">📷${(w.photos || []).length}</span>` : '';
    const consTag = w.conservationGrade
      ? `<span style="background:${consColor[w.conservationGrade]};color:#fff;padding:1px 5px;border-radius:3px;font-size:11px;font-weight:600">${w.conservationGrade}</span>`
      : '';
    const speciesCell = el('td', { html: `${consTag} ${w.speciesZh || '—'}${photoTag} ${qaBadge(w.qaStatus)}` });
    if (canQA() && !isLocked()) {
      appendQaButtons(speciesCell, plotId, { coll: 'wildlife', id: d.id });
    }
    // 保育類整列加色底
    const rowClass = w.conservationGrade === 'I' ? 'bg-red-50'
                   : w.conservationGrade === 'II' ? 'bg-orange-50'
                   : w.conservationGrade === 'III' ? 'bg-yellow-50' : '';
    return el('tr', {
      class: rowClass,
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openWildlifeForm(state.project, state.plot, { id: d.id, ...w });
      }
    },
      el('td', {}, dateStr),
      el('td', {}, methodLabel[w.method] || w.method),
      speciesCell,
      el('td', {}, String(w.count ?? 0)),
      el('td', {}, w.group || '—'),
      el('td', {}, { foraging: '覓食', resting: '休息', moving: '移動', alert: '警戒', breeding: '育幼', calling: '鳴叫' }[w.activity] || '—')
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {},
      el('th', {}, '調查日'), el('th', {}, '方法'), el('th', {}, '物種 / QA'),
      el('th', {}, '隻數'), el('th', {}, '類群'), el('th', {}, '行為')
    )),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}

// ===== v2.2：經濟收穫列表渲染（按 harvestDate desc + 累計碳扣減）=====
function renderHarvestList(snap, projectId, plotId) {
  const list = $('#harvest-list');
  if (!list) return;
  $('#harvest-count') && ($('#harvest-count').textContent = `（${snap.size} 筆）`);
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無採收紀錄。在「立木調查」加入白名單樹種後即可採收。</p>';
    return;
  }
  // 累計
  let totalFresh = 0, totalDry = 0, totalCO2 = 0;
  const typeLabel = { bark: '樹皮', leaves: '嫩葉', twigs: '嫩枝', flowers: '花', roots: '根', whole: '全株' };
  const statusLabel = {
    'kept-resprout': '✅ 重萌', 'kept-no-sprout': '⏳ 未萌',
    'dead': '⚠ 枯死', 'removed': '🪓 砍除'
  };
  const statusColor = {
    'kept-resprout': '#16a34a', 'kept-no-sprout': '#a8a29e',
    'dead': '#eab308', 'removed': '#dc2626'
  };
  const rows = snap.docs.map(d => {
    const h = d.data();
    totalFresh += h.harvestAmount_kg_fresh || 0;
    totalDry += h.dryEstimated_kg || h.harvestAmount_kg_dry || 0;
    totalCO2 += h.carbonRemoved_tCO2e || 0;
    const dateStr = h.harvestDate?.toDate ? h.harvestDate.toDate().toISOString().slice(0, 10) : (h.harvestDate ? new Date(h.harvestDate).toISOString().slice(0, 10) : '—');
    const photoTag = (h.photos || []).length > 0 ? ` <span style="font-size:11px;color:#57534e">📷${(h.photos || []).length}</span>` : '';
    const speciesCell = el('td', { html: `#${h.treeNum || '?'} ${h.speciesZh || '—'}${photoTag} ${qaBadge(h.qaStatus)}` });
    if (canQA() && !isLocked()) {
      appendQaButtons(speciesCell, plotId, { coll: 'harvest', id: d.id });
    }
    return el('tr', {
      class: h.treeStatusAfter === 'removed' ? 'bg-red-50' : '',
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openHarvestForm(state.project, state.plot, { id: d.id, ...h });
      }
    },
      el('td', {}, dateStr),
      speciesCell,
      el('td', {}, typeLabel[h.harvestType] || h.harvestType),
      el('td', {}, (h.harvestAmount_kg_fresh ?? 0).toFixed(2)),
      el('td', {}, (h.dryEstimated_kg ?? h.harvestAmount_kg_dry ?? 0).toFixed(2)),
      el('td', {}, (h.carbonRemoved_tCO2e ?? 0).toFixed(4)),
      el('td', { html: `<span style="color:${statusColor[h.treeStatusAfter] || '#57534e'};font-weight:500">${statusLabel[h.treeStatusAfter] || '—'}</span>` })
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {},
      el('th', {}, '採收日'), el('th', {}, '個體 / QA'), el('th', {}, '部位'),
      el('th', {}, '鮮重 (kg)'), el('th', {}, '乾重 (kg)'),
      el('th', {}, 'CO₂ 扣減 (t)'), el('th', {}, '採後狀態')
    )),
    el('tbody', {}, ...rows),
    el('tfoot', {},
      el('tr', { style: 'background:#f5f5f4;font-weight:600' },
        el('td', { colspan: '3' }, `累計 ${snap.size} 筆`),
        el('td', {}, totalFresh.toFixed(2)),
        el('td', {}, totalDry.toFixed(2)),
        el('td', { style: 'color:#dc2626' }, totalCO2.toFixed(4)),
        el('td', {}, '')
      )
    )
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}

// ===== v2.0：水土保持列表渲染 =====
function renderSoilConsList(snap, projectId, plotId) {
  const list = $('#soilcons-list');
  if (!list) return;
  $('#soilcons-count') && ($('#soilcons-count').textContent = `（${snap.size} 筆）`);
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無水保紀錄。</p>';
    return;
  }
  const rows = snap.docs.map(d => {
    const s = d.data();
    const dateStr = s.surveyDate?.toDate ? s.surveyDate.toDate().toISOString().slice(0, 10) : (s.surveyDate ? new Date(s.surveyDate).toISOString().slice(0, 10) : '—');
    const stationLabel = { N: '北', E: '東', S: '南', W: '西', C: '中' }[s.stationCode] || s.stationCode;
    const eventLabel = { 'routine': '例行', 'post-typhoon': '颱風後', 'post-rain': '豪雨後', 'post-construction': '工程後' }[s.eventType] || s.eventType;
    const erosionColor = ['', '#16a34a', '#84cc16', '#eab308', '#f97316', '#dc2626'][s.erosionLevel] || '#a8a29e';
    const photoTag = (s.photos || []).length > 0 ? ` <span style="font-size:11px;color:#57534e">📷${(s.photos || []).length}</span>` : '';
    const stationCell = el('td', { html: `${stationLabel}${photoTag} ${qaBadge(s.qaStatus)}` });
    if (canQA() && !isLocked()) {
      appendQaButtons(stationCell, plotId, { coll: 'soilCons', id: d.id });
    }
    return el('tr', {
      class: s.erosionLevel >= 4 ? 'bg-red-50' : '',
      onclick: () => {
        if (isLocked()) return toast('資料已 Lock');
        forms.openSoilConsForm(state.project, state.plot, { id: d.id, ...s });
      }
    },
      el('td', {}, dateStr),
      el('td', {}, eventLabel),
      stationCell,
      el('td', {}, `${s.vegCoverage ?? 0}%`),
      el('td', { html: `<span style="color:${erosionColor};font-weight:600">${s.erosionLevel}</span>` }),
      el('td', {}, { good: '良好', ponding: '積水', scouring: '淘刷', blocked: '阻塞' }[s.drainage] || '—')
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {},
      el('th', {}, '調查日'), el('th', {}, '事件'), el('th', {}, '點位 / QA'),
      el('th', {}, '植覆'), el('th', {}, '沖蝕'), el('th', {}, '排水')
    )),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}
