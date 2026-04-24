// ===== app.js — 主程式：Firebase 初始化 + Auth + Router + 共用工具 =====

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint
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

// proj4 投影定義（TWD97 TM2 zone 121）
proj4.defs("EPSG:3826", "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs");

// ===== 全域狀態 =====
export const state = {
  user: null,           // Firebase user
  userDoc: null,        // /users/{uid} document
  project: null,        // currently selected project { id, ...data }
  plot: null,           // currently selected plot
  unsubscribers: []     // 收聽中的 onSnapshot
};

// ===== 工具函式（給 forms / analytics 用，export 出去）=====
export const fb = {
  app, db, auth, storage,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, GeoPoint
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

// 自動計算（前端即時）
export function calcTreeMetrics({ dbh_cm, height_m, speciesSci }) {
  if (!dbh_cm || !height_m) return { basalArea_m2: 0, volume_m3: 0, carbon_kg: 0 };
  const basalArea_m2 = Math.PI * Math.pow(dbh_cm / 200, 2);
  // 簡式材積：V = 0.0000785 × DBH² × H × FormFactor
  const formFactor = (speciesSci || '').match(/Pinus|Cunninghamia|Cryptomeria|Cedrus|Picea|Abies|Tsuga/) ? 0.5 : 0.45;
  const volume_m3 = 0.0000785 * dbh_cm * dbh_cm * height_m * formFactor;
  // 碳量：V × WoodDensity × BEF × 0.5
  const woodDensity = 500;
  const bef = 1.4;
  const carbon_kg = volume_m3 * woodDensity * bef * 0.5;
  return {
    basalArea_m2: +basalArea_m2.toFixed(4),
    volume_m3: +volume_m3.toFixed(3),
    carbon_kg: +carbon_kg.toFixed(1)
  };
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
    nav.appendChild(el('span', { class: 'text-stone-200 text-xs hidden sm:inline' },
      state.userDoc?.displayName || state.user.email));
    nav.appendChild(el('button', {
      class: 'border border-white/30 px-2 py-1 rounded text-xs',
      onclick: async () => { await signOut(auth); location.hash = ''; }
    }, '登出'));
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (user) {
    // 確保 /users/{uid} 文件存在
    const uref = doc(db, 'users', user.uid);
    const usnap = await getDoc(uref);
    if (!usnap.exists()) {
      await setDoc(uref, {
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        globalRole: 'user',
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
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) { toast('Google 登入失敗：' + e.message); }
}
async function emailLogin(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) { toast('登入失敗：' + e.message); }
}
async function emailSignup(email, password) {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    toast('註冊成功，已自動登入');
  } catch (e) { toast('註冊失敗：' + e.message); }
}

// ===== Router =====
// #/                       → projects 列表（或 login）
// #/p/:projectId          → 專案首頁（tabs）
// #/p/:projectId/plot/:plotId → 樣區明細
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const m1 = h.match(/^\/p\/([^\/]+)\/plot\/([^\/]+)$/);
  if (m1) return { route: 'plot', projectId: m1[1], plotId: m1[2] };
  const m2 = h.match(/^\/p\/([^\/]+)$/);
  if (m2) return { route: 'project', projectId: m2[1] };
  return { route: 'projects' };
}

async function route() {
  // 取消舊的 onSnapshot
  state.unsubscribers.forEach(u => u());
  state.unsubscribers = [];

  const main = $('#app');
  main.innerHTML = '';

  if (!state.user) return renderLogin(main);

  const r = parseHash();
  if (r.route === 'projects') {
    await renderProjects(main);
  } else if (r.route === 'project') {
    await renderProjectHome(main, r.projectId);
  } else if (r.route === 'plot') {
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
  $('#btn-new-project').addEventListener('click', () => forms.openProjectForm());

  const list = $('#project-list');
  // 撈 members 包含我的 projects
  const q = query(collection(db, 'projects'));
  const snap = await getDocs(q);
  const mine = snap.docs.filter(d => d.data().members?.[state.user.uid]);
  if (mine.length === 0) {
    list.appendChild(el('p', { class: 'text-stone-500 text-sm col-span-2' },
      '還沒有專案。點右上「＋ 新專案」建立第一個。'));
    return;
  }
  for (const d of mine) {
    const data = d.data();
    const role = data.members[state.user.uid];
    list.appendChild(el('a', {
      href: `#/p/${d.id}`,
      class: 'block bg-white rounded-xl shadow hover:shadow-md p-4 transition'
    },
      el('div', { class: 'flex justify-between items-start' },
        el('h3', { class: 'font-semibold' }, data.name),
        el('span', { class: 'text-xs bg-stone-100 px-2 py-0.5 rounded' }, role)
      ),
      el('p', { class: 'text-sm text-stone-500 mt-1' }, data.code),
      data.description ? el('p', { class: 'text-sm text-stone-600 mt-2' }, data.description) : null
    ));
  }
}

async function renderProjectHome(root, projectId) {
  const pref = doc(db, 'projects', projectId);
  const psnap = await getDoc(pref);
  if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
  state.project = { id: projectId, ...psnap.data() };

  const tpl = $('#view-project-home').content.cloneNode(true);
  root.appendChild(tpl);
  bindData(root, 'project', state.project);

  // tabs
  $$('.tab-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const tab = a.dataset.tab;
    $$('.tab-link').forEach(x => x.classList.remove('border-forest-700', 'font-medium', 'text-stone-600'));
    $$('.tab-link').forEach(x => x.classList.add('border-transparent', 'text-stone-600'));
    a.classList.add('border-forest-700', 'font-medium');
    a.classList.remove('border-transparent', 'text-stone-600');
    $$('[data-tab-content]').forEach(s => s.classList.add('hidden'));
    $(`[data-tab-content="${tab}"]`).classList.remove('hidden');
    if (tab === 'dashboard') analytics.renderDashboard(state.project);
    if (tab === 'map') analytics.renderMap(state.project);
    if (tab === 'export') {} // buttons bound below
    if (tab === 'settings') renderSettings();
  }));

  // 樣區列表（即時）
  $('#btn-new-plot').addEventListener('click', () => forms.openPlotForm(state.project));
  const plotsRef = collection(db, 'projects', projectId, 'plots');
  const role = state.project.members[state.user.uid];
  const qPlots = (role === 'surveyor')
    ? query(plotsRef, where('createdBy', '==', state.user.uid), orderBy('createdAt', 'desc'))
    : query(plotsRef, orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(qPlots, snap => {
    const list = $('#plot-list');
    list.innerHTML = '';
    if (snap.empty) {
      list.appendChild(el('p', { class: 'text-stone-500 text-sm col-span-2' }, '尚無樣區。點「＋ 新樣區」建立。'));
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
          dd.insideBoundary === false
            ? el('span', { class: 'text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded', title: 'GPS 不在計畫範圍內' }, '⚠ 範圍外')
            : null
        ),
        el('p', { class: 'text-sm text-stone-500' }, `${dd.forestUnit || ''} · ${dd.shape === 'circle' ? '圓' : '方'} ${dd.area_m2}m²`),
        el('p', { class: 'text-xs text-stone-400 mt-1' }, fmtDate(dd.establishedAt))
      ));
    });
  });
  state.unsubscribers.push(unsub);

  // export buttons
  $('#btn-export-xlsx').addEventListener('click', () => analytics.exportXlsx(state.project));
  $('#btn-export-csv-plots').addEventListener('click', () => analytics.exportCsv(state.project, 'plots'));
  $('#btn-export-csv-trees').addEventListener('click', () => analytics.exportCsv(state.project, 'trees'));
  $('#btn-export-csv-regen').addEventListener('click', () => analytics.exportCsv(state.project, 'regeneration'));
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
    list.appendChild(el('div', { class: 'flex justify-between' },
      el('span', {}, label),
      el('span', { class: 'text-stone-500' }, role)
    ));
  }
  // add member
  $('#form-add-member').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email');
    const role = fd.get('role');
    // find uid by email
    const usnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
    if (usnap.empty) { toast('找不到此 email — 請對方先登入過一次'); return; }
    const targetUid = usnap.docs[0].id;
    const newMembers = { ...members, [targetUid]: role };
    await updateDoc(doc(db, 'projects', state.project.id), { members: newMembers });
    state.project.members = newMembers;
    toast('已加入');
    renderSettings();
  };
  // seed demo
  $('#btn-seed').onclick = () => forms.seedDemoData(state.project);
}

