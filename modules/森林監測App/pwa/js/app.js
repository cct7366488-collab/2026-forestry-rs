// ===== app.js — v1.5 主程式：5 角色 + Lock + QA + memberUids =====

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

import { firebaseConfig } from "../firebase-config.js";
import * as forms from "./forms.js";
import * as analytics from "./analytics.js";

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
export function isDataManager() { return projectRole() === 'dataManager'; }
export function isSurveyor() { return projectRole() === 'surveyor'; }
export function isReviewer() { return projectRole() === 'reviewer'; }
export function canQA() { return isPi() || isDataManager(); }
export function canCollect() { return isPi() || isDataManager() || isSurveyor(); }
export function isLocked() { return state.project?.locked === true; }

// 預設方法學（v1.5 新專案/無 methodology 的舊專案 fallback）
export const DEFAULT_METHODOLOGY = {
  targetPlotCount: 50,
  plotShape: 'circle',
  plotAreaOptions: [400, 500, 1000],
  required: { photos: false, branchHeight: false, pestSymptoms: false },
  modules: { plot: true, tree: true, regeneration: true, understory: false, soil: false, disturbance: false },
  description: ''
};

// ===== 工具 =====
export const fb = {
  app, db, auth, storage,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint, collectionGroup
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

export function calcTreeMetrics({ dbh_cm, height_m, speciesSci }) {
  if (!dbh_cm || !height_m) return { basalArea_m2: 0, volume_m3: 0, carbon_kg: 0 };
  const basalArea_m2 = Math.PI * Math.pow(dbh_cm / 200, 2);
  const formFactor = (speciesSci || '').match(/Pinus|Cunninghamia|Cryptomeria|Cedrus|Picea|Abies|Tsuga|Taiwania|Chamaecyparis|Calocedrus|Keteleeria|Amentotaxus|Taxus|Podocarpus|Juniperus/) ? 0.5 : 0.45;
  const volume_m3 = 0.0000785 * dbh_cm * dbh_cm * height_m * formFactor;
  const carbon_kg = volume_m3 * 500 * 1.4 * 0.5;
  return {
    basalArea_m2: +basalArea_m2.toFixed(4),
    volume_m3: +volume_m3.toFixed(3),
    carbon_kg: +carbon_kg.toFixed(1)
  };
}

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
}
export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-backdrop').classList.add('hidden');
}
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', closeModal);

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

async function googleLogin() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { toast('Google 登入失敗：' + e.message); }
}
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
  return { route: 'projects' };
}

let _initialNav = true;

