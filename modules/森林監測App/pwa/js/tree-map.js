// ===== tree-map.js — v2.11.29 plot detail 地圖（樣區邊界 + 立木 marker + drag-to-edit）=====
//
// 設計：
//   - 入口 initTreeMap({ container, plot, project, canEdit, onTreeClick })
//     回傳 { updateTrees(trees), destroy() }
//   - 邊界 polygon：藍色半透明（用 plot-geometry.computePlotCorners）
//   - 立木 marker：DivIcon 圓點，顏色按 QA 狀態，gps=實心 / offset=空心、精度 >10m 虛線邊
//   - Edit 模式：toolbar「✏️ 編輯位置」toggle → 所有 marker 可拖移；改完顯示「💾 儲存 N 個」/「✕ 取消」
//   - 拖移 offset 樹會自動轉 gps + manuallyAdjusted=true（✋ badge 才會亮）
//   - 權限：canEdit=true 才顯示編輯按鈕（PI / admin / surveyor）

import { fb, el, toast, twd97ToWgs84, wgs84ToTwd97 } from './app.js?v=21130';
import { computePlotCorners, treeToWgs84 } from './plot-geometry.js?v=21130';

// 模組級單例（SPA 同時只有一個 plot detail 開啟）
let _map = null;
let _boundaryLayer = null;
let _treesLayer = null;
let _toolbarEl = null;
let _pendingChanges = new Map();   // treeId → { lat, lng, originalTree }
let _editMode = false;
let _ctx = null;                    // { container, plot, project, canEdit, onTreeClick, currentTrees }

// QA 狀態 → 顏色（與既有 badge 對齊）
function qaStatusColor(qaStatus) {
  switch (qaStatus) {
    case 'pass':     return '#16a34a';   // 綠
    case 'rejected': return '#dc2626';   // 紅
    case 'pending':
    default:         return '#d97706';   // 黃
  }
}

/**
 * 初始化 plot detail 地圖
 * @param {HTMLElement} options.container - 地圖容器 div
 * @param {Object} options.plot - state.plot
 * @param {Object} options.project - state.project
 * @param {boolean} options.canEdit - 是否顯示編輯模式按鈕
 * @param {Function} options.onTreeClick - marker click callback（非編輯模式時觸發）
 * @returns {{ updateTrees: (trees) => void, destroy: () => void, invalidateSize: () => void }}
 */
export function initTreeMap({ container, plot, project, canEdit = false, onTreeClick = null }) {
  if (!container) return null;
  destroyTreeMap();

  _ctx = { container, plot, project, canEdit, onTreeClick, currentTrees: [] };
  _pendingChanges = new Map();
  _editMode = false;

  // 1. Scaffolding：toolbar + map canvas
  container.innerHTML = '';
  _toolbarEl = el('div', { class: 'tree-map-toolbar mb-2 flex items-center gap-2 flex-wrap' });
  const mapDiv = el('div', { style: 'height:500px;border-radius:8px;border:1px solid #d6d3d1;background:#f5f5f4' });
  container.appendChild(_toolbarEl);
  container.appendChild(mapDiv);

  // 2. Leaflet map
  _map = L.map(mapDiv).setView([23.9176, 120.8838], 17);   // 臨時 fallback；下面會 fitBounds
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 22, maxNativeZoom: 19
  }).addTo(_map);
  _boundaryLayer = L.layerGroup().addTo(_map);
  _treesLayer = L.layerGroup().addTo(_map);

  // 3. 樣區邊界
  const corners = computePlotCorners(plot, twd97ToWgs84);
  if (corners.length >= 3) {
    const poly = L.polygon(corners, {
      color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12, dashArray: '4 3'
    });
    poly.addTo(_boundaryLayer);
    try { _map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 21 }); }
    catch (e) { console.warn('[tree-map] fitBounds boundary', e); }
  } else if (plot?.location) {
    // 沒邊界資料 → 用 plot 中心
    const lat = plot.location.latitude ?? plot.location._lat;
    const lng = plot.location.longitude ?? plot.location._long;
    if (Number.isFinite(lat) && Number.isFinite(lng)) _map.setView([lat, lng], 19);
  }

  // 4. Toolbar
  renderToolbar();

  // 5. Leaflet 在 hidden container 內 init 會抓不到尺寸；subtab 顯示後要 invalidateSize
  setTimeout(() => { try { _map?.invalidateSize(); } catch (e) {} }, 100);

  return {
    updateTrees: (trees) => {
      if (!_ctx) return;
      _ctx.currentTrees = trees;
      renderTrees();
    },
    destroy: destroyTreeMap,
    invalidateSize: () => { try { _map?.invalidateSize(); } catch (e) {} }
  };
}