async function renderPlotDetail(root, projectId, plotId) {
  // 確保 project 載入
  if (!state.project || state.project.id !== projectId) {
    const psnap = await getDoc(doc(db, 'projects', projectId));
    if (!psnap.exists()) { toast('找不到專案'); location.hash = ''; return; }
    state.project = { id: projectId, ...psnap.data() };
  }
  const pref = doc(db, 'projects', projectId, 'plots', plotId);
  const psnap = await getDoc(pref);
  if (!psnap.exists()) { toast('找不到樣區'); location.hash = `#/p/${projectId}`; return; }
  state.plot = { id: plotId, ...psnap.data() };

  const tpl = $('#view-plot-detail').content.cloneNode(true);
  root.appendChild(tpl);
  $('[data-back-to-project]').setAttribute('href', `#/p/${projectId}`);

  // bind plot data
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
    createdBy: state.plot.createdBy === state.user.uid ? '我' : state.plot.createdBy.slice(0, 8),
    insideBoundary: state.plot.insideBoundary === false ? '⚠ 範圍外' : '✅',
    notes: state.plot.notes || '—'
  });

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

  $('#btn-new-tree').addEventListener('click', () => forms.openTreeForm(state.project, state.plot));
  $('#btn-new-regen').addEventListener('click', () => forms.openRegenForm(state.project, state.plot));
  $('#btn-edit-plot').addEventListener('click', () => forms.openPlotForm(state.project, state.plot));

  // 立木列表（即時）
  const treesRef = collection(db, 'projects', projectId, 'plots', plotId, 'trees');
  const unsubT = onSnapshot(query(treesRef, orderBy('treeNum', 'asc')), snap => {
    renderTreeList(snap, projectId, plotId);
  });
  state.unsubscribers.push(unsubT);

  // 更新列表
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
  let totalBA = 0, totalV = 0, totalC = 0, sumDbh = 0, sumH = 0;
  const rows = snap.docs.map(d => {
    const t = d.data();
    totalBA += t.basalArea_m2 || 0;
    totalV += t.volume_m3 || 0;
    totalC += t.carbon_kg || 0;
    sumDbh += t.dbh_cm || 0;
    sumH += t.height_m || 0;
    const v = t.vitality;
    const vlabel = { healthy: '健康', weak: '衰弱', 'standing-dead': '枯立', fallen: '倒伏' }[v] || v;
    return el('tr', { 'data-id': d.id, onclick: () => forms.openTreeForm(state.project, state.plot, { id: d.id, ...t }) },
      el('td', {}, String(t.treeNum)),
      el('td', {}, t.speciesZh + (t.conservationGrade ? ' ⚠' : '')),
      el('td', {}, (t.dbh_cm || 0).toFixed(1)),
      el('td', {}, (t.height_m || 0).toFixed(1)),
      el('td', {}, el('span', { class: `badge badge-${v}` }, vlabel)),
      el('td', {}, (t.volume_m3 || 0).toFixed(3))
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {},
      el('tr', {},
        el('th', {}, '#'),
        el('th', {}, '樹種'),
        el('th', {}, 'DBH (cm)'),
        el('th', {}, 'H (m)'),
        el('th', {}, '活力'),
        el('th', {}, '材積 (m³)')
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
      el('td', {}, r.speciesZh),
      el('td', {}, r.heightClass),
      el('td', {}, String(r.count)),
      el('td', {}, r.competitionCover_pct != null ? `${r.competitionCover_pct}%` : '—')
    );
  });
  const tbl = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, el('th', {}, '樹種'), el('th', {}, '苗高分級'), el('th', {}, '株數'), el('th', {}, '競爭植被'))),
    el('tbody', {}, ...rows)
  );
  list.innerHTML = '';
  list.appendChild(tbl);
}

// data binding helper（簡單 textContent 綁定）
function bindData(root, prefix, data) {
  $$(`[data-bind^="${prefix}."]`, root).forEach(node => {
    const key = node.dataset.bind.slice(prefix.length + 1);
    const val = data[key];
    node.textContent = val == null ? '' : String(val);
  });
}

// ===== 啟動 =====
// (onAuthStateChanged 會自動觸發 route())