async function route() {
  state.unsubscribers.forEach(u => u());
  state.unsubscribers = [];

  const main = $('#app');
  main.innerHTML = '';

  if (!state.user) { _initialNav = true; return renderLogin(main); }

  const r = parseHash();

  // 首次載入自動跳轉：lastProjectId or 唯一專案（非 admin）
  if (r.route === 'projects' && _initialNav) {
    _initialNav = false;
    const lastId = localStorage.getItem('lastProjectId');
    if (lastId) {
      try {
        const ps = await getDoc(doc(db, 'projects', lastId));
        if (ps.exists() && (ps.data().members?.[state.user.uid] || isSystemAdmin())) {
          location.replace(`#/p/${lastId}`);
          return;
        }
      } catch {}
      localStorage.removeItem('lastProjectId');
    }
    if (!isSystemAdmin()) {
      try {
        const snap = await getDocs(query(
          collection(db, 'projects'),
          where('memberUids', 'array-contains', state.user.uid)
        ));
        if (snap.size === 1) {
          location.replace(`#/p/${snap.docs[0].id}`);
          return;
        }
      } catch {}
    }
  }
  _initialNav = false;

  if (r.route === 'projects') {
    await renderProjects(main);
  } else if (r.route === 'project') {
    localStorage.setItem('lastProjectId', r.projectId);
    await renderProjectHome(main, r.projectId);
  } else if (r.route === 'plot') {
    localStorage.setItem('lastProjectId', r.projectId);
    await renderPlotDetail(main, r.projectId, r.plotId);
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
  const tpl = $('#view-projects').content.cloneNode(true);
  root.appendChild(tpl);

  const newBtn = $('#btn-new-project');
  if (!isSystemAdmin()) {
    newBtn.classList.add('hidden');
  } else {
    newBtn.addEventListener('click', () => forms.openProjectForm());
  }

  const list = $('#project-list');

  // admin: 看全部；非 admin: where('memberUids', 'array-contains', uid)
  const q = isSystemAdmin()
    ? query(collection(db, 'projects'))
    : query(collection(db, 'projects'), where('memberUids', 'array-contains', state.user.uid));

  const unsub = onSnapshot(q, snap => {
    list.innerHTML = '';
    if (snap.empty) {
      const msg = isSystemAdmin()
        ? '還沒有專案。點右上「＋ 新專案」建立第一個。'
        : `你還沒被邀請加入任何專案。請聯絡計畫主持人，提供你的登入 email：${state.user.email}`;
      list.appendChild(el('div', {
        class: 'col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-4 text-stone-700 text-sm'
      }, msg));
      return;
    }
    snap.forEach(d => {
      const data = d.data();
      const role = data.members?.[state.user.uid] || (isSystemAdmin() ? 'admin' : '?');
      const roleLabel = { pi: '主持人', dataManager: '資料管理員', surveyor: '調查員', reviewer: '審查委員', admin: '系統管理者' }[role] || role;
      const lockBadge = data.locked
        ? el('span', { class: 'text-xs bg-stone-200 text-stone-700 px-2 py-0.5 rounded ml-1' }, '🔒 已 Lock')
        : null;
      list.appendChild(el('a', {
        href: `#/p/${d.id}`,
        class: 'block bg-white rounded-xl shadow hover:shadow-md p-4 transition'
      },
        el('div', { class: 'flex justify-between items-start' },
          el('h3', { class: 'font-semibold' }, data.name),
          el('div', { class: 'flex items-center' },
            el('span', { class: 'text-xs bg-stone-100 px-2 py-0.5 rounded' }, roleLabel),
            lockBadge
          )
        ),
        el('p', { class: 'text-sm text-stone-500 mt-1' }, data.code),
        data.description ? el('p', { class: 'text-sm text-stone-600 mt-2' }, data.description) : null
      ));
    });
  }, err => {
    list.innerHTML = `<div class="col-span-2 bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm">載入失敗：${err.message}</div>`;
  });
  state.unsubscribers.push(unsub);
}

async function renderProjectHome(root, projectId) {
  const pref = doc(db, 'projects', projectId);
  const psnap = await getDoc(pref);
  if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
  state.project = { id: projectId, ...psnap.data() };
  // 補預設 methodology（舊專案 fallback）
  if (!state.project.methodology) state.project.methodology = { ...DEFAULT_METHODOLOGY };

  const tpl = $('#view-project-home').content.cloneNode(true);
  root.appendChild(tpl);
  bindData(root, 'project', state.project);

  // 套用角色顯示矩陣
  applyRoleVisibility();

  // Lock banner
  if (isLocked()) $('#lock-banner').classList.remove('hidden');

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
  // surveyor 看全部（為了 QA 透明度），不再限 own
  const qPlots = query(plotsRef, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(qPlots, snap => {
    const list = $('#plot-list');
    list.innerHTML = '';
    const total = snap.size;
    const target = state.project.methodology?.targetPlotCount;
    $('#plot-progress').textContent = target ? `（${total} / ${target}）` : `（${total}）`;

    if (snap.empty) {
      list.appendChild(el('p', { class: 'text-stone-500 text-sm col-span-2' }, '尚無樣區。'));
      return;
    }
    snap.forEach(d => {
      const dd = d.data();
      list.appendChild(el('a', {
        href: `#/p/${projectId}/plot/${d.id}`,
        class: 'block bg-white rounded-xl shadow hover:shadow-md p-4'
      },
        el('div', { class: 'flex justify-between items-start' },
          el('h3', { class: 'font-semibold' }, dd.code),
          el('div', { html: qaBadge(dd.qaStatus) })
        ),
        el('p', { class: 'text-sm text-stone-500' }, `${dd.forestUnit || ''} · ${dd.shape === 'circle' ? '圓' : '方'} ${dd.area_m2}m²`),
        el('p', { class: 'text-xs text-stone-400 mt-1' },
          `${fmtDate(dd.establishedAt)} · ${isReviewer() ? anonName(dd.createdBy) : (dd.createdBy === state.user.uid ? '我' : (dd.createdBy || '').slice(0, 8))}`)
      ));
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
            `${isReviewer() ? anonName(it.createdBy) : (it.createdBy || '').slice(0, 8)} · ${fmtDate(it.createdAt)}`)
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
    const roleLabel = { pi: '主持人', dataManager: '資料管理員', surveyor: '調查員', reviewer: '審查委員' }[role] || role;
    list.appendChild(el('div', { class: 'flex justify-between' },
      el('span', {}, label),
      el('span', { class: 'text-stone-500' }, roleLabel)
    ));
  }
  // 加成員
  $('#form-add-member').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');
    const role = fd.get('role');
    const usnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
    if (usnap.empty) { toast('找不到此 email — 請對方先登入過一次'); return; }
    const targetUid = usnap.docs[0].id;
    const newMembers = { ...members, [targetUid]: role };
    const newMemberUids = Object.keys(newMembers);
    await updateDoc(doc(db, 'projects', state.project.id), { members: newMembers, memberUids: newMemberUids });
    state.project.members = newMembers;
    state.project.memberUids = newMemberUids;
    toast('已加入');
    renderSettings();
  };
  // 加 surveyor 選項
  const sel = $('#form-add-member [name=role]');
  if (sel && !sel.querySelector('option[value=dataManager]')) {
    const opt = document.createElement('option');
    opt.value = 'dataManager'; opt.textContent = '資料管理員';
    sel.appendChild(opt);
  }

  // Lock 切換
  const lockStatus = $('#lock-status');
  const lockBtn = $('#btn-toggle-lock');
  if (state.project.locked) {
    lockStatus.innerHTML = `🔒 <b>已 Lock</b> — 由 ${state.project.lockedBy?.slice(0, 8) || '?'} 於 ${fmtDate(state.project.lockedAt)} 鎖定`;
    lockBtn.textContent = 'Unlock 專案';
    lockBtn.className = 'bg-amber-600 text-white px-4 py-2 rounded text-sm';
  } else {
    lockStatus.innerHTML = '🔓 未鎖定 — 所有授權成員可正常寫入';
    lockBtn.textContent = 'Lock 專案';
    lockBtn.className = 'bg-stone-700 text-white px-4 py-2 rounded text-sm';
  }
  lockBtn.onclick = async () => {
    const newState = !state.project.locked;
    if (!confirm(newState ? '確定 Lock 整個專案？所有成員將無法寫入。' : '確定 Unlock 專案？')) return;
    await updateDoc(doc(db, 'projects', state.project.id), {
      locked: newState,
      lockedAt: newState ? serverTimestamp() : null,
      lockedBy: newState ? state.user.uid : null
    });
    state.project.locked = newState;
    toast(newState ? '已 Lock' : '已 Unlock');
    renderSettings();
  };

  // seed demo（admin/pi 可見）
  const seedBtn = $('#btn-seed');
  if (isPi() || isSystemAdmin()) {
    seedBtn.onclick = () => forms.seedDemoData(state.project);
  } else {
    seedBtn.closest('.bg-white').classList.add('hidden');
  }
}

async function renderPlotDetail(root, projectId, plotId) {
  if (!state.project || state.project.id !== projectId) {
    const psnap = await getDoc(doc(db, 'projects', projectId));
    if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
    state.project = { id: projectId, ...psnap.data() };
    if (!state.project.methodology) state.project.methodology = { ...DEFAULT_METHODOLOGY };
  }
  const pref = doc(db, 'projects', projectId, 'plots', plotId);
  const psnap = await getDoc(pref);
  if (!psnap.exists()) { toast('找不到樣區'); location.hash = `#/p/${projectId}`; return; }
  state.plot = { id: plotId, ...psnap.data() };

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
    createdBy: isReviewer() ? anonName(state.plot.createdBy) : (state.plot.createdBy === state.user.uid ? '我' : (state.plot.createdBy || '').slice(0, 8)),
    insideBoundary: state.plot.insideBoundary === false ? '⚠ 範圍外' : '✅',
    notes: state.plot.notes || '—'
  });

  applyRoleVisibility();

  // 顯示 QA 狀態 + QA 動作（僅 pi/dataManager）
  const qaBar = el('div', { class: 'mt-2 flex items-center gap-2 flex-wrap' },
    el('div', { html: qaBadge(state.plot.qaStatus) })
  );
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

  // sub-tabs
  $$('.subtab-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const t = a.dataset.subtab;
    $$('.subtab-link').forEach(x => { x.classList.remove('border-forest-700', 'font-medium'); x.classList.add('border-transparent', 'text-stone-600'); });
    a.classList.add('border-forest-700', 'font-medium');
    a.classList.remove('border-transparent', 'text-stone-600');
    $$('[data-subtab-content]').forEach(s => s.classList.add('hidden'));
    $(`[data-subtab-content="${t}"]`).classList.remove('hidden');
  }));

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
}