function destroyTreeMap() {
  if (_map) { try { _map.remove(); } catch (e) {} _map = null; }
  _boundaryLayer = null;
  _treesLayer = null;
  _toolbarEl = null;
  _pendingChanges = new Map();
  _editMode = false;
  _ctx = null;
}

// ===== Toolbar 渲染（edit toggle + pending count + save/cancel）=====
function renderToolbar() {
  if (!_toolbarEl || !_ctx) return;
  _toolbarEl.innerHTML = '';
  const { canEdit } = _ctx;
  const pendingCount = _pendingChanges.size;

  // 圖例
  const legend = el('div', { class: 'flex items-center gap-3 text-xs text-stone-600 mr-auto' },
    el('span', { class: 'flex items-center gap-1' },
      el('span', { style: 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#16a34a' }),
      '已審核'),
    el('span', { class: 'flex items-center gap-1' },
      el('span', { style: 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#d97706' }),
      '待審核'),
    el('span', { class: 'flex items-center gap-1' },
      el('span', { style: 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#dc2626' }),
      '已退回'),
    el('span', { class: 'flex items-center gap-1' },
      el('span', { style: 'display:inline-block;width:10px;height:10px;border:2px solid #16a34a;border-radius:50%' }),
      '📐 皮尺'),
    el('span', { class: 'flex items-center gap-1' },
      el('span', { style: 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#16a34a' }),
      '📍 GPS')
  );
  _toolbarEl.appendChild(legend);

  if (!canEdit) return;     // reviewer / surveyor 沒 QA 權限：無編輯按鈕（view-only）

  if (!_editMode) {
    const editBtn = el('button', {
      type: 'button',
      class: 'bg-amber-600 hover:bg-amber-700 text-white text-sm px-3 py-1.5 rounded font-medium',
      onclick: () => enterEditMode()
    }, '✏️ 編輯位置');
    _toolbarEl.appendChild(editBtn);
  } else {
    // pending count
    const countEl = el('span', { class: 'text-sm font-medium text-amber-800' },
      `🟠 ${pendingCount} 棵待儲存`);
    const saveBtn = el('button', {
      type: 'button',
      class: 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white text-sm px-3 py-1.5 rounded font-medium',
      onclick: () => commitPendingChanges()
    }, `💾 儲存 ${pendingCount} 個變動`);
    if (pendingCount === 0) saveBtn.setAttribute('disabled', 'true');
    const cancelBtn = el('button', {
      type: 'button',
      class: 'border border-stone-300 hover:bg-stone-100 text-sm px-3 py-1.5 rounded',
      onclick: () => cancelEditMode()
    }, '✕ 取消');
    _toolbarEl.appendChild(countEl);
    _toolbarEl.appendChild(saveBtn);
    _toolbarEl.appendChild(cancelBtn);
  }
}

function enterEditMode() {
  _editMode = true;
  _pendingChanges = new Map();
  renderToolbar();
  renderTrees();
  toast('編輯模式：拖移任何立木 marker 到正確位置，完成後點「💾 儲存」', 4000);
}

function cancelEditMode() {
  if (_pendingChanges.size > 0) {
    if (!confirm(`有 ${_pendingChanges.size} 個未儲存的變動，確定要捨棄嗎？`)) return;
  }
  _editMode = false;
  _pendingChanges = new Map();
  renderToolbar();
  renderTrees();
}

async function commitPendingChanges() {
  if (!_ctx || _pendingChanges.size === 0) return;
  const { project, plot } = _ctx;
  const total = _pendingChanges.size;
  const saveBtn = _toolbarEl.querySelector('button.bg-emerald-600');
  if (saveBtn) { saveBtn.setAttribute('disabled', 'true'); saveBtn.textContent = `⏳ 儲存中 0/${total}...`; }

  let ok = 0, fail = 0;
  for (const [treeId, change] of _pendingChanges.entries()) {
    try {
      const { lat, lng, originalTree } = change;
      // 雙軌存：lat/lng GeoPoint + locationTWD97
      const t97 = wgs84ToTwd97(lng, lat);
      // 反算 local X/Y（給樣區內顯示用）
      let localX = null, localY = null;
      if (Number.isFinite(plot?.locationTWD97?.x) && Number.isFinite(plot?.locationTWD97?.y)) {
        localX = +(t97.x - plot.locationTWD97.x).toFixed(2);
        localY = +(t97.y - plot.locationTWD97.y).toFixed(2);
      }
      const updates = {
        location: new fb.GeoPoint(lat, lng),
        locationTWD97: { x: t97.x, y: t97.y },
        localX_m: localX,
        localY_m: localY,
        positionSource: 'gps',                  // 拖移後一律視為 GPS 模式
        manuallyAdjusted: true,                  // ✋ badge 才會亮
        // gpsAccuracy_m / fixedAt 保留原值（user 是「人工微調」而非「重新 GPS 量測」）
        updatedAt: fb.serverTimestamp()
      };
      const ref = fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', treeId);
      await fb.updateDoc(ref, updates);
      ok++;
    } catch (e) {
      console.error('[tree-map commit]', treeId, e);
      fail++;
    }
    if (saveBtn) saveBtn.textContent = `⏳ 儲存中 ${ok + fail}/${total}...`;
  }

  if (fail === 0) {
    toast(`✅ 已儲存 ${ok} 個位置變動`, 3000);
  } else {
    toast(`儲存完成：成功 ${ok} / 失敗 ${fail}`, 4000);
  }
  _editMode = false;
  _pendingChanges = new Map();
  renderToolbar();
  // tree onSnapshot 會自動觸發 updateTrees() 重畫
}

// ===== Marker 渲染 =====
function renderTrees() {
  if (!_treesLayer || !_ctx) return;
  _treesLayer.clearLayers();
  const { plot, canEdit } = _ctx;
  const trees = _ctx.currentTrees || [];

  trees.forEach(t => {
    const baseLL = treeToWgs84(t, plot, twd97ToWgs84);
    if (!baseLL) return;
    const pending = _pendingChanges.get(t.id);
    const [lat, lng] = pending ? [pending.lat, pending.lng] : baseLL;

    const qaColor = qaStatusColor(t.qaStatus);
    const isGps = (t.positionSource || 'offset') === 'gps';
    const accWarn = isGps && Number.isFinite(t.gpsAccuracy_m) && t.gpsAccuracy_m > 10;
    const isAdjusted = t.manuallyAdjusted === true || !!pending;

    // DivIcon：圓形，gps 實心 / offset 空心 / 精度差虛線邊 / pending 紫色外框
    const bg = isGps ? qaColor : 'transparent';
    const borderStyle = accWarn ? 'dashed' : 'solid';
    const outerRing = pending ? `box-shadow:0 0 0 3px rgba(124,58,237,0.5)` : '';
    const adjMark = (isAdjusted && !pending) ? '<div style="position:absolute;top:-6px;right:-6px;font-size:10px">✋</div>' : '';
    const iconHtml = `
      <div style="position:relative;width:16px;height:16px;border-radius:50%;background:${bg};border:2px ${borderStyle} ${qaColor};${outerRing};box-sizing:border-box">${adjMark}</div>
    `;
    const icon = L.divIcon({
      html: iconHtml,
      className: 'tree-marker',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    const marker = L.marker([lat, lng], {
      icon,
      draggable: _editMode && canEdit
    });

    // Tooltip
    const sourceLabel = isGps
      ? `📍 GPS${Number.isFinite(t.gpsAccuracy_m) ? ` ±${Math.round(t.gpsAccuracy_m)}m` : ''}`
      : '📐 皮尺 X/Y';
    const adjLabel = t.manuallyAdjusted ? ' ✋已微調' : '';
    const pendingLabel = pending ? '<br><span style="color:#7c3aed">⚠ 拖移待儲存</span>' : '';
    marker.bindTooltip(
      `<b>${t.treeCode || `#${t.treeNum}`}</b><br>${t.speciesZh || '—'} ${t.dbh_cm != null ? `(DBH ${t.dbh_cm}cm)` : ''}<br>${sourceLabel}${adjLabel}${pendingLabel}`,
      { direction: 'top', offset: [0, -8], opacity: 0.95 }
    );

    if (_editMode && canEdit) {
      marker.on('dragend', (ev) => {
        const ll = ev.target.getLatLng();
        _pendingChanges.set(t.id, {
          lat: ll.lat,
          lng: ll.lng,
          originalTree: t
        });
        renderToolbar();   // refresh pending count + save button
        // 不重 renderTrees，避免拖移過程的 marker 抖動；marker 已在新位置
        // 但要更新 tooltip 顯示「待儲存」
        const sourceLabel2 = isGps
          ? `📍 GPS${Number.isFinite(t.gpsAccuracy_m) ? ` ±${Math.round(t.gpsAccuracy_m)}m` : ''}`
          : '📐 皮尺 X/Y';
        marker.setTooltipContent(
          `<b>${t.treeCode || `#${t.treeNum}`}</b><br>${t.speciesZh || '—'}<br>${sourceLabel2}<br><span style="color:#7c3aed">⚠ 拖移待儲存</span>`
        );
        // 用 DOM 直接加紫色光圈（避免重 render）
        const iconEl = marker.getElement();
        if (iconEl) {
          const inner = iconEl.querySelector('div');
          if (inner) inner.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.5)';
        }
      });
    } else if (_ctx.onTreeClick) {
      marker.on('click', () => _ctx.onTreeClick(t));
    }

    marker.addTo(_treesLayer);
  });
}
