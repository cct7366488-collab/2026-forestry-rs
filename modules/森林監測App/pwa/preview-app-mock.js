// ===== preview-app-mock.js =====
// 用於 preview-import-wizard.html — 取代真實 app.js 的 export，讓 wizard 雛形可獨立運行
// 不連 Firebase、不需登入、純前端 UI 預覽

// Mock GeoPoint class（preview 不真寫入，只需 constructor 不爆）
class MockGeoPoint {
  constructor(lat, lng) { this.latitude = lat; this.longitude = lng; }
}

export const fb = {
  collection: () => null,
  doc: () => null,
  addDoc: () => Promise.resolve({ id: 'mock-' + Math.random().toString(36).slice(2, 8) }),
  getDocs: () => Promise.resolve({ forEach: () => {}, docs: [], size: 0, empty: true }),
  updateDoc: () => Promise.resolve(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  GeoPoint: MockGeoPoint,
  db: null,
};

// v2.6 mock：preview 環境的 calcTreeMetrics — 用粗略 broadleaf fallback 公式（V = 4.64e-5 × D^1.53578 × H^1.50657）
export function calcTreeMetrics({ dbh_cm, height_m }) {
  if (!dbh_cm || !height_m) {
    return { basalArea_m2: 0, volume_m3: 0, biomass_kg: 0, carbon_kg: 0, co2_kg: 0 };
  }
  const D = dbh_cm, H = height_m;
  const basalArea_m2 = Math.PI * Math.pow(D / 200, 2);
  const volume_m3 = 4.64e-5 * Math.pow(D, 1.53578) * Math.pow(H, 1.50657);
  const biomass_t = volume_m3 * 0.6;
  const carbon_t = biomass_t * 0.47;
  return {
    basalArea_m2: +basalArea_m2.toFixed(4),
    volume_m3: +volume_m3.toFixed(3),
    biomass_kg: +(biomass_t * 1000).toFixed(1),
    carbon_kg: +(carbon_t * 1000).toFixed(1),
    co2_kg: +(carbon_t * 1000 * 44 / 12).toFixed(1),
  };
}

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