function renderTreeList(snap, projectId, plotId) {
  const list = $('#tree-list');
  $('#tree-count').textContent = `（${snap.size} 株）`;
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無立木記錄。</p>';
    $('#tree-summary').innerHTML = '';
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
    return el('tr', { onclick: () => forms.openTreeForm(state.project, state.plot, { id: d.id, ...t }) },
      el('td', {}, String(t.treeNum)),
      el('td', { html: t.speciesZh + (t.conservationGrade ? ' ⚠' : '') + ' ' + qaBadge(t.qaStatus) }),
      el('td', {}, (t.dbh_cm || 0).toFixed(1)),
      el('td', {}, (t.height_m || 0).toFixed(1)),
      el('td', {}, el('span', { class: `badge badge-${v}` }, vlabel)),
      el('td', {}, (t.volume_m3 || 0).toFixed(3))
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {},
      el('tr', {},
        el('th', {}, '#'), el('th', {}, '樹種 / QA'),
        el('th', {}, 'DBH (cm)'), el('th', {}, 'H (m)'),
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
}

function renderRegenList(snap, projectId, plotId) {
  const list = $('#regen-list');
  if (snap.empty) {
    list.innerHTML = '<p class="p-4 text-stone-500 text-sm">尚無更新記錄。</p>';
    return;
  }
  const rows = snap.docs.map(d => {
    const r = d.data();
    return el('tr', { onclick: () => forms.openRegenForm(state.project, state.plot, { id: d.id, ...r }) },
      el('td', { html: r.speciesZh + ' ' + qaBadge(r.qaStatus) }),
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
