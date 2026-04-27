// ===== preview-app-mock.js =====
// 用於 preview-import-wizard.html — 取代真實 app.js 的 export，讓 wizard 雛形可獨立運行
// 不連 Firebase、不需登入、純前端 UI 預覽

export const fb = {
  collection: () => null,
  doc: () => null,
  addDoc: () => Promise.resolve({ id: 'mock-id' }),
  updateDoc: () => Promise.resolve(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  db: null,
};

export const state = {
  user: { uid: 'preview-uid-0001', email: 'preview@local' },
  project: { id: 'mock-project-id', code: 'PREVIEW', name: '預覽專案（無寫入）' },
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
  if (!t) { console.log('[toast]', msg); return; }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

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

export function twd97ToWgs84(x, y) {
  if (typeof proj4 === 'undefined') return { lng: null, lat: null };
  const [lng, lat] = proj4('EPSG:3826', 'EPSG:4326', [x, y]);
  return { lng, lat };
}
