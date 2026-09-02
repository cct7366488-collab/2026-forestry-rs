// ===== forms.js — v1.5 表單：專案 / 樣區 / 立木 / 更新 / 方法學 / QA / Seed =====
// v2.0：加 understory（地被植物）+ soilCons（水土保持）兩模組

import { fb, $, $$, el, toast, openModal, closeModal, state, calcTreeMetrics, speciesParamsLabel, wgs84ToTwd97, twd97ToWgs84, DEFAULT_METHODOLOGY, isPi, isDataManager, isSurveyor, isReviewer, isSystemAdmin, canQA, isLocked, rerouteCurrentView, captureCurrentSubtab, qaBadge, fmtDate } from './app.js?v=21193';
// v2.7.16：樣區幾何 + 坡度修正 utility
import { computeAreaHorizontal, computeAreaHorizontal2D, computeAreaSlope, computeAreaSlope2D, nominalToSlopeDistance, dimensionsToArea } from './plot-geometry.js?v=21193';
// v2.7.17：reviewer QAQC 工作流
// v2.8.1：tree-level QAQC（抽樣 / 重測 / 誤差 / 處置）
import { DEFAULT_QAQC_CONFIG, defaultQaqc, defaultTreeQaqc, computeQaqcErrors, computeTreeQaqcErrors, computeTreeSampleSize, pickRandomTreeSample, getTreeQaqcStatus, RESOLUTION_LABEL } from './plot-qaqc.js?v=21193';
// v2.8.0：irregular plot 不規則多邊形（Shoelace / 自交檢查 / GeoJSON 解析）
import { validatePolygon, parseGeoJsonPolygon, parseProjectBoundaryGeoJson, shoelaceArea, computeBbox, vertsToArrays, arraysToVerts, VERTEX_MIN, VERTEX_MAX } from './plot-polygon.js?v=21193';
import { TYPE_CODES, AGENCY_CODES, agenciesByGroup, nextSequence, buildProjectCode } from './code-tables.js?v=21193';
// 每專案模組組合（軸 A/B）：新專案依計畫類型帶套餐預設、可勾選微調
import { MODULES, FAMILIES, defaultModulesForType, getModule } from './module-registry.js?v=21193';
// v2.0：物種字典從 species-dict.js 載入（樹種 / 動物 / 草本 / 入侵種）
import { TREES, ANIMALS, HERBS, INVASIVE_PLANTS, isInvasive, findHerb, findAnimal } from './species-dict.js?v=21193';
// v2.10.5：樹種搜尋下拉組件（取代 <datalist>，支援 Firestore 224 種 + fuzzy match）
import { createSpeciesPicker } from './species-picker.js?v=21193';
// v2.10.9：DEM 海拔自動偵測（plot GPS → 海拔 → picker band）
import { getElevation, elevationToBand, bandLabel } from './dem-elevation.js?v=21193';
// v2.11.0：AI 樹種辨識 modal（Pl@ntNet 線上 API）
import { openAiIdentifyModal } from './ai-identify-modal.js?v=21193';
// v2.3：階段 2 狀態機（自動偵測送審）
import { STATUS, applyStatusAfterQA, applyStatusAfterSurveyorReset, applyStatusAfterMethodologySaved } from './project-status.js?v=21193';
// v2.11.91：專案邊界支援 ESRI Shapefile（.zip 或 .shp/.shx/.dbf/.prj/.cpg 多檔）
import { SHAPEFILE_ACCEPT, looksLikeShapefile, shapefileFilesToGeoJson } from './shapefile-loader.js?v=21193';

// 兼容舊 SPECIES 命名（forms.js 內部仍引用）
const SPECIES = TREES;

// （v2.0：原本內聯的 ~100 種樹種陣列已移到 species-dict.js TREES，本檔透過上面的 SPECIES = TREES 別名引用）
const PEST_OPTIONS = ['葉斑', '潰瘍', '蟲孔', '空洞', '菌害', '枯梢', '無'];

// ===== v2.11.52：樣區 GeoJSON 上傳防呆 — 偵測「這檔看起來是專案邊界、不是樣區」 =====
//   觸發任一即提示（confirm 對話框）：
//     - FeatureCollection 含 > 1 個 feature
//     - MultiPolygon 含 > 1 個 polygon
//     - 總頂點數 > VERTEX_MAX(50)
//     - bbox 跨度 > 500 m（樣區通常 < 100 m；WGS84 度轉粗略 m 估算）
//   背景：5/29 user 把整個土肉桂專區作業單元（115 feature/TWD97）GeoJSON 丟到樣區表單，
//        系統只顯示「頂點數 0」（VERTEX_MAX 擋下後 toast 一行、preview box 不更新）→ user 困惑。
//        本防呆把問題講白並引導至「編輯專案 → 📐 專案邊界」上傳。
function looksLikeProjectBoundary(json) {
  const reasons = [];
  let polyCount = 0;
  const allCoords = [];

  const collectRing = (ring) => {
    if (!Array.isArray(ring)) return;
    for (const c of ring) {
      if (Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) {
        allCoords.push([Number(c[0]), Number(c[1])]);
      }
    }
  };
  const collectGeom = (g) => {
    if (!g || !g.type) return;
    if (g.type === 'Polygon') {
      polyCount += 1;
      (g.coordinates || []).forEach(collectRing);
    } else if (g.type === 'MultiPolygon') {
      polyCount += (g.coordinates || []).length;
      (g.coordinates || []).forEach(poly => (poly || []).forEach(collectRing));
    }
  };

  if (json?.type === 'FeatureCollection') {
    const feats = json.features || [];
    if (feats.length > 1) reasons.push(`FeatureCollection 含 ${feats.length} 個 feature（樣區應為單一 Polygon）`);
    feats.forEach(f => collectGeom(f?.geometry));
  } else if (json?.type === 'Feature') {
    collectGeom(json.geometry);
  } else {
    collectGeom(json);
  }

  if (polyCount > 1 && !reasons.length) reasons.push(`含 ${polyCount} 個多邊形（樣區應為單一邊界）`);
  if (allCoords.length > VERTEX_MAX) reasons.push(`總頂點數 ${allCoords.length}（樣區上限 ${VERTEX_MAX}）`);

  if (allCoords.length >= 2) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of allCoords) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // 座標系粗判：WGS84 度數（|x|<360, |y|<90）vs TWD97 公尺
    const isWgs84Deg = Math.abs(minX) < 360 && Math.abs(maxY) < 90;
    const spanXm = isWgs84Deg ? (maxX - minX) * 102000 : (maxX - minX);  // 23°N → 1° lng ≈ 102 km
    const spanYm = isWgs84Deg ? (maxY - minY) * 111000 : (maxY - minY);  //          1° lat ≈ 111 km
    const maxSpanM = Math.max(spanXm, spanYm);
    if (maxSpanM > 500) reasons.push(`邊界跨度約 ${Math.round(maxSpanM)} m（樣區通常 < 100 m）`);
  }

  return { suspect: reasons.length > 0, reasons, polyCount, vertexCount: allCoords.length };
}

// ===== v2.3.6：共用 GPS button helper =====
// plot 表單與 wildlife 表單共用，避免 drift；行為 100% 一致
// 用法：const { gpsBtn, gpsStatus, manualEntry, lngInput, latInput, accInput } = createGpsButton({...});
// v2.10.4 升級：
//   1. 失敗訊息留在 form 內（不只 toast）— gpsStatus 顯示紅字 + code 對應解法
//   2. 高精度失敗 (code 2/3) 自動 retry 一次低精度（IP 定位，timeout 30s）
//   3. 加 manualEntry collapsible UI — 桌機無 GPS / 權限被拒可手動輸入座標
//      失敗時自動展開引導 user
function createGpsButton({
  initialLat = null,        // 已存的緯度（編輯既有資料用）
  initialLng = null,        // 已存的經度
  initialAccuracy = null,   // 已存的精度（plot 表單用）
  showTwd97 = false,        // true: 顯示 TWD97 座標（plot 表單用）
  showInitialAsExisting = false, // true: 初始顯示「已存：lat, lng」（wildlife 用）
  plotForDistance = null,   // 若提供，定位後顯示與 plot 中心距離（wildlife 用）
  onLocationChange = null   // v2.11.11：成功定位時 callback({ lng, lat, accuracy }) — plot form 用來偵測 GPS 變動後自動平移已上傳的多邊形
} = {}) {
  // 三個 hidden input（lng/lat 必有，accuracy 視 showTwd97 決定）
  const lngInput = el('input', { type: 'hidden', name: 'lng', value: initialLng ?? '' });
  const latInput = el('input', { type: 'hidden', name: 'lat', value: initialLat ?? '' });
  const accInput = showTwd97
    ? el('input', { type: 'hidden', name: 'accuracy', value: initialAccuracy ?? '' })
    : null;

  // 初始狀態文字
  let initText = '尚未定位';
  if (initialLat != null && initialLng != null) {
    if (showInitialAsExisting) {
      initText = `已存：${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    } else if (showTwd97) {
      initText = `WGS84: ${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    } else {
      initText = `${Number(initialLat).toFixed(6)}, ${Number(initialLng).toFixed(6)}`;
    }
  }
  const gpsStatus = el('span', { class: 'text-xs text-stone-600 ml-2' }, initText);
  const gpsBtn = el('button', { type: 'button', class: 'gps-btn' }, '📍 抓取 GPS');

  // ===== v2.10.4：手動輸入 fallback =====
  const manualLatInput = el('input', { type: 'number', step: '0.000001', placeholder: '緯度 lat', class: 'border rounded px-2 py-1 text-sm w-32' });
  const manualLngInput = el('input', { type: 'number', step: '0.000001', placeholder: '經度 lng', class: 'border rounded px-2 py-1 text-sm w-32' });
  const applyManualBtn = el('button', { type: 'button', class: 'bg-stone-200 hover:bg-stone-300 text-stone-800 px-3 py-1 rounded text-sm font-medium' }, '套用');
  const manualHint = el('div', { class: 'text-xs text-stone-500 mt-1' },
    '小技巧：Google Maps 找位置 → 右鍵 → 點座標複製。lat 在前 lng 在後。');
  const manualEntry = el('details', { class: 'text-xs mt-1' },
    el('summary', { class: 'cursor-pointer text-blue-700 hover:text-blue-900' },
      '✏️ 或手動輸入座標（GPS 失敗 / 桌機無 GPS 用）'),
    el('div', { class: 'flex flex-wrap gap-2 items-center mt-2' },
      el('label', { class: 'text-xs' }, 'lat:'), manualLatInput,
      el('label', { class: 'text-xs' }, 'lng:'), manualLngInput,
      applyManualBtn),
    manualHint
  );
  applyManualBtn.addEventListener('click', () => {
    const lat = parseFloat(manualLatInput.value);
    const lng = parseFloat(manualLngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      gpsStatus.innerHTML = '<span class="text-red-700">❌ 緯度/經度必填且為數字</span>';
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      gpsStatus.innerHTML = '<span class="text-red-700">❌ 座標超出範圍（lat -90~90 / lng -180~180）</span>';
      return;
    }
    if (lat < 21 || lat > 26 || lng < 119 || lng > 123) {
      gpsStatus.innerHTML = '<span class="text-amber-700">⚠ 座標看起來不在台灣範圍（21-26°N / 119-123°E），仍套用</span><br>'
        + (showTwd97 ? `WGS84: ${lat.toFixed(6)}, ${lng.toFixed(6)} ｜ <span class="text-amber-700">手動輸入</span>` : `${lat.toFixed(6)}, ${lng.toFixed(6)} <span class="text-amber-700">手動輸入</span>`);
    } else {
      if (showTwd97) {
        const t = wgs84ToTwd97(lng, lat);
        gpsStatus.innerHTML = `WGS84: ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>TWD97: (${t.x}, ${t.y}) ｜ <span class="text-amber-700">手動輸入</span>`;
      } else {
        gpsStatus.innerHTML = `${lat.toFixed(6)}, ${lng.toFixed(6)} <span class="text-amber-700">手動輸入</span>`;
      }
    }
    lngInput.value = lng;
    latInput.value = lat;
    if (accInput) accInput.value = '';     // 手動沒 accuracy
    gpsBtn.textContent = '📍 重新定位';
    manualEntry.removeAttribute('open');
    // v2.11.11：通知 caller 定位變動（含手動輸入）
    if (typeof onLocationChange === 'function') {
      try { onLocationChange({ lng, lat, accuracy: null, source: 'manual' }); }
      catch (err) { console.error('[onLocationChange] manual', err); }
    }
  });

  // ===== v2.10.4：高精度失敗 → 自動降精度 retry =====
  const ERR_CODE_HINTS = {
    1: '權限被拒 — 網址列左邊 🔒/🛡 點開→把「位置」改為「允許」→重整',
    2: '無法定位 — Win11 設定→隱私權→位置 是否關閉？或無網路？',
    3: '逾時 — 網路定位太慢 / 訊號不佳'
  };

  function trySuccess(pos) {
    try {
      const { longitude, latitude, accuracy } = pos.coords;
      lngInput.value = longitude;
      latInput.value = latitude;
      if (accInput) accInput.value = accuracy;
      let extraMsg = '';
      if (plotForDistance) {
        const plotLoc = plotForDistance.location;
        const plotLat = plotLoc?.latitude ?? plotLoc?._lat ?? null;
        const plotLng = plotLoc?.longitude ?? plotLoc?._long ?? null;
        if (plotLat != null && plotLng != null) {
          const d = haversine(latitude, longitude, plotLat, plotLng);
          extraMsg = `<br>距 plot 中心 ${Math.round(d)} m${d > 100 ? ' ⚠ 超過 100 m 邊界' : ''}`;
        }
      }
      if (showTwd97) {
        const t = wgs84ToTwd97(longitude, latitude);
        gpsStatus.innerHTML = `WGS84: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}<br>TWD97: (${t.x}, ${t.y}) ｜ ±${Math.round(accuracy)}m${extraMsg}`;
      } else {
        gpsStatus.innerHTML = `${latitude.toFixed(6)}, ${longitude.toFixed(6)} ±${Math.round(accuracy)}m${extraMsg}`;
      }
      // v2.11.11：通知 caller 定位變動（geolocation 成功）
      if (typeof onLocationChange === 'function') {
        try { onLocationChange({ lng: longitude, lat: latitude, accuracy, source: 'gps' }); }
        catch (err) { console.error('[onLocationChange] gps', err); }
      }
    } catch (e) {
      console.error('[createGpsButton] success callback error', e);
      gpsStatus.innerHTML = `<span class="text-red-700">❌ GPS 處理錯誤：${e.message}</span>`;
    } finally {
      gpsBtn.disabled = false;
      gpsBtn.textContent = '📍 重新定位';
    }
  }

  function tryFail(err, isRetry) {
    console.warn('[createGpsButton] error', err.code, err.message, 'isRetry=', isRetry);
    const hint = ERR_CODE_HINTS[err.code] || (err.message || '未知錯誤');
    if (!isRetry && (err.code === 2 || err.code === 3)) {
      // 自動降精度 retry 一次
      gpsStatus.innerHTML = `<span class="text-amber-700">⚠ 高精度失敗 (code ${err.code})，自動重試低精度...</span>`;
      tryGetLocation(false, true);
      return;
    }
    gpsStatus.innerHTML = `<span class="text-red-700">❌ GPS 失敗 (code ${err.code})：${hint}</span><br><span class="text-stone-600">→ 用下方「✏️ 手動輸入座標」</span>`;
    manualEntry.setAttribute('open', '');     // 自動展開手動輸入
    gpsBtn.disabled = false;
    gpsBtn.textContent = '📍 重新定位';
  }

  function tryGetLocation(highAccuracy, isRetry) {
    gpsBtn.disabled = true;
    gpsBtn.textContent = isRetry ? '⏳ 重試低精度...' : '⏳ 定位中...';
    navigator.geolocation.getCurrentPosition(
      trySuccess,
      (err) => tryFail(err, isRetry),
      highAccuracy
        ? { enableHighAccuracy: true,  timeout: 15000, maximumAge: 0 }
        : { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
    );
  }

  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      gpsStatus.innerHTML = '<span class="text-red-700">❌ 此裝置不支援 Geolocation API</span>';
      manualEntry.setAttribute('open', '');
      return;
    }
    tryGetLocation(true, false);
  });

  return { gpsBtn, gpsStatus, manualEntry, lngInput, latInput, accInput };
}

// ===== 共用：欄位工廠 =====
function field({ label, name, type = 'text', required = false, value = '', placeholder = '', options = null, step, min, max, rows, list = null }) {
  const id = `f-${name}`;
  const lab = el('label', { for: id }, label, required ? el('span', { class: 'req' }, ' *') : null);
  let input;
  if (options) {
    input = el('select', { id, name, ...(required ? { required: 'true' } : {}) },
      ...options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const t = typeof o === 'string' ? o : o.label;
        const opt = el('option', { value: v }, t);
        if (String(v) === String(value)) opt.setAttribute('selected', 'true');
        return opt;
      })
    );
  } else if (type === 'textarea') {
    input = el('textarea', { id, name, rows: rows || 3, placeholder }, value);
  } else {
    const attrs = { id, name, type, value: value ?? '', placeholder };
    if (required) attrs.required = 'true';
    if (step != null) attrs.step = step;
    if (min != null) attrs.min = min;
    if (max != null) attrs.max = max;
    // v2.7.7：list 對應 <datalist id="..."> 的 ID，提供 autocomplete 下拉
    //         autocomplete=off 避免瀏覽器原生記憶提示遮蓋 datalist 選項
    if (list) { attrs.list = list; attrs.autocomplete = 'off'; }
    input = el('input', attrs);
  }
  return el('div', { class: 'field' }, lab, input);
}

// ===== 照片上傳元件（v1.6） =====
// 用法：const up = photoUploader({ existing: doc.photos || [], required, onChange });
//      表單中放 up.element；submit 時呼叫 await up.commit({ projectId, plotId, prefix }) 拿到新 photos 陣列
// 行為：
//   - 顯示既有照片 thumbnail（不可被 surveyor 編輯時）+ 刪除 X 按鈕
//   - 新增按鈕：accept=image/*，capture=environment（手機開後鏡頭）
//   - 新加的檔案先做本地 preview（FileReader）；submit 才真正上傳到 Storage
//   - commit() 回傳合併後的 photos 陣列：[...remainingExisting, ...newlyUploaded]
function photoUploader({ existing = [], onChange = null } = {}) {
  let kept = [...existing];          // 保留的既有照片（user 沒按刪除的）
  let pending = [];                  // 待上傳的新檔案 [{ file, previewUrl, tempId }]

  const wrap = el('div', { class: 'photo-uploader space-y-2' });
  const grid = el('div', { class: 'flex flex-wrap gap-2' });
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment',
    multiple: 'true', class: 'hidden'
  });
  const addBtn = el('button', {
    type: 'button',
    class: 'border-2 border-dashed border-stone-300 rounded w-20 h-20 flex items-center justify-center text-stone-400 hover:bg-stone-50',
    onclick: () => fileInput.click()
  }, '＋');

  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      if (!file.type.startsWith('image/')) { toast(`忽略非圖片：${file.name}`); continue; }
      if (file.size > 5 * 1024 * 1024) { toast(`檔案過大（>5MB）：${file.name}`); continue; }
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      pending.push({ file, previewUrl, tempId });
    }
    fileInput.value = '';
    redraw();
    onChange?.();
  });

  function redraw() {
    grid.innerHTML = '';
    kept.forEach((p, i) => {
      const item = el('div', { class: 'relative w-20 h-20' },
        el('img', { src: p.url, class: 'w-20 h-20 object-cover rounded border' }),
        el('button', {
          type: 'button',
          class: 'absolute -top-1 -right-1 bg-red-600 text-white text-xs w-5 h-5 rounded-full',
          title: '移除',
          onclick: () => { kept.splice(i, 1); redraw(); onChange?.(); }
        }, '✕')
      );
      grid.appendChild(item);
    });
    pending.forEach((p) => {
      const item = el('div', { class: 'relative w-20 h-20' },
        el('img', { src: p.previewUrl, class: 'w-20 h-20 object-cover rounded border opacity-70' }),
        el('span', { class: 'absolute bottom-0 left-0 right-0 text-center text-[10px] bg-amber-500 text-white' }, '待上傳'),
        el('button', {
          type: 'button',
          class: 'absolute -top-1 -right-1 bg-stone-600 text-white text-xs w-5 h-5 rounded-full',
          title: '取消',
          onclick: () => {
            URL.revokeObjectURL(p.previewUrl);
            pending = pending.filter(x => x.tempId !== p.tempId);
            redraw(); onChange?.();
          }
        }, '✕')
      );
      grid.appendChild(item);
    });
    grid.appendChild(addBtn);
  }
  redraw();

  wrap.appendChild(grid);
  wrap.appendChild(fileInput);

  return {
    element: wrap,
    get count() { return kept.length + pending.length; },
    // v2.11.3：外部加 file 進來（給 AI 辨識 modal 用 — 拍照辨識完照片自動入 tree.photos）
    addFile(file) {
      if (!file || !file.type?.startsWith('image/')) return false;
      if (file.size > 5 * 1024 * 1024) { toast(`檔案過大（>5MB）：${file.name}`); return false; }
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      pending.push({ file, previewUrl, tempId });
      redraw();
      onChange?.();
      return true;
    },
    // 上傳 + 回傳合併陣列。upload 失敗的檔案會 throw，由 caller 處理
    async commit({ projectId, plotId, prefix = 'plot' }) {
      const uploaded = [];
      for (const p of pending) {
        const ext = (p.file.name.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `projects/${projectId}/plots/${plotId}/${prefix}-${ts}-${rand}${ext}`;
        const r = fb.storageRef(fb.storage, path);
        await fb.uploadBytes(r, p.file, { contentType: p.file.type });
        const url = await fb.getDownloadURL(r);
        uploaded.push({
          url, path,
          name: p.file.name,
          size: p.file.size,
          contentType: p.file.type,
          uploadedAt: new Date(),
          uploadedBy: state.user.uid
        });
        URL.revokeObjectURL(p.previewUrl);
      }
      // 計算被移除的既有照片（既有 - 保留）→ 從 Storage 刪
      const removedExisting = existing.filter(e => !kept.some(k => k.path === e.path));
      for (const r of removedExisting) {
        if (!r.path) continue;
        try { await fb.deleteObject(fb.storageRef(fb.storage, r.path)); }
        catch (e) { console.warn('刪除舊照片失敗（可能已不存在）:', r.path, e.code); }
      }
      pending = [];
      return [...kept, ...uploaded];
    }
  };
}

// ===== v1.6.11：plot detail 頁的「📷 加照片」獨立按鈕（不必進編輯表單，現場拍立傳）=====
// 限：plot 建立者本人 OR PI/dataManager；且專案未 Lock（client 端先擋，Rules 會再驗）
// 行為：直接觸發系統相機/相簿 → 上傳 → updateDoc plot.photos → location.reload() 重繪
export async function quickAddPhoto(project, plot) {
  if (!plot || !plot.id) { toast('找不到樣區資訊'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.multiple = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);

  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    cleanup();
    if (!files.length) return;

    const valid = files.filter(f => {
      if (!f.type.startsWith('image/')) { toast(`忽略非圖片：${f.name}`); return false; }
      if (f.size > 5 * 1024 * 1024) { toast(`過大（>5MB）：${f.name}`); return false; }
      return true;
    });
    if (!valid.length) return;

    toast(`上傳中（${valid.length} 張）...`, 8000);
    try {
      const newPhotos = [];
      for (const file of valid) {
        const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `projects/${project.id}/plots/${plot.id}/plot-${ts}-${rand}${ext}`;
        const r = fb.storageRef(fb.storage, path);
        await fb.uploadBytes(r, file, { contentType: file.type });
        const url = await fb.getDownloadURL(r);
        newPhotos.push({
          url, path, name: file.name, size: file.size, contentType: file.type,
          uploadedAt: new Date(), uploadedBy: state.user.uid
        });
      }
      const merged = [...(plot.photos || []), ...newPhotos];
      const updates = { photos: merged, updatedAt: fb.serverTimestamp() };
      // 若 surveyor 補照片給自己被 flag/reject 的 plot → qaStatus 自動回 pending（一致 Bug #3 邏輯）
      if (plot.createdBy === state.user.uid && ['flagged', 'rejected'].includes(plot.qaStatus)) {
        updates.qaStatus = 'pending';
        updates.qaMarkedBy = null;
        updates.qaMarkedAt = null;
      }
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), updates);
      toast(`已新增 ${valid.length} 張照片` + (updates.qaStatus === 'pending' ? '（重新送審）' : ''));
      setTimeout(() => location.reload(), 800);  // 等 toast 顯示完再重整
    } catch (e) {
      console.error('quickAddPhoto failed:', e);
      toast('上傳失敗：' + e.message);
    }
  });

  input.click();
}

// ===== I-2（路 I 複查 / v2.11.70）：永久樣區複查期別管理 =====
// 期別物件：{ seq, label, openedAt, openedBy, closedAt|null, note|null }
//   openedAt/closedAt 一律 client Date（Firestore serverTimestamp 不可用於陣列元素內）。
//   既有 plot 無 periods → UI 合成隱含第一期，不寫回 DB（零強制 migration、向後相容）。

/** 從 plot 推導期別清單；既有 plot 無 periods → 合成隱含「第一期（原調查）」（不寫回 DB） */
export function derivePlotPeriods(plot) {
  const arr = Array.isArray(plot?.periods) ? plot.periods : [];
  if (arr.length > 0) return arr;
  return [{
    seq: 1,
    label: '第一期（原調查）',
    openedAt: plot?.createdAt || plot?.establishedAt || null,
    openedBy: plot?.createdBy || null,
    closedAt: null,
    note: null
  }];
}

/** 目前作用中的期別物件 */
export function currentPlotPeriod(plot) {
  const periods = derivePlotPeriods(plot);
  const cur = plot?.currentPeriod;
  return periods.find(p => p.seq === cur) || periods[periods.length - 1];
}

/** 開啟新一期複查（I-2 期別模型 + I-2b 重啟採集）：
 *  - append 一筆期別、把前一期標 closedAt、currentPeriod 指向新期；
 *  - 若專案目前 locked（第 N-1 期已 verified+鎖）→ 同步重啟採集：先把該期查證狀態
 *    存入 project.periodVerifications[] 期別查證簿（「曾查證」不遺失），再降回
 *    status=active / locked=false / 清 verifiedAt-By。第 N-1 期測值已凍結於
 *    measurements 子集合（I-1，delete=false）→ 重啟採集 MRV 安全。
 *  - 第二期全 verified 後既有狀態機（applyStatusAfterQA）自動再 review+lock。 */
export async function openNewPeriod(project, plot) {
  if (!plot || !plot.id) { toast('找不到樣區資訊'); return; }
  // 權限對齊 firestore.rules 後門：locked 狀態下僅 admin/pi 可改 periods/currentPeriod/updatedAt
  if (!(isPi() || isSystemAdmin())) { toast('僅 PI 或系統管理員可開啟新一期複查'); return; }
  // I-2b：已封存＝案件結束，複查不應靜默解封存
  if (project.archived === true) { toast('已封存專案不可開啟新一期，請先解封存'); return; }

  const existing = derivePlotPeriods(plot);
  const maxSeq = existing.reduce((m, p) => Math.max(m, Number(p.seq) || 0), 0);
  const nextSeq = maxSeq + 1;
  const wasLocked = project.locked === true;  // I-2b：需重啟採集

  const result = await new Promise(resolve => {
    const f = el('form', { class: 'space-y-3' },
      el('p', { class: 'text-sm font-medium' }, `為樣區「${plot.code}」開啟【第 ${nextSeq} 期複查】`),
      el('p', { class: 'text-xs text-blue-800 bg-blue-50 border border-blue-200 p-2 rounded' },
        '第 ' + nextSeq + ' 期立木調查存檔時，前一期測值已凍結於歷史測值（I-1，不可改），不會被覆蓋。'),
      wasLocked ? el('p', { class: 'text-xs text-amber-900 bg-amber-50 border border-amber-300 p-2 rounded' },
        `⚠ 本案目前已查證並鎖定（${project.status === 'verified' ? '已查證' : '審查中'}）。開啟第 ${nextSeq} 期將把專案重啟為「作業中」以進行第 ${nextSeq} 期採集；第 ${nextSeq - 1} 期之查證紀錄（查證人／時間）會存入「期別查證簿」留存，其測值已凍結不可改。`)
        : null,
      el('div', { class: 'field' },
        el('label', {}, '備註（選填）：'),
        el('input', { type: 'text', name: 'note', autocomplete: 'off', maxlength: '200',
          class: 'border rounded px-2 py-1 w-full mt-1', placeholder: '例：2027 年第一次複查回訪' })
      ),
      el('div', { class: 'flex gap-2 pt-2' },
        el('button', { type: 'submit', class: 'flex-1 bg-blue-600 text-white py-2 rounded' },
          wasLocked ? `📅 開啟第 ${nextSeq} 期並重啟採集` : `📅 開啟第 ${nextSeq} 期`),
        el('button', { type: 'button', class: 'flex-1 border py-2 rounded',
          onclick: () => { closeModal(); resolve(false); } }, '取消')
      )
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      closeModal();
      resolve({ note: (fd.get('note') || '').toString().trim() || null });
    });
    openModal('開啟新一期複查', f);
  });
  if (result === false) return;

  const now = new Date();
  const prevCurSeq = (typeof plot.currentPeriod === 'number')
    ? plot.currentPeriod
    : existing[existing.length - 1].seq;
  const periods = existing.map(p => ({
    seq: p.seq,
    label: p.label,
    openedAt: p.openedAt ?? null,
    openedBy: p.openedBy ?? null,
    closedAt: (p.seq === prevCurSeq && !p.closedAt) ? now : (p.closedAt ?? null),
    note: p.note ?? null
  }));
  periods.push({
    seq: nextSeq,
    label: `第 ${nextSeq} 期複查`,
    openedAt: now,
    openedBy: state.user.uid,
    closedAt: null,
    note: result.note
  });

  // I-2b：期別查證簿 — 記錄關閉中那期的查證狀態（每期一筆完整稽核軌跡）
  const ledgerEntry = {
    period: prevCurSeq,
    status: project.status ?? null,
    verifiedAt: project.verifiedAt ?? null,
    verifiedBy: project.verifiedBy ?? null,
    lockedBy: project.lockedBy ?? null,
    autoLockReason: project.autoLockReason ?? null,
    closedAt: now,
    closedBy: state.user.uid
  };
  const periodVerifications = [
    ...(Array.isArray(project.periodVerifications) ? project.periodVerifications : []),
    ledgerEntry
  ];

  try {
    // 1) 先寫專案：存查證簿（+ 若 locked 則重啟採集）。失敗則中止，不在仍鎖定的專案上開期。
    const projUpdates = { periodVerifications };
    if (wasLocked) {
      projUpdates.status = 'active';
      projUpdates.statusChangedAt = fb.serverTimestamp();
      projUpdates.statusChangedBy = state.user.uid;
      projUpdates.locked = false;
      projUpdates.lockedAt = null;
      projUpdates.lockedBy = null;
      projUpdates.autoLockReason = null;
      projUpdates.verifiedAt = null;
      projUpdates.verifiedBy = null;
    }
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), projUpdates);
    // sync 記憶體 project / state.project（讓解鎖即時生效、不必 reload 即可採集）
    const applyProj = (o) => {
      if (!o) return;
      o.periodVerifications = periodVerifications;
      if (wasLocked) {
        o.status = 'active'; o.locked = false; o.lockedAt = null; o.lockedBy = null;
        o.autoLockReason = null; o.verifiedAt = null; o.verifiedBy = null;
        o.statusChangedBy = state.user.uid; o.statusChangedAt = now;
      }
    };
    applyProj(project);
    if (state.project && state.project.id === project.id && state.project !== project) applyProj(state.project);

    // 2) 寫樣區期別
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), {
      periods,
      currentPeriod: nextSeq,
      updatedAt: fb.serverTimestamp()
    });
    // feedback_state_plot_stale_after_edit：state.plot 為 one-shot getDoc 無 onSnapshot → 必 refetch
    if (state.plot?.id === plot.id) {
      try {
        const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id));
        if (fresh.exists()) state.plot = { id: plot.id, ...fresh.data() };
      } catch (e) { console.warn('[I-2 refresh state.plot]', e); }
    }

    // P5b-1（I-4b）：開新期蓋印 tree.priorSnapshot — 凍結「上一期（第 prevCurSeq 期）」測值。
    //   時機：此刻 tree 文件仍持上一期最新快照（第 nextSeq 期採集尚未覆寫）＝正確凍結點。
    //   物件非陣列（避 Firestore array-of-array 限制）；冪等（再開期以新上期覆寫）；缺者 reader null-safe。
    //   失敗只 warn 不擋開期（純加性脈絡強化）。rules：tree update 主路徑欄位無關，!isLocked 下
    //   pi/admin 可寫任何欄位（openNewPeriod 已於上方先解鎖）→ priorSnapshot 寫入合法、無需改 rules。
    try {
      const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
      const stampedAt = fb.serverTimestamp();
      let batch = fb.writeBatch(fb.db);
      let inBatch = 0, total = 0;
      for (const d of treesSnap.docs) {
        const t = d.data();
        batch.update(d.ref, { priorSnapshot: {
          fromPeriod: prevCurSeq,
          dbh_cm: t?.dbh_cm ?? null,
          height_m: t?.height_m ?? null,
          vitality: t?.vitality ?? null,
          stampedAt
        }});
        inBatch++; total++;
        if (inBatch >= 450) { await batch.commit(); batch = fb.writeBatch(fb.db); inBatch = 0; }
      }
      if (inBatch > 0) await batch.commit();
      if (total) console.log(`[P5b 蓋印 priorSnapshot] ${total} 株 ← 第 ${prevCurSeq} 期`);
    } catch (e) {
      console.warn('[P5b priorSnapshot 蓋印]', e);
    }

    toast(wasLocked
      ? `已開啟第 ${nextSeq} 期並重啟採集（專案→作業中）`
      : `已開啟第 ${nextSeq} 期複查`);
    rerouteCurrentView();
  } catch (e) {
    console.error('openNewPeriod failed:', e);
    toast('開啟新一期失敗：' + e.message);
  }
}

// ===== I-2c（v2.11.82）：批次開期 + 撤銷最新一期（開期的安全網）=====

/** 蓋印 priorSnapshot（凍結 fromPeriod 期測值）到某樣區全部立木。純加性、失敗只 warn。回傳蓋印株數。
 *  （由 openNewPeriod 內聯邏輯抽出，供批次開期共用；單樣區 openNewPeriod 仍保留其內聯版以降回歸風險。） */
async function stampPriorSnapshot(project, plotId, fromPeriod) {
  try {
    const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plotId, 'trees'));
    const stampedAt = fb.serverTimestamp();
    let batch = fb.writeBatch(fb.db);
    let inBatch = 0, total = 0;
    for (const d of treesSnap.docs) {
      const t = d.data();
      batch.update(d.ref, { priorSnapshot: {
        fromPeriod, dbh_cm: t?.dbh_cm ?? null, height_m: t?.height_m ?? null, vitality: t?.vitality ?? null, stampedAt
      }});
      inBatch++; total++;
      if (inBatch >= 450) { await batch.commit(); batch = fb.writeBatch(fb.db); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    return total;
  } catch (e) { console.warn('[stampPriorSnapshot]', e); return 0; }
}

/** 檢查某樣區「指定期別」已錄立木資料筆數（measurements/{seq} 存在的株數）。
 *  0 = 該期尚無資料、可安全撤銷。撤銷為罕用動作，逐株讀取（分塊平行）成本可接受。
 *  ⚠ 這是撤銷不刪資料的安全閘：tree 文件本身無期別欄位，唯一權威來源是逐期 measurement 子文件。 */
async function countPeriodMeasurements(project, plotId, seq) {
  const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plotId, 'trees'));
  const ids = treesSnap.docs.map(d => d.id);
  let hit = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const results = await Promise.all(ids.slice(i, i + CHUNK).map(tid =>
      fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId, 'trees', tid, 'measurements', String(seq)))
        .then(s => s.exists()).catch(() => false)
    ));
    hit += results.filter(Boolean).length;
  }
  return hit;
}

/** 簡易確認對話框（promise）：resolve(true/false）。 */
function confirmDialog(title, messageNodes, confirmLabel, danger = false) {
  return new Promise(resolve => {
    const box = el('div', { class: 'space-y-3' },
      ...messageNodes,
      el('div', { class: 'flex gap-2 pt-2' },
        el('button', { type: 'button',
          class: (danger ? 'bg-red-600' : 'bg-blue-600') + ' text-white py-2 rounded flex-1',
          onclick: () => { closeModal(); resolve(true); } }, confirmLabel),
        el('button', { type: 'button', class: 'flex-1 border py-2 rounded',
          onclick: () => { closeModal(); resolve(false); } }, '取消'))
    );
    openModal(title, box);
  });
}

/** 批次：為專案「全部樣區」各開啟下一期複查（各自 currentSeq+1）。
 *  專案層解鎖 + 期別查證簿只做一次；再逐樣區 append 期別並蓋印 priorSnapshot。 */
export async function openNewPeriodAllPlots(project) {
  if (!(isPi() || isSystemAdmin())) { toast('僅 PI 或系統管理員可開啟新一期複查'); return; }
  if (project.archived === true) { toast('已封存專案不可開啟新一期，請先解封存'); return; }

  const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
  const plots = plotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (plots.length === 0) { toast('本專案尚無樣區'); return; }
  const wasLocked = project.locked === true;

  const note = await new Promise(resolve => {
    const f = el('form', { class: 'space-y-3' },
      el('p', { class: 'text-sm font-medium' }, `將為本專案全部 ${plots.length} 個樣區各開啟「下一期複查」`),
      el('p', { class: 'text-xs text-blue-800 bg-blue-50 border border-blue-200 p-2 rounded' },
        '每個樣區各自從其當期 +1；前一期測值已凍結於歷史測值（I-1，不可改），不會被覆蓋。'),
      wasLocked ? el('p', { class: 'text-xs text-amber-900 bg-amber-50 border border-amber-300 p-2 rounded' },
        '⚠ 本案目前已查證並鎖定，開啟後將重啟為「作業中」；前一期查證紀錄會存入「期別查證簿」留存。') : null,
      el('p', { class: 'text-xs text-red-800 bg-red-50 border border-red-200 p-2 rounded' },
        '⚠ 開期無法自動回復；若按錯，可用「↩️ 撤銷全部樣區最新一期」在「該期尚未錄任何資料」前收回。'),
      el('div', { class: 'field' },
        el('label', {}, '備註（選填，套用到所有樣區）：'),
        el('input', { type: 'text', name: 'note', autocomplete: 'off', maxlength: '200',
          class: 'border rounded px-2 py-1 w-full mt-1', placeholder: '例：2027 年第一次複查回訪' })),
      el('div', { class: 'flex gap-2 pt-2' },
        el('button', { type: 'submit', class: 'flex-1 bg-blue-600 text-white py-2 rounded' }, `📅 全部開新一期（${plots.length} 樣區）`),
        el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: () => { closeModal(); resolve(false); } }, '取消'))
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(f); closeModal();
      resolve((fd.get('note') || '').toString().trim() || null);
    });
    openModal('全部樣區開啟新一期複查', f);
  });
  if (note === false) return;

  const now = new Date();
  try {
    // 1) 專案層一次：若原鎖定 → 存查證簿 + 解鎖重啟採集
    if (wasLocked) {
      const ledgerEntry = {
        period: null, batchAdvance: true,  // 批次：跨樣區期別可能不一，period 記 null；batchAdvance 供撤銷辨識
        status: project.status ?? null, verifiedAt: project.verifiedAt ?? null, verifiedBy: project.verifiedBy ?? null,
        lockedBy: project.lockedBy ?? null, lockedAt: project.lockedAt ?? null, autoLockReason: project.autoLockReason ?? null,
        closedAt: now, closedBy: state.user.uid
      };
      const periodVerifications = [...(Array.isArray(project.periodVerifications) ? project.periodVerifications : []), ledgerEntry];
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), {
        periodVerifications, status: 'active', statusChangedAt: fb.serverTimestamp(), statusChangedBy: state.user.uid,
        locked: false, lockedAt: null, lockedBy: null, autoLockReason: null, verifiedAt: null, verifiedBy: null
      });
      const applyProj = (o) => { if (!o) return; o.periodVerifications = periodVerifications; o.status = 'active';
        o.locked = false; o.lockedAt = null; o.lockedBy = null; o.autoLockReason = null; o.verifiedAt = null; o.verifiedBy = null; };
      applyProj(project);
      if (state.project && state.project.id === project.id && state.project !== project) applyProj(state.project);
    }

    // 2) 逐樣區 append 期別 + 蓋印 priorSnapshot（部分失敗不中止）
    let ok = 0; const failed = [];
    for (const plot of plots) {
      try {
        const existing = derivePlotPeriods(plot);
        const maxSeq = existing.reduce((m, p) => Math.max(m, Number(p.seq) || 0), 0);
        const nextSeq = maxSeq + 1;
        const prevCurSeq = (typeof plot.currentPeriod === 'number') ? plot.currentPeriod : existing[existing.length - 1].seq;
        const periods = existing.map(p => ({ seq: p.seq, label: p.label, openedAt: p.openedAt ?? null, openedBy: p.openedBy ?? null,
          closedAt: (p.seq === prevCurSeq && !p.closedAt) ? now : (p.closedAt ?? null), note: p.note ?? null }));
        periods.push({ seq: nextSeq, label: `第 ${nextSeq} 期複查`, openedAt: now, openedBy: state.user.uid, closedAt: null, note });
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id),
          { periods, currentPeriod: nextSeq, updatedAt: fb.serverTimestamp() });
        await stampPriorSnapshot(project, plot.id, prevCurSeq);
        ok++;
      } catch (e) { console.error('[batch open]', plot.code || plot.id, e); failed.push(plot.code || plot.id); }
    }
    // 若目前正看某樣區 → refetch state.plot（feedback_state_plot_stale_after_edit）
    if (state.plot?.id) {
      try { const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', state.plot.id));
        if (fresh.exists()) state.plot = { id: state.plot.id, ...fresh.data() }; } catch {}
    }
    toast(failed.length
      ? `批次開期：${ok} 成功、${failed.length} 失敗（${failed.join('、')}）`
      : `已為全部 ${ok} 個樣區開啟新一期複查`);
    rerouteCurrentView();
  } catch (e) { console.error('openNewPeriodAllPlots failed:', e); toast('批次開期失敗：' + e.message); }
}

/** 撤銷某樣區「最新一期」複查：僅在該期尚無立木資料時放行。
 *  只還原樣區期別，不動專案鎖定（批次撤銷才處理專案層還原，避免多樣區時誤鎖）。 */
export async function undoLatestPeriod(project, plot) {
  if (!(isPi() || isSystemAdmin())) { toast('僅 PI 或系統管理員可撤銷複查期別'); return; }
  if (!Array.isArray(plot.periods) || plot.periods.length < 2) { toast('此樣區尚未開啟複查期，無可撤銷'); return; }
  const maxSeq = plot.periods.reduce((m, p) => Math.max(m, Number(p.seq) || 0), 0);
  if (maxSeq < 2) { toast('第一期為原始調查，不可撤銷'); return; }

  toast(`檢查第 ${maxSeq} 期是否已有資料…`);
  const dataCount = await countPeriodMeasurements(project, plot.id, maxSeq);
  if (dataCount > 0) { toast(`第 ${maxSeq} 期已有 ${dataCount} 筆立木資料，不能撤銷（避免刪除已錄資料）`); return; }

  const newCur = maxSeq - 1;
  const projActive = project.locked === false && project.status === 'active';
  const confirmed = await confirmDialog('撤銷最新一期複查', [
    el('p', { class: 'text-sm font-medium' }, `樣區「${plot.code}」：撤銷【第 ${maxSeq} 期】，回到第 ${newCur} 期？`),
    el('p', { class: 'text-xs text-stone-600' }, `已確認第 ${maxSeq} 期尚無立木資料（0 筆），可安全撤銷。`),
    projActive ? el('p', { class: 'text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded' },
      '註：專案目前為「作業中」。單樣區撤銷不會回復專案鎖定；如整輪開錯要連鎖定一起復原，請用「撤銷全部樣區最新一期」。') : null
  ], `↩️ 撤銷第 ${maxSeq} 期`, true);
  if (!confirmed) return;

  const newPeriods = plot.periods.filter(p => Number(p.seq) !== maxSeq)
    .map(p => (Number(p.seq) === newCur ? { ...p, closedAt: null } : p));
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id),
      { periods: newPeriods, currentPeriod: newCur, updatedAt: fb.serverTimestamp() });
    if (state.plot?.id === plot.id) {
      try { const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id));
        if (fresh.exists()) state.plot = { id: plot.id, ...fresh.data() }; } catch {}
    }
    toast(`已撤銷第 ${maxSeq} 期，回到第 ${newCur} 期`);
    rerouteCurrentView();
  } catch (e) { console.error('undoLatestPeriod failed:', e); toast('撤銷失敗：' + e.message); }
}

/** 批次：撤銷「全部樣區最新一期」。all-or-nothing 資料安全檢查；並還原專案鎖定（pop 批次查證簿）。 */
export async function undoLatestPeriodAllPlots(project) {
  if (!(isPi() || isSystemAdmin())) { toast('僅 PI 或系統管理員可撤銷複查期別'); return; }
  const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
  const plots = plotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // 只考慮「已實體開過複查期」的樣區（periods 陣列且 currentPeriod≥2）
  const targets = plots.filter(p => Array.isArray(p.periods) && p.periods.length >= 2 && Number(p.currentPeriod) >= 2);
  if (targets.length === 0) { toast('沒有可撤銷的複查期（各樣區皆在第一期）'); return; }

  // all-or-nothing 資料安全檢查：任一樣區最新期已有資料 → 整批取消
  toast(`檢查 ${targets.length} 個樣區的最新期是否已有資料…`);
  const blocked = [];
  for (const p of targets) {
    const seq = Number(p.currentPeriod);
    const c = await countPeriodMeasurements(project, p.id, seq);
    if (c > 0) blocked.push(`${p.code}（第${seq}期 ${c}筆）`);
  }
  if (blocked.length) { toast(`下列樣區最新期已有資料，整批撤銷已取消：${blocked.join('、')}`); return; }

  const ledger = Array.isArray(project.periodVerifications) ? [...project.periodVerifications] : [];
  const last = ledger[ledger.length - 1];
  const willRelock = !!(last && last.batchAdvance === true && project.locked === false);
  const confirmed = await confirmDialog('撤銷全部樣區最新一期', [
    el('p', { class: 'text-sm font-medium' }, `將撤銷 ${targets.length} 個樣區的最新一期複查（各自回到前一期）？`),
    el('p', { class: 'text-xs text-stone-600' }, '已確認這些樣區的最新期皆尚無立木資料（0 筆），可安全撤銷。'),
    willRelock ? el('p', { class: 'text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded' },
      '註：偵測到上一步是「整批開期並解鎖」，撤銷後會把專案回復為原本的「已查證／鎖定」狀態。') : null
  ], `↩️ 撤銷 ${targets.length} 個樣區`, true);
  if (!confirmed) return;

  try {
    // 1) 逐樣區還原（部分失敗不中止）
    let ok = 0; const failed = [];
    for (const p of targets) {
      try {
        const seq = Number(p.currentPeriod); const newCur = seq - 1;
        const newPeriods = p.periods.filter(x => Number(x.seq) !== seq)
          .map(x => (Number(x.seq) === newCur ? { ...x, closedAt: null } : x));
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', p.id),
          { periods: newPeriods, currentPeriod: newCur, updatedAt: fb.serverTimestamp() });
        ok++;
      } catch (e) { console.error('[batch undo]', p.code || p.id, e); failed.push(p.code || p.id); }
    }
    // 2) 專案層還原鎖定（僅當上一步為批次開期解鎖）
    let relocked = false;
    if (willRelock && failed.length === 0) {
      ledger.pop();
      const projUpdates = {
        periodVerifications: ledger, status: last.status ?? 'verified', locked: true,
        lockedAt: last.lockedAt ?? fb.serverTimestamp(), lockedBy: last.lockedBy ?? null,
        autoLockReason: last.autoLockReason ?? null, verifiedAt: last.verifiedAt ?? null, verifiedBy: last.verifiedBy ?? null,
        statusChangedAt: fb.serverTimestamp(), statusChangedBy: state.user.uid
      };
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), projUpdates);
      const applyProj = (o) => { if (!o) return; o.periodVerifications = ledger; o.status = projUpdates.status;
        o.locked = true; o.lockedBy = projUpdates.lockedBy; o.autoLockReason = projUpdates.autoLockReason;
        o.verifiedAt = projUpdates.verifiedAt; o.verifiedBy = projUpdates.verifiedBy; };
      applyProj(project);
      if (state.project && state.project.id === project.id && state.project !== project) applyProj(state.project);
      relocked = true;
    }
    if (state.plot?.id) {
      try { const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', state.plot.id));
        if (fresh.exists()) state.plot = { id: state.plot.id, ...fresh.data() }; } catch {}
    }
    toast((failed.length
      ? `批次撤銷：${ok} 成功、${failed.length} 失敗（${failed.join('、')}）`
      : `已撤銷全部 ${ok} 個樣區最新一期`) + (relocked ? '；專案已回復鎖定（已查證）' : ''));
    rerouteCurrentView();
  } catch (e) { console.error('undoLatestPeriodAllPlots failed:', e); toast('批次撤銷失敗：' + e.message); }
}

// ===== I-1（v2.11.70）：立木逐期歷史測值保留（永久樣區複查地基）=====
// 架構（reader-safe 完整版 A）：tree 文件維持「最新一期快照」（所有既有 reader 零遷移）；
//   每次存檔同時 write-through 一筆 `trees/{treeId}/measurements/{periodId}` 逐期歷史。
//   → 第二期立木調查覆蓋 tree 快照前，前一期已先被保留為 measurement doc（前提：backfill
//     已為既有立木補建 period-1 measurement；backfill 由 scripts/backfill-i1-measurements.mjs
//     一次性離線執行，owner token 繞 rules 可處理 locked 專案）。
// measurement doc = 該期測值/位置/即算碳量快照 + 去正規化身分（treeCode 為跨期 join key），
//   讓未來 ΔC（I-6 / AR-TMS）以 collectionGroup 直接查、且不需重算（存當期 equation 結果）。

/** 純函式：由 tree 資料組出單期 measurement 快照（forms / import / backfill 共用單一真相）。
 *  不含 recordedAt（caller 自行附 serverTimestamp 或 Date，保持本函式純粹）。 */
export function buildMeasurementSnapshot(t, { periodId, recordedBy, source }) {
  return {
    periodId: Number(periodId) || 1,
    // 身分（去正規化 — 跨期 collectionGroup 查詢 / 單檔可讀；treeCode 為 join key）
    treeCode: t?.treeCode ?? null,
    treeNum: t?.treeNum ?? null,
    speciesZh: t?.speciesZh ?? null,
    speciesSci: t?.speciesSci ?? null,
    // 每期測值
    dbh_cm: t?.dbh_cm ?? null,
    height_m: t?.height_m ?? null,
    branchHeight_m: t?.branchHeight_m ?? null,
    vitality: t?.vitality ?? null,
    pestSymptoms: Array.isArray(t?.pestSymptoms) ? t.pestSymptoms : [],
    marking: t?.marking ?? null,
    notes: t?.notes ?? null,
    // 位置（GPS 模式為每期；快照供完整重建）
    localX_m: t?.localX_m ?? null,
    localY_m: t?.localY_m ?? null,
    locationTWD97: t?.locationTWD97 ?? null,
    location: t?.location ?? null,
    positionSource: t?.positionSource ?? null,
    gpsAccuracy_m: t?.gpsAccuracy_m ?? null,
    manuallyAdjusted: t?.manuallyAdjusted ?? false,
    // 即算碳量（存當期 equation 結果 → ΔC 不需重算、且不受日後係數變更影響）
    basalArea_m2: t?.basalArea_m2 ?? null,
    volume_m3: t?.volume_m3 ?? null,
    biomass_kg: t?.biomass_kg ?? null,
    carbon_kg: t?.carbon_kg ?? null,
    co2_kg: t?.co2_kg ?? null,
    // I-5：本期狀態 fate + recruitment 期別（逐期歷史，供 I-6 ΔC / 死亡率 / recruitment 報表）
    resurveyFate: t?.resurveyFate ?? 'alive',
    recruitedPeriod: t?.recruitedPeriod ?? null,
    // meta
    source: source || 'tree-form',
    recordedBy: recordedBy ?? null,
    createdBy: recordedBy ?? null   // rules willOwn() on measurement create
  };
}

/** 存檔同時 write-through 當期 measurement（doc id = periodId；同期覆寫＝修正當期、新期＝歷史）。
 *  失敗只 warn 不阻斷主存檔（純加性 plumbing，絕不可回歸既有 UX）。 */
export async function writeTreeMeasurementSnapshot(project, plot, treeId, treeData, source = 'tree-form') {
  try {
    const period = currentPlotPeriod(plot);
    const periodId = Number(period?.seq) || 1;
    const snap = {
      ...buildMeasurementSnapshot(treeData, { periodId, recordedBy: state.user.uid, source }),
      recordedAt: fb.serverTimestamp()
    };
    await fb.setDoc(
      fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', treeId, 'measurements', String(periodId)),
      snap
    );
  } catch (e) {
    console.warn('[I-1 measurement write-through]', e);
  }
}

/** P5b-2（I-4b）：列印複查野外清單 — 永久樣區複查黃金實務：印上期清單帶現場逐棵核對身分與合理性。
 *  資料源優先 tree.priorSnapshot（開新期已蓋印，fromPeriod===上一期；零額外查詢）；
 *  缺者 fallback 平行讀 measurements/{prevSeq}（一次性列印可接受；無 backfill 的舊樣區會留空＝確實無上期資料）。
 *  欄位：樹牌號 / 樹種 / 上期DBH / 上期H / 上期活力 / 上期位置 ＋ 本期DBH＿本期H＿狀態（留空手填）。
 *  沿用 harvest-permits.printPermit 模板手法（window.open + document.write）；A4、斷網可印、無全形空格。 */
export async function printResurveyFieldList(project, plot) {
  if (!(isPi() || isSurveyor() || isSystemAdmin())) { toast('僅 PI / 調查員 / 系統管理員可列印複查野外清單'); return; }
  if (!plot || !plot.id) { toast('找不到樣區資訊'); return; }
  const cur = currentPlotPeriod(plot);
  const curSeq = Number(cur?.seq) || 1;
  if (curSeq < 2) { toast('目前為第一期（原調查），尚無上一期可供複查列印'); return; }
  const prevSeq = curSeq - 1;

  let trees;
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
    trees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('[P5b 列印] 讀立木失敗', e); toast('讀取立木失敗：' + e.message); return; }
  if (!trees.length) { toast('本樣區尚無立木'); return; }

  // 上期測值來源優先序：
  //   1) priorSnapshot（fromPeriod===prevSeq）— 開新期凍結，最權威（v2.11.71+ 開的期）
  //   2) measurements/{prevSeq} — 逐期歷史（I-1 寫穿 / backfill 回填）
  //   3) 活立木快照回退 — 既有樣區未蓋印且未回填時，tree 文件仍持「上一期最新快照」
  //      （第 curSeq 期採集尚未覆寫才成立）→ 補此回退，讓上期 DBH/H/活力比照位置欄顯示，
  //      不再因缺凍結歷史而整欄空白（既有樣區常態）。標 _live 供清單透明註記來源。
  //      防呆：若該株本期已重測（measurements/{curSeq} 存在），live 值已是本期、不可當上期 → 留空。
  const hasPrior = (t) => t.priorSnapshot && Number(t.priorSnapshot.fromPeriod) === prevSeq;
  const fallbackMap = new Map();        // tid -> 第 prevSeq 期 measurement
  const measuredThisPeriod = new Set(); // tid 本期（curSeq）已重測 → 禁用 live 回退
  const needFallback = trees.filter(t => !hasPrior(t));
  if (needFallback.length) {
    await Promise.all(needFallback.map(async t => {
      const base = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', t.id, 'measurements');
      try {
        const [mp, mc] = await Promise.all([
          fb.getDoc(fb.doc(base, String(prevSeq))),
          fb.getDoc(fb.doc(base, String(curSeq)))
        ]);
        if (mp.exists()) fallbackMap.set(t.id, mp.data());
        if (mc.exists()) measuredThisPeriod.add(t.id);
      } catch { /* 留空＝無上期資料 */ }
    }));
  }
  const priorOf = (t) => {
    if (hasPrior(t)) return t.priorSnapshot;
    if (fallbackMap.has(t.id)) return fallbackMap.get(t.id);
    if (!measuredThisPeriod.has(t.id) &&
        (t.dbh_cm != null || t.height_m != null || t.vitality != null)) {
      return { dbh_cm: t.dbh_cm ?? null, height_m: t.height_m ?? null, vitality: t.vitality ?? null, _live: true };
    }
    return null;
  };

  const sortKey = (t) => {
    if (t.treeNum != null && !isNaN(Number(t.treeNum))) return Number(t.treeNum);
    const m = String(t.treeCode || '').match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  };
  trees.sort((a, b) => sortKey(a) - sortKey(b));

  const esc = s => String(s ?? '—').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const numf = (v, d = 1) => (v == null || v === '' || isNaN(Number(v))) ? '—' : Number(v).toFixed(d);
  const posOf = (t) => {
    const x = t.localX_m, y = t.localY_m;  // 位置為定位輔助，取 live tree（priorSnapshot 不存位置）
    return (x == null || y == null || x === '' || y === '') ? '—' : `(${numf(x)}, ${numf(y)})`;
  };

  let anyLive = false;  // 是否有列以活立木快照回退（決定是否顯示 * 註腳）
  const rowsHtml = trees.map(t => {
    const p = priorOf(t);
    if (p?._live) anyLive = true;
    const mk = p?._live ? '<sup style="color:#b45309">*</sup>' : '';
    const tag = esc(t.treeCode || t.treeNum);
    const sp = esc(t.speciesZh || t.speciesSci);
    const cell = (v, align) => `<td style="text-align:${align}">${numf(v) === '—' ? '—' : numf(v) + mk}</td>`;
    return `<tr><td>${tag}</td><td>${sp}</td>`
      + cell(p?.dbh_cm, 'right')
      + cell(p?.height_m, 'right')
      + `<td style="text-align:center">${p?.vitality != null && p?.vitality !== '' ? esc(p.vitality) + mk : '—'}</td>`
      + `<td>${posOf(t)}</td>`
      + `<td class="blank"></td><td class="blank"></td><td class="blank"></td></tr>`;
  }).join('');

  const roc = new Date().getFullYear() - 1911;
  const today = new Date().toLocaleDateString('zh-Hant', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>樣區複查野外調查清單 ${esc(plot.code)}</title>
<style>@page{size:A4 portrait;margin:14mm}
body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;margin:0;color:#222;font-size:12px}
h1{text-align:center;font-size:18px;margin:0 0 4px}.sub{text-align:center;color:#555;margin-bottom:12px;font-size:12px}
.meta{border:1px solid #888;padding:8px 12px;margin-bottom:10px;font-size:12px;line-height:1.6}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 6px;font-size:12px}
th{background:#eee}.blank{min-width:48px}
thead{display:table-header-group}tr{page-break-inside:avoid}
.tip{font-size:11px;color:#666;margin-top:8px}
.noprint{background:#f3f4f6;border:1px solid #ccc;border-radius:6px;padding:8px;margin-bottom:14px;display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.noprint .hint{flex:1;font-size:12px;color:#666;min-width:140px}
.noprint button{border:0;padding:9px 16px;border-radius:6px;font-size:15px;color:#fff;cursor:pointer}
@media print{.noprint{display:none!important}}</style>
</head><body>
<div class="noprint">
<span class="hint">列印或存成 PDF 後，點「關閉並返回」回到系統。</span>
<button style="background:#15803d" onclick="window.print()">🖨️ 列印 / 存 PDF</button>
<button style="background:#555" onclick="window.close()">✕ 關閉並返回</button>
</div>
<h1>樣區複查野外調查清單</h1>
<div class="sub">${esc(project.name)}　中華民國 ${roc} 年</div>
<div class="meta">
<div><b>樣區：</b>${esc(plot.code)}　<b>複查期別：</b>第 ${prevSeq} 期 → 第 ${curSeq} 期　<b>立木數：</b>${trees.length} 株</div>
<div><b>列印日：</b>${esc(today)}　<b>調查員簽名：</b>________________</div>
</div>
<table>
<thead><tr>
<th>樹牌號</th><th>樹種</th><th>上期<br>DBH(cm)</th><th>上期<br>H(m)</th><th>上期<br>活力</th><th>上期位置<br>(x,y)m</th>
<th>本期<br>DBH(cm)</th><th>本期<br>H(m)</th><th>狀態<br>(存/枯/失)</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<div class="tip">說明：逐棵核對樹牌號與樹種身分，量測本期 DBH/H 填於空欄；狀態欄記「存活／枯死／失蹤／失牌」。「—」表示系統無上期測值（如該株本期已重測或無任何紀錄）。${anyLive ? '<br>標 <sup style="color:#b45309">*</sup> 之上期值取自立木最新紀錄（即本期重測前數值），非凍結歷史；待本期重測存檔後，系統將以逐期凍結歷史為準。' : ''}</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器封鎖彈出視窗，請允許後重試'); return; }
  w.document.write(html);
  w.document.close();
}

// ===== v1.6.19：封存 / 解封存 — 真實案件結束後使用，資料保留只是從作用中清單移除 =====
export async function archiveProject(project) {
  if (!confirm(
    `封存專案「${project.name}」（${project.code}）？\n\n` +
    `✓ 所有資料保留在 Firebase 雲端（不會刪除）\n` +
    `✓ 自動 Lock，沒人能再寫入\n` +
    `✓ 從預設「我的專案」清單移除（仍可從「顯示已封存」查看）\n\n` +
    `適用：案件結束、研究結案。仍可隨時解封存還原。`
  )) return;
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), {
      archived: true,
      locked: true,
      lockedAt: fb.serverTimestamp(),
      lockedBy: state.user.uid,
      archivedAt: fb.serverTimestamp(),
      archivedBy: state.user.uid
    });
    toast(`已封存「${project.name}」`);
  } catch (e) { toast('封存失敗：' + e.message); }
}

export async function unarchiveProject(project) {
  if (!confirm(
    `解封存「${project.name}」？\n\n` +
    `✓ 還原為作用中專案\n` +
    `✓ 自動 Unlock（PI 可重新編輯）\n\n` +
    `若要繼續封存狀態（資料不可改），請手動 Lock。`
  )) return;
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), {
      archived: false,
      locked: false,
      lockedAt: null,
      lockedBy: null
    });
    toast(`已解封存「${project.name}」`);
  } catch (e) { toast('解封存失敗：' + e.message); }
}

// ===== v1.6.19：admin 永久刪除（級聯刪除所有 plots / trees / regen + Storage 照片）=====
// 安全閘門（依序）：
//   (1) 必須先「封存」此專案（archived=true）才允許永久刪除 — 強制至少二步驟思考
//   (2) 客製 modal 必須勾選「我已匯出資料備份」 — 提醒先匯出 XLSX/CSV
//   (3) 必須輸入專案代碼確認 — 防誤刪
// v2.7.3：archived 專案因 archiveProject 自動 lock — 級聯刪除前先 force-unlock
//   即使現行 Firestore Rules 子集合 delete 路徑沒擋 isLocked，仍做 defense-in-depth：
//   ① 防 Rules 之後收緊；② 避免任何牽涉 plot.update 的 cascade 路徑被擋；③ UX 一致避免使用者卡關
// Storage Rules `allow delete`（v1.6.0 已加）；Firestore Rules `allow delete: if isSystemAdmin()`
export async function deleteProjectCascade(project) {
  if (!project.archived) {
    toast('請先「封存」此專案，封存後才能永久刪除');
    return;
  }

  // v2.7.3：偵測 lock 狀態 — 用於 modal 提示與級聯前的 force-unlock
  const wasLocked = project.locked === true;

  // 客製確認 modal（取代 prompt + confirm）
  const confirmed = await new Promise(resolve => {
    const f = el('form', { class: 'space-y-3' },
      el('p', { class: 'text-sm font-medium' }, `永久刪除「${project.name}」（${project.code}）`),
      el('p', { class: 'text-sm text-red-700 bg-red-50 p-2 rounded' },
        '⚠️ 將連同所有樣區、立木、自然更新、上傳照片一併刪除，**無法復原**。'),
      // v2.7.3：lock 狀態提示（archived 專案總是 locked=true）
      wasLocked ? el('p', { class: 'text-xs text-stone-700 bg-stone-100 border border-stone-300 p-2 rounded' },
        '🔓 本專案目前 Lock 中（封存自動鎖定）— 確認後會先自動解鎖再執行級聯刪除，無需手動 Unlock。') : null,
      el('label', { class: 'flex items-start gap-2 text-sm' },
        el('input', { type: 'checkbox', name: 'exported', required: 'true', class: 'mt-1' }),
        el('span', {}, '我已從「匯出」分頁下載此專案的資料備份（XLSX / CSV）')
      ),
      el('div', { class: 'field' },
        el('label', {}, `輸入專案代碼 `, el('code', { class: 'bg-stone-100 px-1' }, project.code), ` 確認：`),
        el('input', { type: 'text', name: 'code', required: 'true', autocomplete: 'off',
          class: 'border rounded px-2 py-1 w-full mt-1' })
      ),
      el('div', { class: 'flex gap-2 pt-2' },
        el('button', { type: 'submit', class: 'flex-1 bg-red-600 text-white py-2 rounded' }, '永久刪除'),
        el('button', { type: 'button', class: 'flex-1 border py-2 rounded',
          onclick: () => { closeModal(); resolve(false); } }, '取消')
      )
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      if (fd.get('code').trim() !== project.code) {
        toast('代碼不符');
        return;
      }
      closeModal();
      resolve(true);
    });
    openModal('永久刪除專案', f);
  });
  if (!confirmed) return;

  toast('刪除中...', 30000);
  try {
    const projectId = project.id;
    // v2.7.3：級聯前 force-unlock（archived 專案總是 locked，先解鎖避免任何潛在 isLocked 檢查擋住）
    //   project doc update 路徑本身不受 isLocked 限制（Rules: allow update: isPi || admin），可直接寫
    if (wasLocked) {
      await fb.updateDoc(fb.doc(fb.db, 'projects', projectId), {
        locked: false,
        lockedBy: null,
        lockedAt: null
      });
    }
    // (1) 列出所有 plots
    const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots'));
    let plotCount = 0, treeCount = 0, regenCount = 0, photoCount = 0;

    for (const plotDoc of plotsSnap.docs) {
      const plotId = plotDoc.id;

      // (a) 刪 trees（含 photos）
      const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots', plotId, 'trees'));
      for (const td of treesSnap.docs) {
        await fb.deleteDoc(td.ref);
        treeCount++;
      }

      // (b) 刪 regeneration
      const regenSnap = await fb.getDocs(fb.collection(fb.db, 'projects', projectId, 'plots', plotId, 'regeneration'));
      for (const rd of regenSnap.docs) {
        await fb.deleteDoc(rd.ref);
        regenCount++;
      }

      // (c) 刪 plot 與其下所有 Storage 照片（用 listAll 抓 prefix 一網打盡 plot + tree 照片）
      try {
        const list = await fb.listAll(fb.storageRef(fb.storage, `projects/${projectId}/plots/${plotId}`));
        for (const item of list.items) {
          try { await fb.deleteObject(item); photoCount++; }
          catch (e) { console.warn('刪照片失敗', item.fullPath, e.code); }
        }
      } catch (e) { console.warn('listAll 失敗', e); }

      // (d) 刪 plot doc
      await fb.deleteDoc(plotDoc.ref);
      plotCount++;
    }

    // (2) 刪 project doc
    await fb.deleteDoc(fb.doc(fb.db, 'projects', projectId));

    toast(`已刪除：${plotCount} 樣區 / ${treeCount} 立木 / ${regenCount} 更新 / ${photoCount} 照片`, 5000);
    setTimeout(() => { location.hash = ''; location.reload(); }, 1500);
  } catch (e) {
    console.error('deleteProjectCascade failed:', e);
    toast('刪除失敗：' + e.message);
  }
}

// ===== 專案表單 =====
// v1.5：admin 建空殼 + 指派 PI 的 email；自動填 memberUids、預設 methodology
// ===== v2.11.19/54：專案邊界 GeoJSON 上傳 section =====
// 三狀態：未動 / 上傳新檔（draft={geojson, srcSystem, ...}）/ 清除（draft='CLEAR'）
// v2.11.54：新建模式也顯示（先前只給編輯模式）；加「📥 載入預設邊界」下拉（土肉桂專區一鍵）。
// onChange(draft) → caller form 暫存到 boundaryDraft，submit 時寫入 Firestore
//
// v2.11.54：預設邊界清單（從 pwa/data/presets/ 靜態檔載入，避免 admin 開新案時再去找檔案位置）
//   ⚠ PII 風險已知：合併檔含承租人姓名與契約書號；放 Hosting 靜態檔意味著有 URL 的人都可下載。
//   現階段判定：合作社契約屬半公開資料（林業署有開放類似 dataset），demo 風險可接受。
//   若 6/6 後要轉嚴格路 → 改放 Firestore boundaryPresets/{id} + rules 鎖 admin 才能讀。
// 專案邊界寫在 project 文件的 boundaryGeoJsonStr 欄位 → 受 Firestore 單一文件 1 MiB 限制
const BOUNDARY_MAX_BYTES = 1024 * 1024;

const BOUNDARY_PRESETS = [
  {
    id: 'cinnamon-zones',
    label: '土肉桂專區（橫流溪 + 烏石坑，合作社契約）',
    file: './data/presets/cinnamon-zones-merged.geojson',
    description: '115 個作業單元（45 橫流溪 + 70 烏石坑）／ TWD97 TM2 ／ 141.7 KB',
  },
];

function buildBoundarySection({ existingBoundary, onChange }) {
  const wrap = el('div', { class: 'border border-stone-200 rounded p-2 space-y-2 bg-stone-50' });
  wrap.appendChild(el('div', { class: 'text-sm font-medium' }, '📐 專案邊界（GeoJSON / Shapefile，選填）'));
  wrap.appendChild(el('div', { class: 'text-xs text-stone-600' },
    '上傳後地圖分頁會疊加邊界圖層，並自動 zoom 到邊界範圍。支援 Polygon / MultiPolygon、自動偵測 WGS84 / TWD97（EPSG:3826）座標系。'));
  // v2.11.91：Shapefile 是多檔格式，講清楚怎麼給檔，免得使用者只丟一個 .shp 才發現屬性空的
  wrap.appendChild(el('div', { class: 'text-xs text-stone-500' },
    'Shapefile 請上傳 .zip，或一次多選 .shp／.shx／.dbf／.prj（Ctrl 或 Shift 複選）。屬性中文為 Big5 時會自動偵測。'));

  // 狀態顯示區
  const statusBox = el('div', { class: 'text-xs' });
  function renderStatus(text, cls = 'text-stone-500') {
    statusBox.innerHTML = '';
    statusBox.className = `text-xs ${cls}`;
    statusBox.textContent = text;
  }
  // v2.11.91：Shapefile 解析過程的提醒（自動偵測編碼、缺 .prj、混合幾何…）另起一區，
  //   不跟主狀態列擠同一行——這些是「有做事但要讓你知道」的訊息，不是錯誤。
  const noteBox = el('div', { class: 'text-xs text-amber-700 space-y-0.5' });
  function renderNotes(notes) {
    noteBox.innerHTML = '';
    for (const n of notes || []) noteBox.appendChild(el('div', {}, `・${n}`));
  }

  if (existingBoundary) {
    const meta = existingBoundary.type === 'MultiPolygon'
      ? `MultiPolygon × ${existingBoundary.coordinates.length}`
      : 'Polygon';
    renderStatus(`✓ 已上傳：${meta}（重新上傳會覆蓋）`, 'text-green-700');
  } else {
    renderStatus('（尚未上傳）', 'text-stone-500');
  }
  wrap.appendChild(statusBox);
  wrap.appendChild(noteBox);

  // v2.11.54：抽 helper — file/preset 共用 parse + status + onChange 流程
  // v2.11.91：再抽一層 processGeojsonObject，讓 Shapefile 轉出的 GeoJSON 物件走同一條路
  //   （解析 → 大小檢查 → 狀態列 → onChange），GeoJSON 與 Shapefile 兩種來源行為一致。
  async function processGeojsonObject(json, displayName, notes = []) {
    renderStatus('⏳ 解析中...', 'text-blue-600');
    try {
      const result = parseProjectBoundaryGeoJson(json, twd97ToWgs84);
      // v2.11.91：大小改量「實際要寫進 Firestore 的字串 UTF-8 位元組」。
      //   舊版量上傳原始檔的 JS 字元數，有兩個問題：(a) 中文屬性 UTF-8 佔 3 bytes → 低估、
      //   (b) 縮排排版的 GeoJSON 會高估；而 Shapefile 根本沒有「原始文字大小」可量。
      //   量輸出才是真正對上 Firestore 單一文件 1 MiB 限制的那個數字。
      const bytes = new TextEncoder().encode(JSON.stringify(result.geojson)).length;
      if (bytes > BOUNDARY_MAX_BYTES) {
        renderStatus(
          `✗ 轉出的邊界資料 ${(bytes / 1024 / 1024).toFixed(2)} MB，超過 Firestore 單一文件 1 MB 上限`
          + ' — 請先在 GIS 軟體簡化節點（QGIS「向量 → 幾何工具 → 簡化」）或只保留需要的圖徵後再上傳',
          'text-red-700');
        renderNotes(notes);
        onChange(null);
        return;
      }
      result.fileName = displayName;
      const sizeKb = (bytes / 1024).toFixed(1);
      renderStatus(`✓ ${displayName}（${result.srcSystem}, ${result.polygonCount} 多邊形 / ${result.ringCount} 環 / ${result.vertexCount} 頂點 / ${sizeKb} KB）— 儲存後生效`, 'text-green-700');
      renderNotes(notes);
      onChange(result);
    } catch (e) {
      console.error('[boundary GeoJSON]', e);
      renderStatus(`✗ 解析失敗：${e.message}`, 'text-red-700');
      renderNotes(notes);
      onChange(null);
    }
  }

  async function processGeojsonText(text, displayName) {
    // 純保護瀏覽器不被超大檔 JSON.parse 卡死；真正的 1 MB 判斷在 processGeojsonObject（量輸出）
    if (text.length > 16 * 1024 * 1024) {
      renderStatus(`✗ 檔案過大（${(text.length / 1024 / 1024).toFixed(1)} MB），無法解析`, 'text-red-700');
      onChange(null);
      return;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error('[boundary GeoJSON]', e);
      renderStatus(`✗ 不是有效的 JSON：${e.message}`, 'text-red-700');
      onChange(null);
      return;
    }
    await processGeojsonObject(json, displayName);
  }

  // v2.11.54：預設邊界一鍵載入（下拉選單 + 載入按鈕）
  const presetRow = el('div', { class: 'flex items-center gap-2 flex-wrap pt-1' });
  presetRow.appendChild(el('span', { class: 'text-xs text-stone-500' }, '📥 預設邊界：'));
  const presetSel = el('select', { class: 'border rounded text-xs px-2 py-1' },
    el('option', { value: '' }, '— 選一個預設集 —'),
    ...BOUNDARY_PRESETS.map(p => el('option', { value: p.id, title: p.description }, p.label))
  );
  const presetBtn = el('button', {
    type: 'button',
    class: 'text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50',
  }, '載入');
  presetBtn.addEventListener('click', async () => {
    const id = presetSel.value;
    if (!id) { toast('請先選擇預設集'); return; }
    const preset = BOUNDARY_PRESETS.find(p => p.id === id);
    if (!preset) return;
    presetBtn.disabled = true;
    presetBtn.textContent = '⏳ 下載中…';
    try {
      const resp = await fetch(preset.file, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      await processGeojsonText(text, `${preset.label}`);
    } catch (e) {
      renderStatus(`✗ 預設邊界載入失敗：${e.message}`, 'text-red-700');
      onChange(null);
    } finally {
      presetBtn.disabled = false;
      presetBtn.textContent = '載入';
    }
  });
  presetRow.appendChild(presetSel);
  presetRow.appendChild(presetBtn);
  wrap.appendChild(presetRow);

  // 檔案輸入
  // v2.11.91：加 multiple — Shapefile 是多檔格式（.shp 幾何 / .dbf 屬性 / .prj 座標系分開存），
  //   單選會逼使用者只能走 .zip；GeoJSON 仍只取第一個檔，行為不變。
  const fileInput = el('input', {
    type: 'file',
    accept: `.geojson,.json,application/geo+json,application/json,${SHAPEFILE_ACCEPT}`,
    multiple: 'true',
    class: 'text-xs block w-full',
  });
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    if (looksLikeShapefile(files)) {
      renderStatus('⏳ 讀取 Shapefile...', 'text-blue-600');
      renderNotes([]);
      try {
        const { geojson, meta } = await shapefileFilesToGeoJson(files);
        const label = files.length === 1 ? files[0].name : meta.layers.join('、');
        await processGeojsonObject(geojson, label, meta.notes);
      } catch (e) {
        console.error('[boundary shapefile]', e);
        renderStatus(`✗ Shapefile 解析失敗：${e.message}`, 'text-red-700');
        onChange(null);
      }
      return;
    }

    // GeoJSON：單檔（多選時只取第一個）
    if (files.length > 1) toast('GeoJSON 只會採用第一個檔案：' + files[0].name);
    const text = await files[0].text();
    await processGeojsonText(text, files[0].name);
  });
  wrap.appendChild(el('div', { class: 'text-xs text-stone-500' }, '或上傳自己的檔案：'));
  wrap.appendChild(fileInput);

  // 清除按鈕（只在已有邊界時顯示）
  if (existingBoundary) {
    const clearBtn = el('button', {
      type: 'button',
      class: 'text-xs px-2 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50',
    }, '🗑 清除既有邊界（儲存後生效）');
    clearBtn.addEventListener('click', () => {
      if (!confirm('確定清除既有專案邊界？\n（清除後地圖將回到 plot 點位定位；可隨時重新上傳）')) return;
      fileInput.value = '';
      renderNotes([]);
      renderStatus('⚠ 已標記清除（按儲存後寫入 Firestore）', 'text-amber-700');
      onChange('CLEAR');
    });
    wrap.appendChild(clearBtn);
  }
  return wrap;
}

export function openProjectForm(existing = null) {
  // v1.7.1：結構化代碼輸入 — 編輯既有專案時保留原 code（不允許改）
  const isEdit = !!existing;
  const currentYear = new Date().getFullYear();

  // 類型 select
  const typeSel = el('select', { name: 'type', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    el('option', { value: '' }, '— 選擇類型 —'),
    ...TYPE_CODES.map(t => el('option', { value: t.code }, `${t.code} — ${t.label}`))
  );
  // 單位 select（依 group 分組）
  const agencySel = el('select', { name: 'agency', required: 'true', class: 'border rounded px-2 py-1 w-full' });
  agencySel.appendChild(el('option', { value: '' }, '— 選擇單位 —'));
  const grouped = agenciesByGroup();
  for (const [grp, items] of Object.entries(grouped)) {
    const og = document.createElement('optgroup');
    og.label = grp;
    items.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.code;
      opt.textContent = `${a.code} — ${a.label}`;
      og.appendChild(opt);
    });
    agencySel.appendChild(og);
  }
  const yearInput = el('input', { type: 'number', name: 'year', min: '2020', max: '2100', value: currentYear,
    required: 'true', class: 'border rounded px-2 py-1 w-full' });
  const seqInput = el('input', { type: 'text', name: 'seq', readonly: 'true', placeholder: '自動產生',
    class: 'border rounded px-2 py-1 w-full bg-stone-50 text-stone-600' });
  const codePreview = el('div', {
    class: 'bg-blue-50 border border-blue-200 rounded p-2 text-sm font-mono text-center'
  }, '請填類型 / 單位 / 年度');

  // 自動算流水號
  let cachedProjectsSnap = null;
  async function ensureProjectsSnap() {
    if (cachedProjectsSnap) return cachedProjectsSnap;
    const s = await fb.getDocs(fb.collection(fb.db, 'projects'));
    cachedProjectsSnap = s.docs;
    return cachedProjectsSnap;
  }
  async function updateCodePreview() {
    const t = typeSel.value;
    const a = agencySel.value;
    const y = yearInput.value;
    if (!t || !a || !y) {
      codePreview.textContent = '請填類型 / 單位 / 年度';
      seqInput.value = '';
      return;
    }
    const prefix = `${t}-${a}-${y}-`;
    const docs = await ensureProjectsSnap();
    const seq = nextSequence(docs, prefix);
    seqInput.value = seq;
    codePreview.textContent = buildProjectCode(t, a, y, seq);
  }
  typeSel.addEventListener('change', updateCodePreview);
  agencySel.addEventListener('change', updateCodePreview);
  yearInput.addEventListener('change', updateCodePreview);

  // v2.11.19/24：專案邊界 GeoJSON state（只在編輯模式啟用）
  // null = 未上傳 / 維持現狀；object = 新上傳已 parsed；'CLEAR' = user 按了清除
  let boundaryDraft = null;
  // v2.11.24：偵測既有邊界 — 新格式（boundaryGeoJsonStr 字串）優先，舊格式（boundaryGeoJson 物件）fallback
  //   v2.11.19-23 物件格式從沒成功存過 Firestore，但仍保留 fallback 防 edge case
  let existingBoundary = null;
  if (existing?.boundaryGeoJsonStr) {
    try { existingBoundary = JSON.parse(existing.boundaryGeoJsonStr); }
    catch { existingBoundary = null; }
  } else if (existing?.boundaryGeoJson) {
    existingBoundary = existing.boundaryGeoJson;
  }

  // ── 調查模組組合（軸 A/B）— 只在新建時出現 ───────────────────────
  // 選計畫類型自動帶套餐預設（defaultModulesForType），Admin 可勾選微調；
  // 提交時 merge 進 methodology.modules + surveyMethod/monitoring（見 module-registry.js）。
  let surveyState = defaultModulesForType('');   // 無類型 → 全開（向後相容預設）
  const moduleBox = el('div', { class: 'field', style: 'background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:10px' });
  function renderModuleBox() {
    moduleBox.innerHTML = '';
    moduleBox.appendChild(el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:2px' }, '調查模組組合'));
    moduleBox.appendChild(el('p', { style: 'font-size:11px;color:#6d28d9;margin:0 0 8px' },
      '選計畫類型自動帶預設，可勾選微調。系統核心（樣區/儀表板/地圖/設定）一律開啟。'));
    ['plot', 'qaqc', 'admin'].forEach(fam => {
      const mods = MODULES.filter(m => m.family === fam);
      if (!mods.length) return;
      moduleBox.appendChild(el('div', { style: 'font-size:12px;color:#57534e;margin:6px 0 2px' }, FAMILIES[fam]));
      mods.forEach(m => {
        const cb = el('input', { type: 'checkbox',
          style: 'vertical-align:middle;margin-right:6px;width:15px;height:15px',
          ...(surveyState.modules[m.id] ? { checked: 'true' } : {}) });
        cb.addEventListener('change', () => { surveyState.modules[m.id] = cb.checked; });
        moduleBox.appendChild(el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          cb, m.label, m.implemented === false ? el('span', { style: 'color:#a8a29e' }, '（預留，未實作）') : null));
      });
    });
    const radioRow = (name, current, opts, onPick) => el('div', { style: 'margin-top:4px' },
      ...opts.map(o => {
        const r = el('input', { type: 'radio', name, value: o.v,
          style: 'vertical-align:middle;margin-right:4px;width:14px;height:14px',
          ...(current === o.v ? { checked: 'true' } : {}) });
        r.addEventListener('change', () => { if (r.checked) onPick(o.v); });
        return el('label', { style: 'display:inline-block;font-size:13px;margin-right:14px;cursor:pointer' }, r, o.label);
      }));
    moduleBox.appendChild(el('div', { style: 'font-size:12px;color:#57534e;margin:8px 0 2px' }, '調查方法'));
    moduleBox.appendChild(radioRow('surveyMethod', surveyState.surveyMethod,
      [{ v: 'sampling', label: '山區取樣' }, { v: 'census', label: '都市林/平地全區每木' }],
      v => { surveyState.surveyMethod = v; }));
    moduleBox.appendChild(el('div', { style: 'font-size:12px;color:#57534e;margin:8px 0 2px' }, '監測模式'));
    moduleBox.appendChild(radioRow('monitoring', surveyState.monitoring,
      [{ v: 'single', label: '單次調查' }, { v: 'repeat', label: '重複監測（複查）' }],
      v => { surveyState.monitoring = v; }));
  }
  renderModuleBox();
  typeSel.addEventListener('change', () => { surveyState = defaultModulesForType(typeSel.value || ''); renderModuleBox(); });

  const f = el('form', { class: 'space-y-2' },
    isEdit
      ? el('div', { class: 'field' },
          el('label', {}, '案件代碼'),
          el('div', { class: 'bg-stone-100 px-2 py-1 rounded text-sm font-mono' }, existing.code),
          el('p', { class: 'text-xs text-stone-500 mt-1' }, '代碼建立後不可改')
        )
      : el('div', { class: 'space-y-2' },
          el('div', { class: 'field' }, el('label', {}, '計畫類型 ', el('span', { class: 'req' }, '*')), typeSel),
          el('div', { class: 'field' }, el('label', {}, '委託 / 執行單位 ', el('span', { class: 'req' }, '*')), agencySel),
          el('div', { class: 'field-row' },
            el('div', { class: 'field' }, el('label', {}, '年度 ', el('span', { class: 'req' }, '*')), yearInput),
            el('div', { class: 'field' }, el('label', {}, '流水號（自動）'), seqInput)
          ),
          el('div', { class: 'field' },
            el('label', {}, '專案代碼 預覽'),
            codePreview,
            el('p', { class: 'text-xs text-stone-500 mt-1' }, '系統自動依 (類型,單位,年度) 找未用過的最小編號')
          )
        ),
    field({ label: '專案名稱', name: 'name', required: true, value: existing?.name || '', placeholder: '示範林班' }),
    field({ label: '描述', name: 'description', type: 'textarea', value: existing?.description || '' }),
    // v2.11.19：專案邊界 GeoJSON 上傳（初版只給編輯模式）
    // v2.11.54：開放新建模式也顯示 — admin 開新案時一站完成邊界準備（先 addDoc 拿 docId → 再 updateDoc 寫 boundary，submit handler 內處理）
    buildBoundarySection({
      existingBoundary,
      onChange: (draft) => { boundaryDraft = draft; },   // null | parsed object | 'CLEAR'
    }),
    // v1.7.0：支援多 PI（comma 或換行分隔多個 email）
    isEdit
      ? null
      : field({ label: 'PI（計畫主持人）email — 多人請用「,」或換行分隔', name: 'piEmail', type: 'textarea', rows: 2, required: true,
          value: state.user.email,
          placeholder: 'professor1@example.com, professor2@example.com' }),
    isEdit
      ? null
      : el('p', { class: 'text-xs text-stone-500' }, '⚠️ 每個 PI 必須先用該 email 登入過一次本系統。建好專案後，PI 可在「設計」分頁設定方法學、在「設定」分頁邀請更多成員。'),
    isEdit ? null : moduleBox,
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);

    if (isEdit) {
      // 編輯：只更新 name / description（v2.11.19 加 boundaryGeoJson）
      const updates = {
        name: fd.get('name').trim(),
        description: fd.get('description').trim() || ''
      };
      // v2.11.19/24：boundary 三種狀態
      //   null = user 沒動過 boundary 區塊 → 不寫 boundary 欄位
      //   'CLEAR' = user 按了清除 → 寫 null 移除既有
      //   parsed object = user 上傳新 GeoJSON → 存 stringified 字串
      // v2.11.24：FIRESTORE BUG 修 — Firestore array 不能直接含另一個 array（官方限制），
      //   而 GeoJSON coordinates 是 array-of-array-of-array → Firestore reject。
      //   解：JSON.stringify 後存單一字串欄位 boundaryGeoJsonStr，讀的時候 JSON.parse 還原。
      //   舊 boundaryGeoJson 欄位保留 null（v2.11.19-23 從沒人成功存過所以不需 migration）。
      if (boundaryDraft === 'CLEAR') {
        updates.boundaryGeoJson = null;
        updates.boundaryGeoJsonStr = null;
        updates.boundaryMeta = null;
        updates.boundaryUpdatedAt = fb.serverTimestamp();
        updates.boundaryUpdatedBy = state.user.uid;
      } else if (boundaryDraft && typeof boundaryDraft === 'object') {
        updates.boundaryGeoJson = null;     // 舊欄位永遠 null
        updates.boundaryGeoJsonStr = JSON.stringify(boundaryDraft.geojson);
        updates.boundaryMeta = {
          srcSystem: boundaryDraft.srcSystem,
          polygonCount: boundaryDraft.polygonCount,
          ringCount: boundaryDraft.ringCount,
          vertexCount: boundaryDraft.vertexCount,
          featureCount: boundaryDraft.featureCount || null,   // v2.11.55：FeatureCollection feature 數，給 dropdown 判斷用
          bbox: boundaryDraft.bbox,
          fileName: boundaryDraft.fileName || null,
        };
        updates.boundaryUpdatedAt = fb.serverTimestamp();
        updates.boundaryUpdatedBy = state.user.uid;
      }
      try {
        await fb.updateDoc(fb.doc(fb.db, 'projects', existing.id), updates);
        // v2.11.22：state.project + 地圖即時同步 — 重抓 project doc + dispatch event 讓 analytics.renderMap 重繪
        try {
          const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', existing.id));
          if (fresh.exists()) state.project = { id: existing.id, ...fresh.data() };
        } catch {}
        window.dispatchEvent(new CustomEvent('forestmrv:project-updated', { detail: { projectId: existing.id } }));
        toast('已更新' + (boundaryDraft ? '（含邊界）' : ''));
        closeModal();
      } catch (e) { toast('更新失敗：' + e.message); }
      return;
    }

    // 新建專案：v1.7.1 結構化代碼
    const t = fd.get('type'), a = fd.get('agency'), y = fd.get('year'), seq = fd.get('seq');
    if (!t || !a || !y || !seq) { toast('請完整選擇類型 / 單位 / 年度'); return; }
    const code = buildProjectCode(t, a, y, seq);
    // 重新驗證流水號（避免 race：他人剛建同 prefix）
    const docs = await ensureProjectsSnap();
    if (docs.some(d => d.data().code === code)) {
      toast(`代碼 ${code} 已被使用，請重新打開表單以取得新流水號`);
      return;
    }

    const piEmails = fd.get('piEmail').split(/[,;\n\s]+/).map(s => s.trim()).filter(Boolean);
    if (piEmails.length === 0) { toast('至少需要 1 位 PI'); return; }
    const piUids = [];
    for (const email of piEmails) {
      const usnap = await fb.getDocs(fb.query(fb.collection(fb.db, 'users'), fb.where('email', '==', email)));
      if (usnap.empty) { toast(`找不到 email = ${email} 的使用者，請對方先登入過一次系統`); return; }
      piUids.push(usnap.docs[0].id);
    }
    const members = {};
    piUids.forEach(uid => { members[uid] = 'pi'; });
    const data = {
      code,
      codeMeta: { type: t, agency: a, year: parseInt(y, 10), seq },  // v1.7.1：結構化資訊備查
      name: fd.get('name').trim(),
      description: fd.get('description').trim() || '',
      coordinateSystem: 'TWD97_TM2',
      pi: piUids[0],
      pis: piUids,
      members,
      memberUids: piUids,
      // 模組組合（軸 A/B）：merge 既有預設 modules（保 plot/disturbance 等 registry 未列 key）+ 本次勾選 + 軸 B
      methodology: {
        ...DEFAULT_METHODOLOGY,
        modules: { ...DEFAULT_METHODOLOGY.modules, ...surveyState.modules },
        surveyMethod: surveyState.surveyMethod,
        monitoring: surveyState.monitoring,
      },
      // v2.7.17：reviewer QAQC 預設 config（reviewer 進審查時可改）
      qaqcConfig: { ...DEFAULT_QAQC_CONFIG },
      locked: false,
      // v2.3：階段 2 狀態機初始狀態
      status: STATUS.CREATED,
      statusChangedAt: fb.serverTimestamp(),
      statusChangedBy: state.user.uid,
      autoLockReason: null,
      migratedV2_3: true,
      // 階段 3 預留欄位
      reviews: [],
      verifiedBy: null,
      verifiedAt: null,
      createdBy: state.user.uid,
      createdAt: fb.serverTimestamp()
    };
    try {
      const ref = await fb.addDoc(fb.collection(fb.db, 'projects'), data);
      // v2.11.54：新建時若 user 已上傳邊界 → addDoc 後立即 updateDoc 寫 boundary 兩步原子化
      //   失敗不擋整個建立流程（專案已建好、邊界後續可從「✏️ 編輯專案」補上）
      if (boundaryDraft && typeof boundaryDraft === 'object') {
        try {
          await fb.updateDoc(fb.doc(fb.db, 'projects', ref.id), {
            boundaryGeoJson: null,
            boundaryGeoJsonStr: JSON.stringify(boundaryDraft.geojson),
            boundaryMeta: {
              srcSystem: boundaryDraft.srcSystem,
              polygonCount: boundaryDraft.polygonCount,
              ringCount: boundaryDraft.ringCount,
              vertexCount: boundaryDraft.vertexCount,
              featureCount: boundaryDraft.featureCount || null,   // v2.11.55
              bbox: boundaryDraft.bbox,
              fileName: boundaryDraft.fileName || null,
            },
            boundaryUpdatedAt: fb.serverTimestamp(),
            boundaryUpdatedBy: state.user.uid,
          });
          toast(`已建立 ${code}（${piUids.length} 位 PI，含邊界）`);
        } catch (be) {
          console.error('[create-then-boundary] updateDoc failed:', be);
          toast(`已建立 ${code}（邊界寫入失敗：${be.message}，請進編輯重試）`, 6000);
        }
      } else {
        toast(`已建立 ${code}（${piUids.length} 位 PI）`);
      }
      closeModal();
      location.hash = `#/p/${ref.id}`;
    } catch (e) { toast('建立失敗：' + e.message); }
  });
  openModal(existing ? '編輯專案' : '新專案', f);
}

// ===== 方法學編輯器（PI 主場）=====
export function openMethodologyForm(project) {
  const m = project.methodology || { ...DEFAULT_METHODOLOGY };
  const f = el('form', { class: 'space-y-2' },
    field({ label: '目標樣區數', name: 'targetPlotCount', type: 'number', step: '1', min: '1', required: true, value: m.targetPlotCount }),
    field({ label: '樣區形狀（預設）', name: 'plotShape', required: true,
      options: [
        // v2.8.3：rectangle 提到第一個 + 註明台灣永久樣區慣例
        { value: 'rectangle', label: '矩形（台灣永久樣區，0.05 ha = 20 × 25 m）★ 推薦' },
        { value: 'circle', label: '圓形' },
        { value: 'square', label: '方形' },
        { value: 'irregular', label: '不規則多邊形（v2.8）' }
      ],
      value: m.plotShape }),
    el('p', { class: 'text-xs text-stone-600 -mt-2 mb-2', style: 'margin-left:2px' },
      '📌 台灣永久樣區（林業及自然保育署 / 中華紙漿廠等）多採 0.05 ha 矩形 20 × 25 m（X 沿等高線、Y 沿坡）。建議首選矩形以符合實務量測幾何。'),
    field({ label: '允許的樣區面積（m²，逗號分隔）', name: 'plotAreaOptions', required: true,
      value: (m.plotAreaOptions || []).join(','), placeholder: '400, 500, 1000' }),
    // v2.7.16：dimensionType — 量測單位（沿坡距 vs 水平投影）
    el('div', { class: 'field', style: 'background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px' },
      el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:6px' },
        '量測單位（v2.7.16）'),
      ...[
        { v: 'slope_distance', label: '沿坡距（野外皮尺，預設）', desc: 'X/Y 是野外皮尺實測距離；寫入時自動算 cos(坡度) 校正得水平投影面積（碳計算用）' },
        { v: 'horizontal', label: '水平投影', desc: '已在野外換算 / 用 DEM 推導 / 補登時校正過；不再做 cos 修正' }
      ].map(({ v, label, desc }) => el('label', {
        style: 'display:block;font-size:13px;line-height:1.5;cursor:pointer;padding:4px 0'
      },
        el('input', {
          type: 'radio', name: 'dimensionType', value: v,
          style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
          ...((m.dimensionType || 'slope_distance') === v ? { checked: 'true' } : {})
        }),
        el('b', {}, label),
        el('div', { style: 'font-size:11px;color:#57534e;margin-left:20px' }, desc)
      )),
      el('p', { style: 'font-size:11px;color:#92400e;margin-top:6px' },
        '💡 樣區坡度與 dimensions 在「樣區編輯」表單填；本欄決定全專案如何解釋這些數值。')
    ),
    // v2.5：plotOriginType — 立木 X/Y 座標系統的原點位置
    el('div', { class: 'field', style: 'background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:10px' },
      el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:6px' },
        '樣區原點位置（v2.5）'),
      ...[
        { v: 'center', label: '中心點原點', desc: 'plot.GPS = 樣區中心；皮尺距中心可正可負（林保署永久樣區常用）' },
        { v: 'corner', label: '左下角原點', desc: 'plot.GPS = 樣區左下角；皮尺從左下往右北恆為正' }
      ].map(({ v, label, desc }) => el('label', {
        style: 'display:block;font-size:13px;line-height:1.5;cursor:pointer;padding:4px 0'
      },
        el('input', {
          type: 'radio', name: 'plotOriginType', value: v,
          style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
          ...((m.plotOriginType || 'center') === v ? { checked: 'true' } : {})
        }),
        el('b', {}, label),
        el('div', { style: 'font-size:11px;color:#57534e;margin-left:20px' }, desc)
      )),
      el('p', { style: 'font-size:11px;color:#1e40af;margin-top:6px' },
        '💡 設定後，立木表單會出現 X / Y 座標欄位，自動換算每株絕對 TWD97 + WGS84 座標。')
    ),
    el('div', { class: 'field' },
      el('label', {}, '強制必填欄位（立木調查）'),
      el('div', { style: 'display:block' },
        ...['photos', 'branchHeight', 'pestSymptoms'].map(k => el('label', {
          style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
        },
          el('input', {
            type: 'checkbox', name: `req_${k}`,
            style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
            ...(m.required?.[k] ? { checked: 'true' } : {})
          }),
          { photos: '照片', branchHeight: '枝下高', pestSymptoms: '病蟲害' }[k]
        ))
      )
    ),
    // v2.0：模組勾選改 inline style 寫死（避開 Tailwind CDN + 動態 DOM 在窄 modal 直書 bug）
    el('div', { class: 'field' },
      el('label', {}, '啟用模組（v1 既有）'),
      el('div', { style: 'display:block' },
        ...['plot', 'tree', 'regeneration'].map(k => el('label', {
          style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
        },
          el('input', {
            type: 'checkbox', name: `mod_${k}`,
            style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
            ...(m.modules?.[k] !== false ? { checked: 'true' } : {})
          }),
          { plot: '永久樣區', tree: '立木', regeneration: '自然更新' }[k]
        ))
      )
    ),
    // v2.0：新增監測模組勾選 + 各自必填
    el('div', { class: 'field', style: 'background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.0 新增監測模組'),
      // 主模組勾選（每個一行）
      ...[
        { k: 'understory', label: '🌿 地被植物' },
        { k: 'soilCons', label: '⛰️ 水土保持' }
      ].map(({ k, label }) => el('label', {
        style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer'
      },
        el('input', {
          type: 'checkbox', name: `mod_${k}`,
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.[k] === true ? { checked: 'true' } : {})
        }),
        label
      )),
      // 必填子設定（每個一行，縮排）
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #a7f3d0' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '必填欄位設定'),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'us_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.understoryConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '地被樣方照片必填'
        ),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'sc_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.soilConsConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '水保定點照片必填'
        )
      ),
      // 樣方大小
      el('div', { style: 'margin-top:8px' },
        el('label', { style: 'display:block;font-size:13px;color:#57534e;margin-bottom:4px' }, '地被樣方大小'),
        el('select', {
          name: 'us_quadratSize',
          style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;background:#fff'
        },
          ...['1x1', '2x2', '5x5'].map(s => {
            const opt = el('option', { value: s }, `${s.replace('x', ' × ')} m`);
            if ((m.understoryConfig?.quadratSize || '1x1') === s) opt.setAttribute('selected', 'true');
            return opt;
          })
        )
      ),
    ),
    // v2.1：野生動物模組
    el('div', { class: 'field', style: 'background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.1 野生動物監測'),
      el('label', { style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer' },
        el('input', {
          type: 'checkbox', name: 'mod_wildlife',
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.wildlife === true ? { checked: 'true' } : {})
        }),
        '🦌 啟用野生動物監測'
      ),
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #fcd34d' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '設定'),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'wl_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.wildlifeConfig?.requirePhotos === true ? { checked: 'true' } : {})
          }),
          '紀錄照片必填（音訊調查可免）'
        ),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
          el('input', {
            type: 'checkbox', name: 'wl_blur',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.wildlifeConfig?.blurSensitive !== false ? { checked: 'true' } : {})
          }),
          '保育類 I 級匯出時加警示（避免敏感物種點位外流）'
        )
      ),
      el('p', { style: 'font-size:11px;color:#78716c;margin-top:6px' },
        '支援 4 種方法：直接目擊 / 痕跡 / 自動相機 / 鳴聲。物種輸入即時帶保育等級色階。')
    ),
    // v2.2：經濟收穫模組
    el('div', { class: 'field', style: 'background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, 'v2.2 經濟收穫監測'),
      el('label', { style: 'display:block;font-size:14px;line-height:1.8;cursor:pointer' },
        el('input', {
          type: 'checkbox', name: 'mod_harvest',
          style: 'vertical-align:middle;margin-right:6px;width:16px;height:16px',
          ...(m.modules?.harvest === true ? { checked: 'true' } : {})
        }),
        '🌰 啟用經濟收穫監測'
      ),
      el('div', { style: 'margin-top:8px;padding-left:8px;border-left:2px solid #fde047' },
        el('div', { style: 'font-size:12px;color:#57534e;margin-bottom:4px' }, '可採收樹種白名單（限制 harvest 紀錄綁的 tree.speciesZh）'),
        el('input', {
          type: 'text', name: 'hv_species',
          style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;width:100%;background:#fff',
          placeholder: '土肉桂, 油茶, 愛玉子',
          value: (m.harvestConfig?.species || ['土肉桂']).join(', ')
        }),
        el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer;margin-top:6px' },
          el('input', {
            type: 'checkbox', name: 'hv_photoReq',
            style: 'vertical-align:middle;margin-right:6px;width:14px;height:14px',
            ...(m.harvestConfig?.requirePhotos !== false ? { checked: 'true' } : {})
          }),
          '採收照片必填（採前/採後/產品）'
        ),
        el('div', { style: 'margin-top:6px' },
          el('label', { style: 'display:block;font-size:13px;color:#57534e;margin-bottom:2px' }, '預設含水率（鮮→乾重估算）'),
          el('input', {
            type: 'number', name: 'hv_moisture', step: '0.05', min: '0', max: '0.95',
            style: 'border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;font-size:13px;width:100px;background:#fff',
            value: m.harvestConfig?.moistureDefault ?? 0.5
          })
        )
      ),
      el('p', { style: 'font-size:11px;color:#78716c;margin-top:6px' },
        '🌳 採收紀錄綁立木個體；treeStatusAfter=砍除根除 自動同步 tree.vitality。鮮重→乾重→自動算 tCO₂e 扣減。')
    ),
    // 進階模組（頂層分頁 design/qaqc/export/admin_harvest + soil）+ 軸 B 調查方式
    el('div', { class: 'field', style: 'background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:10px' },
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, '進階模組與調查方式'),
      ...[
        { k: 'qaqc', label: '取樣審查（QAQC）' },
        { k: 'export', label: '匯出' },
        { k: 'admin_harvest', label: '修枝採收行政（申請/審核/回報/彙整）' },
        { k: 'soil', label: '土壤調查（預留，未實作）' },
      ].map(({ k, label }) => el('label', { style: 'display:block;font-size:13px;line-height:1.7;cursor:pointer' },
        el('input', { type: 'checkbox', name: `mod_${k}`, style: 'vertical-align:middle;margin-right:6px;width:15px;height:15px',
          ...((m.modules?.[k] !== undefined ? m.modules[k] === true : getModule(k).default !== false) ? { checked: 'true' } : {}) }),
        label)),
      el('div', { style: 'font-size:12px;color:#57534e;margin:8px 0 2px' }, '調查方法'),
      ...[{ v: 'sampling', label: '山區取樣' }, { v: 'census', label: '都市林/平地全區每木' }].map(o =>
        el('label', { style: 'display:inline-block;font-size:13px;margin-right:14px;cursor:pointer' },
          el('input', { type: 'radio', name: 'surveyMethod', value: o.v, style: 'vertical-align:middle;margin-right:4px;width:14px;height:14px',
            ...((m.surveyMethod || 'sampling') === o.v ? { checked: 'true' } : {}) }), o.label)),
      el('div', { style: 'font-size:12px;color:#57534e;margin:8px 0 2px' }, '監測模式'),
      ...[{ v: 'single', label: '單次調查' }, { v: 'repeat', label: '重複監測（複查）' }].map(o =>
        el('label', { style: 'display:inline-block;font-size:13px;margin-right:14px;cursor:pointer' },
          el('input', { type: 'radio', name: 'monitoring', value: o.v, style: 'vertical-align:middle;margin-right:4px;width:14px;height:14px',
            ...((m.monitoring || 'single') === o.v ? { checked: 'true' } : {}) }), o.label))
    ),
    field({ label: '方法學說明', name: 'description', type: 'textarea', rows: 5, value: m.description || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const newM = {
      targetPlotCount: parseInt(fd.get('targetPlotCount'), 10),
      plotShape: fd.get('plotShape'),
      plotAreaOptions: fd.get('plotAreaOptions').split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0),
      dimensionType: fd.get('dimensionType') || 'slope_distance',  // v2.7.16
      plotOriginType: fd.get('plotOriginType') || 'center',  // v2.5
      required: {
        photos: fd.get('req_photos') === 'on',
        branchHeight: fd.get('req_branchHeight') === 'on',
        pestSymptoms: fd.get('req_pestSymptoms') === 'on'
      },
      modules: {
        ...m.modules,                                   // 保留既有所有 key（含未列入表單的未來欄位）
        plot: fd.get('mod_plot') === 'on',
        tree: fd.get('mod_tree') === 'on',
        regeneration: fd.get('mod_regeneration') === 'on',
        understory: fd.get('mod_understory') === 'on',  // v2.0
        soilCons: fd.get('mod_soilCons') === 'on',      // v2.0
        wildlife: fd.get('mod_wildlife') === 'on',      // v2.1
        harvest: fd.get('mod_harvest') === 'on',        // v2.2
        disturbance: m.modules?.disturbance || false,
        // 軸 A 擴充：頂層分頁模組 + soil（與新專案表單同一組 key）
        qaqc: fd.get('mod_qaqc') === 'on',
        export: fd.get('mod_export') === 'on',
        admin_harvest: fd.get('mod_admin_harvest') === 'on',
        soil: fd.get('mod_soil') === 'on',
      },
      // 軸 B：調查方法 / 監測模式
      surveyMethod: fd.get('surveyMethod') || 'sampling',
      monitoring: fd.get('monitoring') || 'single',
      // v2.0：新模組獨立 config
      understoryConfig: {
        ...DEFAULT_METHODOLOGY.understoryConfig,
        ...(m.understoryConfig || {}),
        quadratSize: fd.get('us_quadratSize') || '1x1',
        requirePhotos: fd.get('us_photoReq') === 'on'
      },
      soilConsConfig: {
        ...DEFAULT_METHODOLOGY.soilConsConfig,
        ...(m.soilConsConfig || {}),
        requirePhotos: fd.get('sc_photoReq') === 'on'
      },
      // v2.1：野生動物
      wildlifeConfig: {
        ...DEFAULT_METHODOLOGY.wildlifeConfig,
        ...(m.wildlifeConfig || {}),
        requirePhotos: fd.get('wl_photoReq') === 'on',
        blurSensitive: fd.get('wl_blur') === 'on'
      },
      // v2.2：經濟收穫
      harvestConfig: {
        ...DEFAULT_METHODOLOGY.harvestConfig,
        ...(m.harvestConfig || {}),
        species: (fd.get('hv_species') || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean),
        requirePhotos: fd.get('hv_photoReq') === 'on',
        moistureDefault: parseFloat(fd.get('hv_moisture')) || 0.5
      },
      description: fd.get('description').trim()
    };
    try {
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id), { methodology: newM });
      project.methodology = newM;
      state.project.methodology = newM;
      // v2.3：methodology 第一次儲存（status='created'）→ 'planning'
      try { await applyStatusAfterMethodologySaved(state.project); } catch (e) { console.warn('[v2.3 methodology status] failed', e); }
      toast('方法學已更新');
      closeModal();
      location.reload();  // 簡單重整讓設計頁重繪
    } catch (e) { toast('儲存失敗：' + e.message); }
  });
  openModal('編輯方法學', f);
}

// ===== v1.7.0：PI 批量建立空殼樣區（預先規劃 + 分派工作的入口）=====
// Code 規則：{projectCode}[-{林班}]-{NNN}（NNN 補零三位數）
// 空殼 = 無 GPS / 無 area / assignedTo=null / qaStatus='shell'（不會出現在待審核）
export async function openBatchPlotsForm(project) {
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  const previewBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs text-stone-700 my-2' });

  const f = el('form', { class: 'space-y-2' },
    el('p', { class: 'text-sm text-stone-600' },
      `批量建立預先規劃的空殼樣區。Surveyor 被指派後可填 GPS 與資料。`),
    el('div', { class: 'field-row' },
      field({ label: '林班（可留空）', name: 'forestUnit', value: '', placeholder: '123-2' }),
      field({ label: '起始編號', name: 'startNum', type: 'number', step: '1', min: '1', required: true, value: 1 })
    ),
    el('div', { class: 'field-row' },
      field({ label: '建立數量', name: 'count', type: 'number', step: '1', min: '1', max: '500', required: true, value: 10 }),
      field({ label: '預設面積 (m²)', name: 'area_m2',
        options: (meth.plotAreaOptions || [400, 500, 1000]).map(a => ({ value: a, label: `${a} m²` })),
        value: meth.plotAreaOptions?.[0] || 500, required: true })
    ),
    field({ label: '預設形狀', name: 'shape',
      options: [
        // v2.8.3：rectangle 提前 + 加台灣 20×25 預設說明
        { value: 'rectangle', label: '矩形（台灣 20×25 m，預設帶值；surveyor 可改）★' },
        { value: 'circle', label: '圓形' },
        { value: 'square', label: '方形' }
      ],
      value: meth.plotShape || 'rectangle', required: true }),
    previewBox,
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '建立'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  function updatePreview() {
    const fd = new FormData(f);
    const fu = fd.get('forestUnit').trim();
    const start = parseInt(fd.get('startNum'), 10) || 1;
    const count = parseInt(fd.get('count'), 10) || 1;
    const codeOf = (n) => `${project.code}${fu ? '-' + fu : ''}-${String(n).padStart(3, '0')}`;
    if (count <= 0) { previewBox.textContent = ''; return; }
    if (count === 1) {
      previewBox.innerHTML = `將建立：<b>${codeOf(start)}</b>`;
    } else {
      previewBox.innerHTML = `將建立 <b>${count}</b> 個樣區：<b>${codeOf(start)}</b> ～ <b>${codeOf(start + count - 1)}</b>`;
    }
  }
  f.addEventListener('input', updatePreview);
  updatePreview();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const fu = fd.get('forestUnit').trim() || null;
    const start = parseInt(fd.get('startNum'), 10);
    const count = parseInt(fd.get('count'), 10);
    const area = parseInt(fd.get('area_m2'), 10);
    const shape = fd.get('shape');
    if (count > 100 && !confirm(`建立 ${count} 個空殼？建議分批以免一次寫太多`)) return;

    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '建立中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots');
      // v2.7.16：批次空殼也帶 v2.6 schema 欄位（surveyor 後續編輯時補真實坡度與 dimensions）
      // v2.8.3：rectangle 預設帶 20×25（台灣永久樣區慣例）；只在 area=500 時帶值，其餘留空
      const dimType = meth.dimensionType || 'slope_distance';
      let shellPlotDimensions;
      if (shape === 'circle') shellPlotDimensions = { radius: Math.sqrt(area / Math.PI) };
      else if (shape === 'square') { const side = Math.sqrt(area); shellPlotDimensions = { side, width: side, length: side }; }
      else if (shape === 'rectangle' && area === 500) shellPlotDimensions = { width: 20, length: 25 };  // v2.8.3：台灣 0.05 ha 預設
      else shellPlotDimensions = null;  // rectangle 非 500 m²：留空殼，surveyor 填寬/長
      let success = 0;
      for (let i = 0; i < count; i++) {
        const n = start + i;
        const code = `${project.code}${fu ? '-' + fu : ''}-${String(n).padStart(3, '0')}`;
        await fb.addDoc(colRef, {
          code,
          forestUnit: fu,
          shape,
          area_m2: area,
          // v2.7.16：新 schema 欄位
          plotDimensions: shellPlotDimensions,
          slopeDegrees: 0,                 // 空殼預設平地，surveyor 編輯時改
          slopeWidthDeg: 0,                // v2.8.4：雙軸坡度，預設平地
          slopeLengthDeg: 0,
          slopeAspect: null,
          slopeSource: null,
          dimensionType: dimType,
          areaHorizontal_m2: area,         // slope=0 → cos(0)=1 → = area
          // v2.8.3：rectangle 500m² 預設 20×25 帶值 → 不再 pending；非 500 仍 pending
          migrationPending: shape === 'rectangle' && area !== 500,
          // v2.7.17：QAQC 預設子結構
          qaqc: defaultQaqc(),
          location: null,
          locationTWD97: null,
          locationAccuracy_m: null,
          establishedAt: null,
          notes: null,
          assignedTo: null,
          assignedToUids: [],   // v2.11.77：多人指派（空 = 未指派）
          qaStatus: 'shell',  // v1.7.0：空殼狀態，不參與 QA 統計
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
          // v2.11.94：不再寫 insideBoundary — 舊版四個寫入端一律硬編 true（點面套疊從未實作），
          //   等於假資料。界內／界外一律由 analytics.getPlotBoundaryStatus() 對專案邊界即時套疊。
        });
        success++;
      }
      toast(`已建立 ${success} 個空殼樣區`);
      closeModal();
    } catch (e) {
      toast('建立失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '建立';
    }
  });
  openModal('批量建立空殼樣區', f);
}

// ===== v1.7.0：批量指派樣區給 surveyor =====
// v2.11.77：改為多人指派 — 寫 assignedToUids（字串陣列）。
//   同步把舊欄位 assignedTo 設為「首位指派人或 null」以保向後相容（萬一仍有讀 assignedTo 的舊路徑）。
//   讀取一律走 app.plotAssignees（陣列優先、回退單欄位）。
export async function setPlotAssignees(project, plot, surveyorUids) {
  const uids = Array.from(new Set((surveyorUids || []).filter(Boolean)));
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), {
      assignedToUids: uids,
      assignedTo: uids[0] || null,  // 向後相容鏡像
      updatedAt: fb.serverTimestamp()
    });
    toast(uids.length ? `已指派 ${uids.length} 人` : '已解除指派');
  } catch (e) { toast('指派失敗：' + e.message); }
}

// ===== QA 標記（pi 用）=====
// v2.3：標記後跑狀態機
//   - verified 後若全 6 子集合 verified → 自動 review + auto-Lock
//   - 從 verified 退回 flagged/rejected 且 status='review' → 退回 active + auto-unlock
export async function markQA(project, plotId, subDoc, status) {
  const labels = { verified: '通過', flagged: '退回修正', rejected: '駁回' };
  const comment = status === 'verified' ? '' : (prompt(`為什麼${labels[status]}？（簡短說明）`) || '');
  if (status !== 'verified' && !comment.trim()) { toast('需填寫原因'); return; }
  try {
    const ref = subDoc
      ? fb.doc(fb.db, 'projects', project.id, 'plots', plotId, subDoc.coll, subDoc.id)
      : fb.doc(fb.db, 'projects', project.id, 'plots', plotId);
    // v2.3：先讀 oldQa 才能判斷狀態機要 promote 還是 demote
    const oldSnap = await fb.getDoc(ref);
    const oldQa = oldSnap.exists() ? oldSnap.data().qaStatus : null;
    await fb.updateDoc(ref, {
      qaStatus: status,
      qaMarkedBy: state.user.uid,
      qaMarkedAt: fb.serverTimestamp(),
      qaComment: comment
    });
    toast(`已標記為 ${status}`);
    // v2.3：狀態機分派（不擋 toast；跑完再 toast 結果）
    let stateChanged = false;
    try {
      const result = await applyStatusAfterQA(project, oldQa, status);
      if (result === 'promoted-review') {
        toast('🔍 全資料 verified — 專案已自動進入審查階段並鎖定', 5000);
        stateChanged = true;
      } else if (result === 'demoted-active') {
        toast('▶ 專案自動退回「進行中」（已解除鎖定）', 4000);
        stateChanged = true;
      }
    } catch (e) { console.warn('[v2.3 status update] failed', e); }
    // v2.6.1：sub-doc + 沒觸發狀態機 → 局部更新該 row 的 badge（不 reroute、不閃畫面）
    //         plot 本身 / 觸發 promote-demote → 仍 reroute（更新 lock banner、status badge、全部 row 的 QA 按鈕）
    if (subDoc && !stateChanged) {
      const cell = document.querySelector(`[data-qa-cell-id="qa-cell-${subDoc.coll}-${subDoc.id}"]`);
      if (cell) {
        const badge = cell.querySelector('.qa-badge');
        if (badge) {
          badge.outerHTML = qaBadge(status);
          // v2.6.1b：broadcast event 給樣區清單頁的 chip 做增量更新
          //   （plot listener 對 sub-doc 變動無感，需手動通知）
          window.dispatchEvent(new CustomEvent('mrv:qa-changed', {
            detail: { plotId, subColl: subDoc.coll, oldStatus: oldQa, newStatus: status }
          }));
          return;  // 局部更新成功 → 不 reroute
        }
      }
      console.warn('[markQA local-update] cell/badge not found, fallback to reroute', subDoc);
    }
    // v2.3.1：fallback / 狀態機觸發 / plot 本身 → 重繪當前 view
    // v2.3.4：reroute 前記住當前 sub-tab
    captureCurrentSubtab();
    state.project = null;
    state.plot = null;
    try { await rerouteCurrentView(); } catch (e) { console.warn('[reroute] failed', e); }
  } catch (e) { toast('標記失敗：' + e.message); }
}

// ===== v2.7.17：Reviewer QAQC 重測表單（抽樣 plot 才能開）=====
//   reviewer / admin 對 inSample plot 開此 modal 填重測值；存檔只動 qaqc field（受 rules hasOnly(['qaqc','updatedAt']) 約束）
//   超閾值時必須填 resolution + resolutionNote 才能存
export async function openQaqcRemeasureForm(project, plot) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...(project.qaqcConfig || {}) };
  const q = plot.qaqc || defaultQaqc();
  const shape = plot.shape || 'square';
  const dims = plot.plotDimensions || {};
  const dimType = plot.dimensionType || 'horizontal';

  // 重測欄位 inputs（依 shape 而定）
  const slopeInput = el('input', { type: 'number', step: '0.1', min: '0', max: '90', name: 'slopeVerified',
    placeholder: '°', value: q.slopeVerified ?? '', class: 'border rounded px-2 py-1 text-sm' });

  // dimensionsVerified：mirror 既有 plotDimensions 結構
  // v2.8.0：irregular 採 area-only 模式（reviewer 不重畫多邊形，直接填重測水平面積）
  let dimsVerifiedInputs = el('div', {});
  let getDimensionsVerified = () => null;
  let getAreaVerifiedHorizontalDirect = null;  // v2.8.0：irregular 用，繞過 dimensionsToArea + computeAreaHorizontal
  if (shape === 'irregular') {
    const areaVerH = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'areaVerH',
      placeholder: '重測水平面積 (m²)', value: q.areaVerifiedHorizontal ?? q.dimensionsVerified?.areaH_user ?? '',
      class: 'border rounded px-2 py-1 text-sm w-40' });
    dimsVerifiedInputs = el('div', { class: 'flex items-center gap-2 text-sm flex-wrap' },
      el('span', { class: 'w-32' }, '重測水平面積 (m²)：'), areaVerH,
      el('div', { class: 'text-xs text-stone-500 w-full' }, '※ irregular 採 area-only 模式 — 直接填重測得的水平投影面積；reviewer 不需重畫多邊形（GIS 估算 / 取樣量測即可）。')
    );
    getDimensionsVerified = () => {
      const a = parseFloat(areaVerH.value);
      return Number.isFinite(a) && a > 0 ? { areaH_user: a } : null;
    };
    getAreaVerifiedHorizontalDirect = () => {
      const a = parseFloat(areaVerH.value);
      return Number.isFinite(a) && a > 0 ? a : null;
    };
  } else if (shape === 'circle') {
    const radiusVer = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'radiusVer',
      placeholder: '半徑 m', value: q.dimensionsVerified?.radius ?? '', class: 'border rounded px-2 py-1 text-sm w-32' });
    dimsVerifiedInputs = el('div', { class: 'flex items-center gap-2 text-sm' },
      el('span', { class: 'w-16' }, '半徑 (m)：'), radiusVer);
    getDimensionsVerified = () => {
      const r = parseFloat(radiusVer.value);
      return Number.isFinite(r) && r > 0 ? { radius: r } : null;
    };
  } else if (shape === 'rectangle') {
    const widthVer = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'widthVer',
      placeholder: '寬 m', value: q.dimensionsVerified?.width ?? '', class: 'border rounded px-2 py-1 text-sm w-24' });
    const lengthVer = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'lengthVer',
      placeholder: '長 m', value: q.dimensionsVerified?.length ?? '', class: 'border rounded px-2 py-1 text-sm w-24' });
    dimsVerifiedInputs = el('div', { class: 'flex items-center gap-2 text-sm flex-wrap' },
      el('span', { class: 'w-16' }, '寬 / 長：'), widthVer, el('span', {}, '×'), lengthVer, el('span', { class: 'text-xs' }, 'm'));
    getDimensionsVerified = () => {
      const w = parseFloat(widthVer.value);
      const l = parseFloat(lengthVer.value);
      return Number.isFinite(w) && w > 0 && Number.isFinite(l) && l > 0 ? { width: w, length: l } : null;
    };
  } else {  // square
    const sideVer = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'sideVer',
      placeholder: '邊長 m', value: q.dimensionsVerified?.side ?? '', class: 'border rounded px-2 py-1 text-sm w-32' });
    dimsVerifiedInputs = el('div', { class: 'flex items-center gap-2 text-sm' },
      el('span', { class: 'w-16' }, '邊長 (m)：'), sideVer);
    getDimensionsVerified = () => {
      const s = parseFloat(sideVer.value);
      return Number.isFinite(s) && s > 0 ? { side: s, width: s, length: s } : null;
    };
  }

  // 即時誤差預覽
  const errorBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs my-2' });
  // 處置區（先建好，根據誤差決定顯示）
  const resolutionSelect = el('select', { name: 'resolution', class: 'border rounded px-2 py-1 text-sm' },
    el('option', { value: '' }, '— 選擇處置 —'),
    ...Object.entries(RESOLUTION_LABEL).map(([v, label]) => {
      const o = el('option', { value: v }, label);
      if (q.resolution === v) o.setAttribute('selected', 'true');
      return o;
    })
  );
  const resolutionNote = el('textarea', { name: 'resolutionNote', rows: '2',
    placeholder: '說明判斷依據（必填若超閾值）', class: 'border rounded px-2 py-1 text-sm w-full' }, q.resolutionNote || '');
  const resolutionBlock = el('div', { class: 'mt-2 bg-red-50 border border-red-300 rounded p-2 hidden' },
    el('div', { class: 'text-xs font-semibold text-red-800 mb-1' }, '⚠️ 誤差超閾值 — 必填處置與說明'),
    el('div', { class: 'flex items-center gap-2 text-sm mb-1' },
      el('span', { class: 'w-12' }, '處置：'), resolutionSelect),
    resolutionNote
  );

  function recompute() {
    const slopeVer = parseFloat(slopeInput.value);
    const dimsVer = getDimensionsVerified();
    let areaVerH = null;
    if (getAreaVerifiedHorizontalDirect) {
      // v2.8.0：irregular 直接用 reviewer 填的水平面積（不需 cos 校正）
      areaVerH = getAreaVerifiedHorizontalDirect();
    } else if (dimsVer) {
      const areaSlope = dimensionsToArea(shape, dimsVer);
      areaVerH = computeAreaHorizontal(areaSlope, Number.isFinite(slopeVer) ? slopeVer : 0, dimType);
    }
    const errs = computeQaqcErrors(plot, { slopeVerified: slopeVer, areaVerifiedHorizontal: areaVerH }, cfg);
    const slopeOk = errs.slopeError_deg == null ? null : errs.slopeError_deg <= cfg.slopeThreshold_deg;
    const areaOk  = errs.areaError_pct == null ? null : errs.areaError_pct <= cfg.areaThreshold_pct;
    const lines = [];
    lines.push(`<b>surveyor 原值</b>：slope=${Number.isFinite(plot.slopeDegrees) ? plot.slopeDegrees.toFixed(1) + '°' : '-'} / area_h=${Number.isFinite(plot.areaHorizontal_m2) ? plot.areaHorizontal_m2.toFixed(1) + ' m²' : '-'}`);
    lines.push(`<b>reviewer 重測</b>：slope=${Number.isFinite(slopeVer) ? slopeVer.toFixed(1) + '°' : '-'} / area_h=${Number.isFinite(areaVerH) ? areaVerH.toFixed(1) + ' m²' : '-'}`);
    const slopeBadge = errs.slopeError_deg == null ? '<span class="text-stone-400">slope: 待填</span>' :
      (slopeOk ? `<span class="text-green-700">slope ±${errs.slopeError_deg.toFixed(2)}° ✅ (≤${cfg.slopeThreshold_deg}°)</span>` :
                 `<span class="text-red-700">slope ±${errs.slopeError_deg.toFixed(2)}° ❌ (>${cfg.slopeThreshold_deg}°)</span>`);
    const areaBadge = errs.areaError_pct == null ? '<span class="text-stone-400">area: 待填</span>' :
      (areaOk ? `<span class="text-green-700">area ±${errs.areaError_pct.toFixed(2)}% ✅ (≤${cfg.areaThreshold_pct}%)</span>` :
                `<span class="text-red-700">area ±${errs.areaError_pct.toFixed(2)}% ❌ (>${cfg.areaThreshold_pct}%)</span>`);
    lines.push(`<b>誤差</b>：${slopeBadge}　${areaBadge}`);
    errorBox.innerHTML = lines.join('<br>');
    // 超閾值（任一）→ 顯示處置區
    const failed = (slopeOk === false) || (areaOk === false);
    resolutionBlock.classList.toggle('hidden', !failed);
  }
  [slopeInput].forEach(i => { i.addEventListener('input', recompute); i.addEventListener('change', recompute); });
  // 重測 dimensions 各 input 一律 wire（無論 shape）
  dimsVerifiedInputs.querySelectorAll('input').forEach(i => {
    i.addEventListener('input', recompute);
    i.addEventListener('change', recompute);
  });

  const f = el('form', { class: 'space-y-3' },
    el('div', { class: 'bg-blue-50 border border-blue-200 rounded p-3 text-sm' },
      el('div', { class: 'font-semibold' }, `🔍 QAQC 重測：${plot.code}`),
      el('div', { class: 'text-xs text-stone-600 mt-1' },
        `形狀 ${({ circle: '圓', square: '方', rectangle: '矩' })[shape]} / 量測單位 ${dimType === 'slope_distance' ? '沿坡距' : '水平投影'} / 抽樣理由 ${q.sampleReason || '-'}`)
    ),
    el('div', { class: 'field' },
      el('label', {}, '重測坡度 (°)', el('span', { class: 'req' }, ' *')),
      slopeInput
    ),
    el('div', { class: 'field' },
      el('label', {}, '重測 dimensions', el('span', { class: 'req' }, ' *')),
      dimsVerifiedInputs
    ),
    errorBox,
    resolutionBlock,
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded' }, '💾 儲存重測'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消'),
      q.inSample ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-stone-600 text-xs', onclick: () => qaqcRemoveFromSample(project, plot) }, '↩️ 移出抽樣') : null
    )
  );
  recompute();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slopeVer = parseFloat(slopeInput.value);
    const dimsVer = getDimensionsVerified();
    if (!Number.isFinite(slopeVer)) { toast('請填重測坡度'); return; }
    if (!dimsVer) { toast('請填重測 dimensions'); return; }
    let areaVerH;
    if (getAreaVerifiedHorizontalDirect) {
      // v2.8.0：irregular 直接用 reviewer 填的水平面積
      areaVerH = getAreaVerifiedHorizontalDirect();
    } else {
      const areaSlope = dimensionsToArea(shape, dimsVer);
      areaVerH = computeAreaHorizontal(areaSlope, slopeVer, dimType);
    }
    const errs = computeQaqcErrors(plot, { slopeVerified: slopeVer, areaVerifiedHorizontal: areaVerH }, cfg);
    // 超閾值 → 必填 resolution + note
    if (errs.withinThreshold === false) {
      const res = resolutionSelect.value;
      const note = resolutionNote.value.trim();
      if (!res) { toast('誤差超閾值，請選擇處置（accepted / remeasured / rejected）'); return; }
      if (!note) { toast('誤差超閾值，請填處置說明'); return; }
    }
    const newQaqc = {
      ...(plot.qaqc || defaultQaqc()),
      inSample: true,  // 走完重測一定 inSample
      slopeVerified: slopeVer,
      dimensionsVerified: dimsVer,
      areaVerifiedHorizontal: areaVerH,
      verifiedAt: new Date(),
      verifiedBy: state.user.uid,
      slopeError_deg: errs.slopeError_deg,
      areaError_pct: errs.areaError_pct,
      withinThreshold: errs.withinThreshold,
    };
    if (errs.withinThreshold === false) {
      newQaqc.resolution = resolutionSelect.value;
      newQaqc.resolutionNote = resolutionNote.value.trim();
      newQaqc.resolvedAt = new Date();
      newQaqc.resolvedBy = state.user.uid;
    } else {
      // 通過 → 清掉舊處置（若有）
      newQaqc.resolution = null;
      newQaqc.resolutionNote = null;
      newQaqc.resolvedAt = null;
      newQaqc.resolvedBy = null;
    }
    try {
      await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), { qaqc: newQaqc, updatedAt: fb.serverTimestamp() });
      toast(errs.withinThreshold === false ? '已儲存（誤差超閾值，已記錄處置）' : '✅ 已儲存（誤差通過閾值）', 3500);
      closeModal();
      // QAQC tab 若開啟 → 重整
      if (typeof window.location !== 'undefined' && window.location.hash.includes('/p/')) {
        // re-render QAQC tab if active
        const qaqcSection = document.querySelector('[data-tab-content="qaqc"]:not(.hidden)');
        if (qaqcSection) {
          const tab = document.querySelector('[data-tab="qaqc"]');
          if (tab) tab.click();
        }
      }
    } catch (e) { toast('儲存失敗：' + e.message); console.error(e); }
  });
  openModal(`🔍 QAQC 重測 — ${plot.code}`, f);
}

async function qaqcRemoveFromSample(project, plot) {
  if (!confirm(`從抽樣移除「${plot.code}」？已填的重測值會清除。`)) return;
  try {
    await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id), { qaqc: defaultQaqc(), updatedAt: fb.serverTimestamp() });
    toast('已移出抽樣');
    closeModal();
  } catch (e) { toast('失敗：' + e.message); }
}

// ===== v2.8.1：立木層級 QAQC 重測 modal =====
//   reviewer / admin 對 tree.qaqc.inSample=true 的立木開此 modal 填重測值
//   存檔只動 tree.qaqc + updatedAt（受 rules hasOnly 約束）
//   超閾值時必填 resolution + resolutionNote
export async function openTreeQaqcRemeasureForm(project, plot, tree) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...(project.qaqcConfig || {}) };
  const q = tree.qaqc || defaultTreeQaqc();

  const dbhInput = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'dbhVerified',
    placeholder: 'cm', value: q.dbhVerified ?? '', class: 'border rounded px-2 py-1 text-sm w-28' });
  const hInput = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'heightVerified',
    placeholder: 'm', value: q.heightVerified ?? '', class: 'border rounded px-2 py-1 text-sm w-28' });
  const xInput = el('input', { type: 'number', step: '0.01', name: 'localXVerified',
    placeholder: cfg.requirePositionVerified ? 'm' : '可空', value: q.localXVerified ?? '', class: 'border rounded px-2 py-1 text-sm w-28' });
  const yInput = el('input', { type: 'number', step: '0.01', name: 'localYVerified',
    placeholder: cfg.requirePositionVerified ? 'm' : '可空', value: q.localYVerified ?? '', class: 'border rounded px-2 py-1 text-sm w-28' });

  const errorBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs my-2' });
  const resolutionSelect = el('select', { name: 'resolution', class: 'border rounded px-2 py-1 text-sm' },
    el('option', { value: '' }, '— 選擇處置 —'),
    ...Object.entries(RESOLUTION_LABEL).map(([v, label]) => {
      const o = el('option', { value: v }, label);
      if (q.resolution === v) o.setAttribute('selected', 'true');
      return o;
    })
  );
  const resolutionNote = el('textarea', { name: 'resolutionNote', rows: '2',
    placeholder: '說明判斷依據（必填若超閾值）', class: 'border rounded px-2 py-1 text-sm w-full' }, q.resolutionNote || '');
  const resolutionBlock = el('div', { class: 'mt-2 bg-red-50 border border-red-300 rounded p-2 hidden' },
    el('div', { class: 'text-xs font-semibold text-red-800 mb-1' }, '⚠️ 誤差超閾值 — 必填處置與說明'),
    el('div', { class: 'flex items-center gap-2 text-sm mb-1' },
      el('span', { class: 'w-12' }, '處置：'), resolutionSelect),
    resolutionNote
  );

  function recompute() {
    const verified = {
      dbhVerified: parseFloat(dbhInput.value),
      heightVerified: parseFloat(hInput.value),
      localXVerified: parseFloat(xInput.value),
      localYVerified: parseFloat(yInput.value),
    };
    const errs = computeTreeQaqcErrors(tree, verified, cfg);
    const lines = [];
    lines.push(`<b>surveyor 原值</b>：DBH ${Number.isFinite(tree.dbh_cm) ? tree.dbh_cm.toFixed(1) + ' cm' : '-'} / H ${Number.isFinite(tree.height_m) ? tree.height_m.toFixed(1) + ' m' : '-'} / (X,Y) (${Number.isFinite(tree.localX_m) ? tree.localX_m.toFixed(2) : '-'}, ${Number.isFinite(tree.localY_m) ? tree.localY_m.toFixed(2) : '-'})`);
    lines.push(`<b>reviewer 重測</b>：DBH ${Number.isFinite(verified.dbhVerified) ? verified.dbhVerified.toFixed(1) + ' cm' : '-'} / H ${Number.isFinite(verified.heightVerified) ? verified.heightVerified.toFixed(1) + ' m' : '-'} / (X,Y) (${Number.isFinite(verified.localXVerified) ? verified.localXVerified.toFixed(2) : '-'}, ${Number.isFinite(verified.localYVerified) ? verified.localYVerified.toFixed(2) : '-'})`);
    // DBH chip
    const dbhChip = (errs.dbhError_cm == null) ? '<span class="text-stone-400">DBH: 待填</span>' :
      ((errs.dbhError_cm <= cfg.dbhThreshold_cm || (errs.dbhError_pct != null && errs.dbhError_pct <= cfg.dbhThreshold_pct))
        ? `<span class="text-green-700">DBH ±${errs.dbhError_cm.toFixed(2)} cm (${errs.dbhError_pct?.toFixed(1)}%) ✅</span>`
        : `<span class="text-red-700">DBH ±${errs.dbhError_cm.toFixed(2)} cm (${errs.dbhError_pct?.toFixed(1)}%) ❌ (>${cfg.dbhThreshold_cm}cm 且 >${cfg.dbhThreshold_pct}%)</span>`);
    // 高度 chip
    const hChip = (errs.heightError_m == null) ? '<span class="text-stone-400">H: 待填</span>' :
      ((errs.heightError_m <= cfg.heightThreshold_m || (errs.heightError_pct != null && errs.heightError_pct <= cfg.heightThreshold_pct))
        ? `<span class="text-green-700">H ±${errs.heightError_m.toFixed(2)} m (${errs.heightError_pct?.toFixed(1)}%) ✅</span>`
        : `<span class="text-red-700">H ±${errs.heightError_m.toFixed(2)} m (${errs.heightError_pct?.toFixed(1)}%) ❌</span>`);
    // 位置 chip
    let posChip;
    if (errs.positionError_m == null) {
      posChip = cfg.requirePositionVerified
        ? '<span class="text-stone-400">位置: 待填（必填）</span>'
        : '<span class="text-stone-400">位置: 未填（選填）</span>';
    } else {
      posChip = (errs.positionError_m <= cfg.positionThreshold_m)
        ? `<span class="text-green-700">位置 ±${errs.positionError_m.toFixed(2)} m ✅</span>`
        : `<span class="text-red-700">位置 ±${errs.positionError_m.toFixed(2)} m ❌ (>${cfg.positionThreshold_m}m)</span>`;
    }
    lines.push(`<b>誤差</b>：${dbhChip}　${hChip}　${posChip}`);
    errorBox.innerHTML = lines.join('<br>');
    resolutionBlock.classList.toggle('hidden', errs.withinThreshold !== false);
  }
  [dbhInput, hInput, xInput, yInput].forEach(i => {
    i.addEventListener('input', recompute);
    i.addEventListener('change', recompute);
  });

  const f = el('form', { class: 'space-y-3' },
    el('div', { class: 'bg-blue-50 border border-blue-200 rounded p-3 text-sm' },
      el('div', { class: 'font-semibold' }, `🌳 立木 QAQC 重測：${tree.treeCode || '#' + (tree.treeNum || '?')}`),
      el('div', { class: 'text-xs text-stone-600 mt-1' },
        `樣區 ${plot.code} / 樹種 ${tree.speciesZh || '-'} / 抽樣理由 ${q.sampleReason || '-'}`)
    ),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', {}, '重測 DBH (cm)', el('span', { class: 'req' }, ' *')),
        dbhInput
      ),
      el('div', { class: 'field' },
        el('label', {}, '重測高度 (m)', el('span', { class: 'req' }, ' *')),
        hInput
      ),
    ),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', {}, '重測 X (m)', cfg.requirePositionVerified ? el('span', { class: 'req' }, ' *') : el('span', { class: 'text-xs text-stone-500' }, ' （選填）')),
        xInput
      ),
      el('div', { class: 'field' },
        el('label', {}, '重測 Y (m)', cfg.requirePositionVerified ? el('span', { class: 'req' }, ' *') : el('span', { class: 'text-xs text-stone-500' }, ' （選填）')),
        yInput
      ),
    ),
    errorBox,
    resolutionBlock,
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded' }, '💾 儲存重測'),
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消'),
      q.inSample ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-stone-600 text-xs',
        onclick: () => qaqcRemoveTreeFromSample(project, plot, tree) }, '↩️ 移出抽樣') : null
    )
  );
  recompute();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dbhV = parseFloat(dbhInput.value);
    const hV = parseFloat(hInput.value);
    const xV = parseFloat(xInput.value);
    const yV = parseFloat(yInput.value);
    if (!Number.isFinite(dbhV)) { toast('請填重測 DBH'); return; }
    if (!Number.isFinite(hV)) { toast('請填重測高度'); return; }
    if (cfg.requirePositionVerified && (!Number.isFinite(xV) || !Number.isFinite(yV))) {
      toast('方法學要求位置必填（重測 X / Y 都要填）'); return;
    }
    const errs = computeTreeQaqcErrors(tree, {
      dbhVerified: dbhV, heightVerified: hV,
      localXVerified: xV, localYVerified: yV
    }, cfg);
    if (errs.withinThreshold === false) {
      const res = resolutionSelect.value;
      const note = resolutionNote.value.trim();
      if (!res) { toast('誤差超閾值，請選擇處置'); return; }
      if (!note) { toast('誤差超閾值，請填處置說明'); return; }
    }
    const newQaqc = {
      ...(tree.qaqc || defaultTreeQaqc()),
      inSample: true,
      dbhVerified: dbhV,
      heightVerified: hV,
      localXVerified: Number.isFinite(xV) ? xV : null,
      localYVerified: Number.isFinite(yV) ? yV : null,
      verifiedAt: new Date(),
      verifiedBy: state.user.uid,
      dbhError_cm: errs.dbhError_cm,
      dbhError_pct: errs.dbhError_pct,
      heightError_m: errs.heightError_m,
      heightError_pct: errs.heightError_pct,
      positionError_m: errs.positionError_m,
      withinThreshold: errs.withinThreshold,
    };
    if (errs.withinThreshold === false) {
      newQaqc.resolution = resolutionSelect.value;
      newQaqc.resolutionNote = resolutionNote.value.trim();
      newQaqc.resolvedAt = new Date();
      newQaqc.resolvedBy = state.user.uid;
    } else {
      newQaqc.resolution = null;
      newQaqc.resolutionNote = null;
      newQaqc.resolvedAt = null;
      newQaqc.resolvedBy = null;
    }
    try {
      await fb.updateDoc(
        fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', tree.id),
        { qaqc: newQaqc, updatedAt: fb.serverTimestamp() }
      );
      toast(errs.withinThreshold === false ? '已儲存（誤差超閾值，已記錄處置）' : '✅ 已儲存（誤差通過閾值）', 3500);
      closeModal();
      // 若上層 sampling modal 開著 → 重整
      const samplingModal = document.querySelector('[data-tree-sampling-plot-id]');
      if (samplingModal) {
        const tab = document.querySelector('[data-tab="qaqc"]');
        if (tab) tab.click();
      }
    } catch (e) { toast('儲存失敗：' + e.message); console.error(e); }
  });
  openModal(`🌳 立木 QAQC 重測 — ${tree.treeCode || '#' + tree.treeNum}`, f);
}

async function qaqcRemoveTreeFromSample(project, plot, tree) {
  if (!confirm(`從抽樣移除立木「${tree.treeCode || '#' + tree.treeNum}」？已填的重測值會清除。`)) return;
  try {
    await fb.updateDoc(
      fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', tree.id),
      { qaqc: defaultTreeQaqc(), updatedAt: fb.serverTimestamp() }
    );
    toast('已移出抽樣');
    closeModal();
  } catch (e) { toast('失敗：' + e.message); }
}

// ===== v2.8.1：plot 內立木抽樣 modal =====
//   reviewer 對 plot.qaqc.inSample=true 的 plot 開此 modal
//   功能：列出 plot 內所有 trees + inSample / 重測狀態 chip + 隨機 / 清空抽樣 + 點 row 開重測
export async function openPlotTreeSamplingModal(project, plot) {
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...(project.qaqcConfig || {}) };
  const tableWrap = el('div', { class: 'space-y-2' });
  const summary = el('div', { class: 'text-sm' });
  const navBar = el('div', { class: 'flex flex-wrap gap-2' });

  let trees = [];

  async function reload() {
    summary.innerHTML = '<span class="text-stone-500">載入立木中...</span>';
    tableWrap.innerHTML = '';
    try {
      const snap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
      trees = [];
      snap.forEach(d => trees.push({ id: d.id, ...d.data() }));
    } catch (e) {
      summary.innerHTML = `<span class="text-red-700">載入失敗：${e.message}</span>`;
      return;
    }
    render();
  }

  function render() {
    const sampled = trees.filter(t => t.qaqc?.inSample === true);
    const target = computeTreeSampleSize(trees.length, cfg);
    summary.innerHTML = `
      <div class="flex items-center gap-3 flex-wrap">
        <span>樣區 <b>${plot.code}</b> 內立木 <b>${trees.length}</b> 棵</span>
        <span>已抽樣 <b>${sampled.length}</b> / 目標 <b>${target}</b>（${(cfg.treeSamplingFraction * 100).toFixed(0)}% × ${trees.length}，最低 ${cfg.minTreeSampleSize}）</span>
      </div>
    `;
    // 表格
    if (trees.length === 0) {
      tableWrap.innerHTML = '<div class="text-stone-500 text-sm p-2">本樣區尚無立木紀錄</div>';
      return;
    }
    const rows = trees.map(t => {
      const q = t.qaqc || {};
      const status = getTreeQaqcStatus(t);
      const meta = ({
        not_sampled:        { label: '不在抽樣',  cls: 'bg-stone-100 text-stone-600' },
        pending:            { label: '🟡 待重測',  cls: 'bg-amber-100 text-amber-800' },
        passed:             { label: '✅ 通過',    cls: 'bg-green-100 text-green-800' },
        failed_unresolved:  { label: '❌ 待處置',  cls: 'bg-red-100 text-red-800' },
        failed_resolved:    { label: '🟢 已處置',  cls: 'bg-teal-100 text-teal-800' },
      })[status] || { label: status, cls: 'bg-stone-100' };
      return `<tr class="border-b hover:bg-stone-50 cursor-pointer" data-tree-id="${t.id}">
        <td class="py-1 px-2 font-mono text-xs">${t.treeCode || '#' + (t.treeNum || '?')}</td>
        <td class="py-1 px-2">${t.speciesZh || '-'}</td>
        <td class="py-1 px-2 text-right">${Number.isFinite(t.dbh_cm) ? t.dbh_cm.toFixed(1) : '-'}</td>
        <td class="py-1 px-2 text-right">${Number.isFinite(t.height_m) ? t.height_m.toFixed(1) : '-'}</td>
        <td class="py-1 px-2 text-right">${Number.isFinite(t.localX_m) ? t.localX_m.toFixed(2) : '-'}</td>
        <td class="py-1 px-2 text-right">${Number.isFinite(t.localY_m) ? t.localY_m.toFixed(2) : '-'}</td>
        <td class="py-1 px-2"><span class="${meta.cls} text-xs px-2 py-0.5 rounded">${meta.label}</span></td>
      </tr>`;
    }).join('');
    tableWrap.innerHTML = `
      <div data-tree-sampling-plot-id="${plot.id}" class="max-h-96 overflow-y-auto border rounded">
        <table class="min-w-full text-sm">
          <thead class="bg-stone-100 text-xs sticky top-0">
            <tr>
              <th class="text-left py-1 px-2">編號</th>
              <th class="text-left py-1 px-2">樹種</th>
              <th class="text-right py-1 px-2">DBH</th>
              <th class="text-right py-1 px-2">H</th>
              <th class="text-right py-1 px-2">X</th>
              <th class="text-right py-1 px-2">Y</th>
              <th class="text-left py-1 px-2">狀態</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="text-xs text-stone-500 mt-1">點 row 開立木 QAQC 重測 modal（限抽樣立木 ⚪→🟡）。</p>
    `;
    // row click handler
    tableWrap.querySelectorAll('tr[data-tree-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const tid = tr.dataset.treeId;
        const t = trees.find(x => x.id === tid);
        if (!t) return;
        if (t.qaqc?.inSample !== true) {
          toast('該立木尚未進入抽樣 — 請先用上方「🎲 隨機抽樣」或「✋ 手動抽」標記');
          return;
        }
        openTreeQaqcRemeasureForm(project, plot, t);
      });
    });
  }

  navBar.innerHTML = '';
  const btnRandom = el('button', {
    type: 'button', class: 'bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded text-sm',
    onclick: async () => {
      const target = computeTreeSampleSize(trees.length, cfg);
      const seed = Date.now();
      const sample = pickRandomTreeSample(trees, target, seed);
      if (!confirm(`將隨機抽樣 ${sample.length} 棵立木（種子 ${seed}，可重現）：\n\n${sample.slice(0, 8).map(t => t.treeCode || '#' + t.treeNum).join('、')}${sample.length > 8 ? ` 等 ${sample.length} 棵` : ''}`)) return;
      let count = 0;
      for (const t of sample) {
        try {
          const newQaqc = { ...(t.qaqc || defaultTreeQaqc()) };
          newQaqc.inSample = true;
          newQaqc.sampledAt = new Date();
          newQaqc.sampledBy = state.user.uid;
          newQaqc.sampleReason = newQaqc.sampleReason || 'random';
          await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', t.id),
            { qaqc: newQaqc, updatedAt: fb.serverTimestamp() });
          count++;
        } catch (e) { console.warn('[tree sample]', t.treeCode, e); }
      }
      toast(`已抽樣 ${count} 棵`);
      reload();
    }
  }, '🎲 隨機抽樣');
  const btnClear = el('button', {
    type: 'button', class: 'border px-3 py-1.5 rounded text-sm hover:bg-stone-50',
    onclick: async () => {
      const sampled = trees.filter(t => t.qaqc?.inSample === true);
      if (sampled.length === 0) { toast('尚無抽樣立木'); return; }
      if (!confirm(`清空 ${sampled.length} 棵立木的抽樣標記？已填重測會清除。`)) return;
      let count = 0;
      for (const t of sampled) {
        try {
          await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', t.id),
            { qaqc: defaultTreeQaqc(), updatedAt: fb.serverTimestamp() });
          count++;
        } catch (e) { console.warn('[tree clear]', e); }
      }
      toast(`已清空 ${count} 棵抽樣標記`);
      reload();
    }
  }, '✋ 清空抽樣');
  navBar.appendChild(btnRandom);
  navBar.appendChild(btnClear);

  const wrap = el('div', { class: 'space-y-3' },
    el('div', { class: 'bg-blue-50 border border-blue-200 rounded p-3' },
      el('div', { class: 'font-semibold' }, `🌳 立木抽樣 — ${plot.code}`),
      el('div', { class: 'text-xs text-stone-600 mt-1' },
        `每抽樣 plot 內隨機抽 ~${(cfg.treeSamplingFraction * 100).toFixed(0)}% 立木重測 DBH / 高度${cfg.requirePositionVerified ? ' / 位置（必填）' : ' / 位置（選填）'}。閾值：DBH ±${cfg.dbhThreshold_cm}cm/${cfg.dbhThreshold_pct}%、H ±${cfg.heightThreshold_m}m/${cfg.heightThreshold_pct}%、位置 ±${cfg.positionThreshold_m}m。`)
    ),
    summary,
    navBar,
    tableWrap,
    el('div', { class: 'flex justify-end pt-2' },
      el('button', { type: 'button', class: 'border px-4 py-2 rounded text-sm', onclick: closeModal }, '關閉')
    )
  );
  openModal(`🌳 ${plot.code} 立木抽樣管理`, wrap);
  reload();
}

// ===== 樣區表單 =====
export async function openPlotForm(project, existing = null) {
  // v2.7.17：reviewer（非 admin）對 inSample plot 自動跳轉 QAQC 重測 modal
  //   admin god view 維持原本完整 plot 編輯權
  if (existing && existing.qaqc?.inSample === true && isReviewer() && !isSystemAdmin()) {
    return openQaqcRemeasureForm(project, existing);
  }
  const loc = existing?.location;
  const t97 = existing?.locationTWD97;
  // v1.5：套用 methodology + 警示超過目標數
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  if (!existing) {
    try {
      const ps = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
      if (meth.targetPlotCount && ps.size >= meth.targetPlotCount) {
        if (!confirm(`已達方法學目標數（${meth.targetPlotCount}）— 目前 ${ps.size} 個樣區。仍要繼續新增嗎？`)) return;
      }
    } catch {}
  }

  // ===== v2.11.11：表單訊息面板（取代 toast 用於阻擋型錯誤）=====
  // 為什麼：HTML5 native validation 失敗（required + hidden）會在 user 看不到的地方擋 submit；
  //         toast 又是閃過去的訊息容易看漏。改用持續顯示在表單頂部的訊息列。
  const formMessages = el('div', { class: 'space-y-1', style: 'display:none' });
  let _formMsgTimer = null;
  function showFormMessages(items, opts = {}) {
    if (_formMsgTimer) { clearTimeout(_formMsgTimer); _formMsgTimer = null; }
    formMessages.innerHTML = '';
    if (!items || items.length === 0) {
      formMessages.style.display = 'none';
      return;
    }
    const stylesByLevel = {
      error: { cls: 'bg-red-50 border-red-300 text-red-800',          icon: '❌' },
      warn:  { cls: 'bg-amber-50 border-amber-300 text-amber-800',    icon: '⚠️' },
      info:  { cls: 'bg-emerald-50 border-emerald-300 text-emerald-800', icon: '✅' }
    };
    items.forEach(it => {
      const s = stylesByLevel[it.level] || stylesByLevel.error;
      formMessages.appendChild(el('div', {
        class: `text-sm px-3 py-2 rounded border ${s.cls}`
      }, `${s.icon} ${it.text}`));
    });
    formMessages.style.display = '';
    formMessages.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (opts.autoHide) {
      _formMsgTimer = setTimeout(() => {
        formMessages.innerHTML = '';
        formMessages.style.display = 'none';
        _formMsgTimer = null;
      }, opts.autoHide);
    }
  }
  function clearFormMessages() {
    if (_formMsgTimer) { clearTimeout(_formMsgTimer); _formMsgTimer = null; }
    formMessages.innerHTML = '';
    formMessages.style.display = 'none';
  }

  // ===== v2.11.11：上傳 GeoJSON 時的 GPS 中心（追蹤用，讓 GPS 變動時可自動平移多邊形）=====
  // 編輯既有 irregular plot：以資料庫存的 locationTWD97 當基準（=== 該多邊形 vertices 對應的中心）
  // 新建 plot：null，等到上傳 GeoJSON 才設值
  let uploadCenterTwd97 = (existing?.shape === 'irregular' && existing?.locationTWD97
    && Number.isFinite(existing.locationTWD97.x) && Number.isFinite(existing.locationTWD97.y))
    ? { x: existing.locationTWD97.x, y: existing.locationTWD97.y }
    : null;

  // GPS 變動 → 平移多邊形以保持原地理位置（避免上傳 GeoJSON 後重新定位導致多邊形移位）
  const handleLocationChange = ({ lng, lat }) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (!uploadCenterTwd97) return;
    if (!Array.isArray(irregularVertices) || irregularVertices.length === 0) return;
    const newCenter = wgs84ToTwd97(lng, lat);
    const dx = newCenter.x - uploadCenterTwd97.x;
    const dy = newCenter.y - uploadCenterTwd97.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;  // < 0.5 m 不處理（GPS jitter）
    irregularVertices = irregularVertices.map(v => ({ x: v.x - dx, y: v.y - dy }));
    uploadCenterTwd97 = newCenter;
    if (typeof renderIrregularTable === 'function') renderIrregularTable();
    if (typeof validateAndPreviewIrregular === 'function') validateAndPreviewIrregular();
    const moved = Math.round(Math.hypot(dx, dy));
    showFormMessages([{
      level: 'info',
      text: `GPS 中心移動 ${moved} m → 已自動平移多邊形（保持實地絕對位置不變、local 座標重算）`
    }], { autoHide: 6000 });
  };

  // v2.3.6：plot GPS 用共用 helper（顯示 TWD97 + accuracy）
  // v2.10.4：destructure 多接 manualEntry（手動輸入 fallback UI）
  // v2.11.11：傳入 onLocationChange 偵測 GPS 變動 → 自動平移已上傳的多邊形
  const { gpsBtn, gpsStatus, manualEntry: gpsManualEntry, lngInput, latInput, accInput } = createGpsButton({
    initialLat: loc?.latitude ?? null,
    initialLng: loc?.longitude ?? null,
    initialAccuracy: existing?.locationAccuracy_m ?? null,
    showTwd97: true,
    onLocationChange: handleLocationChange
  });

  // v1.6：照片上傳元件
  const photoReq = !!meth.required?.photos;
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '樣區照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（≤5MB / 張，可多選）'));

  // v2.7.16：樣區幾何區塊（shape + dimensions + slope + 即時預覽）
  // v2.8.0：加 irregular（不規則多邊形）
  const dimType = meth.dimensionType || 'slope_distance';
  const dimTypeLabel = dimType === 'slope_distance' ? '沿坡距' : '水平投影';
  // v2.8.3：rectangle 提到第一個 + 預設值改 rectangle
  const shapeOptions = [
    { value: 'rectangle', label: '矩形（台灣 20×25）★' },
    { value: 'circle', label: '圓形' },
    { value: 'square', label: '方形' },
    { value: 'irregular', label: '不規則多邊形' }
  ];
  const initShape = existing?.shape || meth.plotShape || 'rectangle';

  // v2.8.0：irregular 用 vertices 陣列（local m 相對 plot 中心；3-50 頂點，CCW，simple polygon）
  let irregularVertices = (existing?.shape === 'irregular' && Array.isArray(existing?.plotDimensions?.vertices))
    ? existing.plotDimensions.vertices.map(v => Array.isArray(v) ? { x: Number(v[0]), y: Number(v[1]) } : { x: Number(v.x), y: Number(v.y) })
    : [];
  let irregularSrcInfo = null;  // 'GeoJSON: filename'

  const shapeSel = el('select', { id: 'f-shape', name: 'shape', required: 'true' },
    ...shapeOptions.map(o => {
      const opt = el('option', { value: o.value }, o.label);
      if (o.value === initShape) opt.setAttribute('selected', 'true');
      return opt;
    })
  );
  const areaSel = el('select', { id: 'f-area_m2', name: 'area_m2' },
    ...(meth.plotAreaOptions || [400, 500, 1000]).map(a => {
      const opt = el('option', { value: a }, `${a} m²`);
      if (Number(a) === Number(existing?.area_m2 || (meth.plotAreaOptions?.[0] || 500))) opt.setAttribute('selected', 'true');
      return opt;
    })
  );
  // v2.8.4：寬/長改成「自動填」— 不再 required；user 可手改（dirty flag 後不再被覆蓋）
  const widthInput = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'widthM', placeholder: '20（自動算）',
    value: existing?.plotDimensions?.width ?? '' });
  const lengthInput = el('input', { type: 'number', step: '0.1', min: '0.1', name: 'lengthM', placeholder: '25（自動算）',
    value: existing?.plotDimensions?.length ?? '' });
  // v2.8.4：dirty flag — user 手動改寬/長後不再被坡度 onChange 自動覆蓋
  let widthDirty = existing != null;   // 編輯既有 plot：寬/長已是過往值，視為 dirty
  let lengthDirty = existing != null;
  widthInput.addEventListener('input', () => { widthDirty = true; });
  lengthInput.addEventListener('input', () => { lengthDirty = true; });

  // v2.8.4：移除 slopeAspect（坡向）；slopeInput 改為雙軸 — 寬邊坡度 / 長邊坡度
  //         非 rectangle 形狀（circle/square/irregular）只顯示 width 一欄，標示為「坡度」
  //         讀取舊資料：fallback slopeWidthDeg/slopeLengthDeg = slopeDegrees
  // v2.11.20：D1 — 重新加入 slopeAspect（坡向）作為「選填」欄位 — 純視覺旋轉用，不影響面積/體積計算
  //          值為朝下坡的方位角（°）：0=N / 90=E / 180=S / 270=W；空白 = 不旋轉，rectangle 預設 N-S 對齊
  const fallbackSlope = existing?.slopeDegrees ?? '';
  const initSlopeWidth  = existing?.slopeWidthDeg  ?? fallbackSlope;
  const initSlopeLength = existing?.slopeLengthDeg ?? fallbackSlope;
  const initSlopeAspect = (existing?.slopeAspect != null) ? existing.slopeAspect : '';
  const slopeWidthInput = el('input', { type: 'number', step: '0.1', min: '0', max: '90', name: 'slopeWidthDeg',
    placeholder: '0', value: initSlopeWidth, required: 'true' });
  const slopeLengthInput = el('input', { type: 'number', step: '0.1', min: '0', max: '90', name: 'slopeLengthDeg',
    placeholder: '0', value: initSlopeLength, required: 'true' });
  const slopeAspectInput = el('input', { type: 'number', step: '1', min: '0', max: '360', name: 'slopeAspect',
    placeholder: '選填，0=北 / 90=東 / 180=南 / 270=西', value: initSlopeAspect });
  const previewBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs text-stone-700 my-1' });

  const areaSelField = el('div', { class: 'field' },
    el('label', { for: 'f-area_m2' }, `面積 (m², ${dimTypeLabel})`, el('span', { class: 'req' }, ' *')),
    areaSel
  );
  // v2.8.4：寬/長不再紅星（自動由坡度換算），標籤加「自動」hint
  const rectFields = el('div', { class: 'field-row', style: 'display:none' },
    el('div', { class: 'field' },
      el('label', { for: 'f-widthM' }, `寬 (m, ${dimTypeLabel})`,
        el('span', { style: 'font-size:10px;color:#0369a1;margin-left:4px' }, '✨ 自動')),
      widthInput
    ),
    el('div', { class: 'field' },
      el('label', { for: 'f-lengthM' }, `長 (m, ${dimTypeLabel})`,
        el('span', { style: 'font-size:10px;color:#0369a1;margin-left:4px' }, '✨ 自動')),
      lengthInput
    )
  );

  // v2.8.0：不規則多邊形區塊（表格 + GeoJSON 上傳）
  const irregularBody = el('div', { class: 'space-y-2' });
  const irregularValidation = el('div', { class: 'text-xs' });

  function renderIrregularTable() {
    irregularBody.innerHTML = '';
    const srcLine = irregularSrcInfo
      ? el('div', { class: 'text-xs text-blue-700 bg-blue-50 rounded px-2 py-1' }, `📂 來源：${irregularSrcInfo}`)
      : null;
    if (srcLine) irregularBody.appendChild(srcLine);
    const table = el('table', { class: 'w-full text-xs', style: 'border-collapse:collapse' });
    const thead = el('thead', { class: 'bg-stone-100' },
      el('tr', {},
        el('th', { class: 'p-1 text-left' }, '#'),
        el('th', { class: 'p-1 text-left' }, `X (m, 相對中心)`),
        el('th', { class: 'p-1 text-left' }, `Y (m, 相對中心)`),
        el('th', { class: 'p-1' }, '')
      )
    );
    const tbody = el('tbody', {});
    irregularVertices.forEach((v, i) => {
      const xIn = el('input', {
        type: 'number', step: '0.01', value: Number(v.x).toFixed(2),
        class: 'border rounded px-1 py-0.5 w-24 text-xs',
        oninput: (ev) => { irregularVertices[i].x = parseFloat(ev.target.value); validateAndPreviewIrregular(); }
      });
      const yIn = el('input', {
        type: 'number', step: '0.01', value: Number(v.y).toFixed(2),
        class: 'border rounded px-1 py-0.5 w-24 text-xs',
        oninput: (ev) => { irregularVertices[i].y = parseFloat(ev.target.value); validateAndPreviewIrregular(); }
      });
      const delBtn = el('button', {
        type: 'button', class: 'text-red-600 hover:bg-red-50 rounded px-2 py-0.5',
        onclick: (ev) => { ev.preventDefault(); irregularVertices.splice(i, 1); irregularSrcInfo = null; renderIrregularTable(); validateAndPreviewIrregular(); }
      }, '🗑');
      tbody.appendChild(el('tr', { class: 'border-b border-stone-200' },
        el('td', { class: 'p-1 text-stone-500' }, String(i + 1)),
        el('td', { class: 'p-1' }, xIn),
        el('td', { class: 'p-1' }, yIn),
        el('td', { class: 'p-1' }, delBtn)
      ));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    irregularBody.appendChild(table);
    const addBtn = el('button', {
      type: 'button', class: 'mt-1 border bg-stone-50 hover:bg-stone-100 px-2 py-1 rounded text-xs',
      onclick: (ev) => {
        ev.preventDefault();
        if (irregularVertices.length >= VERTEX_MAX) { toast(`已達上限 ${VERTEX_MAX} 頂點`); return; }
        irregularVertices.push({ x: 0, y: 0 });
        irregularSrcInfo = null;
        renderIrregularTable();
        validateAndPreviewIrregular();
      }
    }, '➕ 新增頂點');
    irregularBody.appendChild(addBtn);
    irregularBody.appendChild(irregularValidation);
  }

  function validateAndPreviewIrregular() {
    const v = validatePolygon(irregularVertices);
    if (!v.ok) {
      irregularValidation.innerHTML = `<span class="text-red-700">⚠️ ${v.error}</span>`;
      previewBox.innerHTML = `<span class="text-red-700">不規則多邊形：${v.error}</span>`;
      return;
    }
    const area = v.area;
    // v2.8.4：irregular 用單一坡度（slopeWidthInput；非 rectangle 形狀的雙軸都當同值）
    // v2.8.6：雙向 preview — dimType 決定顯示「水平投影」（碳計算）或「沿坡距」（現場拉皮尺）
    const slope = parseFloat(slopeWidthInput.value) || 0;
    let slopeNote = '';
    if (slope > 0) {
      const cosV = Math.cos(slope * Math.PI / 180);
      if (dimType === 'slope_distance') {
        const areaH = area * cosV;
        slopeNote = `　│　水平投影面積（碳計算用）：<b>${areaH.toFixed(1)} m²</b> <span class="text-stone-500">(× cos ${slope.toFixed(1)}° = ${cosV.toFixed(3)})</span>`;
      } else {  // dimType='horizontal' — 顯示沿坡距給 surveyor 拉皮尺參考
        const areaS = cosV > 1e-6 ? area / cosV : area;
        slopeNote = `　│　<span class="text-amber-700">沿坡距面積（現場拉皮尺）：<b>${areaS.toFixed(1)} m²</b></span> <span class="text-stone-500">(÷ cos ${slope.toFixed(1)}° = ÷${cosV.toFixed(3)})</span>`;
      }
    }
    irregularValidation.innerHTML = `<span class="text-green-700">✅ ${v.vertices.length} 頂點 / 簡單多邊形 / CCW 已校正</span>`;
    previewBox.innerHTML = `不規則多邊形（${dimTypeLabel}）：頂點 <b>${v.vertices.length}</b>　│　Shoelace 面積 <b>${area.toFixed(1)} m²</b>` + slopeNote;
  }

  // GeoJSON / Shapefile 上傳
  // v2.11.92：比照專案邊界，樣區不規則多邊形也吃 Shapefile（.zip 或多選 .shp/.shx/.dbf/.prj）。
  //   轉出的 GeoJSON 走既有那條路（looksLikeProjectBoundary 防呆 → parseGeoJsonPolygon
  //   → local 座標 → VERTEX_MAX 檢查），所以樣區這邊的所有既有防呆一條都沒少。
  const geoFileInput = el('input', {
    type: 'file',
    accept: `.geojson,.json,application/geo+json,application/json,${SHAPEFILE_ACCEPT}`,
    multiple: 'true',
    class: 'text-xs',
  });
  geoFileInput.addEventListener('change', async () => {
    const files = Array.from(geoFileInput.files || []);
    if (files.length === 0) return;
    const preNotes = [];      // Shapefile 解析提醒（編碼偵測 / 缺 .prj…），併進最後那則訊息一起顯示
    try {
      let json, srcName;
      if (looksLikeShapefile(files)) {
        const { geojson, meta } = await shapefileFilesToGeoJson(files);
        json = geojson;
        srcName = files.length === 1 ? files[0].name : meta.layers.join('、');
        for (const n of meta.notes) preNotes.push({ level: 'info', text: n });
      } else {
        if (files.length > 1) toast('GeoJSON 只會採用第一個檔案：' + files[0].name);
        srcName = files[0].name;
        json = JSON.parse(await files[0].text());
      }
      // v2.11.52：UX 防呆 — 偵測「這檔看起來是專案邊界、不是樣區」並建議改去專案邊界上傳
      //   原本只在頂點 > VERTEX_MAX 時 toast 一行，使用者常分不清「樣區」「專案邊界」差異
      //   ＿觸發條件（任一即提示）：FeatureCollection > 1 feature / MultiPolygon 多 polygon / 頂點 > 50 / bbox 跨度 > 500 m
      const susp = looksLikeProjectBoundary(json);
      if (susp.suspect) {
        const ok = confirm(
          '⚠️ 這個檔看起來是「專案邊界 / 計畫區 / 林班 / 作業單元」，不像「樣區」：\n\n' +
          susp.reasons.map(r => '・' + r).join('\n') +
          '\n\n樣區（plot）= 固定面積的調查樣點（通常 < 50 頂點、< 100 m 邊長）\n' +
          '專案邊界 = 整個計畫區（支援 MultiPolygon、無頂點上限）\n\n' +
          '建議：取消這次上傳 → 回主畫面按「編輯專案」→ 在「📐 專案邊界（GeoJSON / Shapefile，選填）」上傳同一檔案\n\n' +
          '仍要以樣區方式繼續嘗試嗎？（多數情況會被頂點上限擋下）'
        );
        if (!ok) {
          geoFileInput.value = '';
          return;
        }
      }
      // GPS 是否已設？
      const lng = parseFloat(lngInput.value);
      const lat = parseFloat(latInput.value);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        showFormMessages([{ level: 'error', text: '請先設定樣區 GPS（解析邊界時要計算 local 偏移）' }]);
        return;
      }
      const center = wgs84ToTwd97(lng, lat);
      const result = parseGeoJsonPolygon(json, center, twd97ToWgs84, wgs84ToTwd97);
      if (result.vertices.length > VERTEX_MAX) {
        showFormMessages([{ level: 'error', text: `頂點數 ${result.vertices.length} 超過上限 ${VERTEX_MAX} — 此檔看似專案邊界，請改去「編輯專案 → 📐 專案邊界」上傳` }]);
        return;
      }
      irregularVertices = result.vertices.map(v => ({ x: v.x, y: v.y }));
      irregularSrcInfo = `${srcName}（${result.srcSystem}，${result.vertices.length} 頂點）`;
      // v2.11.11：記錄上傳當下的 GPS 中心，之後若 user 重新定位 GPS 可自動平移多邊形
      uploadCenterTwd97 = { x: center.x, y: center.y };
      renderIrregularTable();
      validateAndPreviewIrregular();
      // v2.11.11：警示多邊形跟 GPS 中心距離（合理應小於 200 m，超過提示可能 GPS 設錯位置）
      const v = validatePolygon(irregularVertices);
      const msgs = [...preNotes, { level: 'info', text: `已從 ${srcName} 載入 ${result.vertices.length} 頂點（${result.srcSystem}）` }];
      if (v.ok) {
        const cx = v.vertices.reduce((s, p) => s + p.x, 0) / v.vertices.length;
        const cy = v.vertices.reduce((s, p) => s + p.y, 0) / v.vertices.length;
        const distFromCenter = Math.hypot(cx, cy);
        if (distFromCenter > 200) {
          msgs.push({
            level: 'warn',
            text: `多邊形重心離 GPS 中心 ${Math.round(distFromCenter)} m，超過合理範圍（< 200 m）— 請確認 GPS 是否設在樣區附近。儲存時會以 GPS 為中心、多邊形 local 座標保留現值。`
          });
        }
      }
      showFormMessages(msgs, { autoHide: 8000 });
    } catch (e) {
      showFormMessages([{ level: 'error', text: '邊界檔解析失敗：' + e.message }]);
      console.error('[plot boundary]', e);
    }
    geoFileInput.value = '';  // reset for re-upload
  });

  // v2.11.12：GPS 量測位置說明改用 SVG 圖示（取代 v2.11.11 的冗長文字 + 表格 — 大幅縮減 forms.js 體積）
  //          圖檔位置：pwa/img/gps-position-guide.svg（向量、~19 KB），點圖可開新分頁放大 / 列印 A4
  const gpsHelpDetails = el('details', {
    class: 'text-xs bg-white border border-stone-200 rounded p-2 mb-2',
    style: 'cursor:default'
  },
    el('summary', {
      class: 'cursor-pointer font-medium text-stone-700 hover:text-stone-900',
      style: 'user-select:none'
    }, '💡 GPS 應該量在多邊形的什麼位置？（點開看圖）'),
    el('div', { class: 'mt-2' },
      el('a', {
        href: './img/gps-position-guide.svg?v=21193',
        target: '_blank',
        rel: 'noopener',
        class: 'block',
        title: '點圖可開新分頁放大檢視 / 列印 A4'
      },
        el('img', {
          src: './img/gps-position-guide.svg?v=21193',
          alt: '多邊形樣區 GPS 量測位置野外操作指南：30 秒概念、內部幾何 vs 絕對位置、4 種來源情境（RTK/手機/PSP/臨時）、量錯救援流程',
          class: 'w-full h-auto rounded border border-stone-200',
          loading: 'lazy'
        })
      ),
      el('div', { class: 'text-stone-500 mt-1', style: 'font-size:10px' },
        '↑ 點圖可開新分頁放大／列印 A4'
      )
    )
  );

  const irregularFields = el('div', { class: 'field', style: 'display:none;background:#fefce8;border:1px solid #fde047;border-radius:6px;padding:8px' },
    el('div', { class: 'flex items-center justify-between gap-2 mb-2' },
      el('span', { style: 'font-weight:600;font-size:13px' }, `🗺️ 不規則多邊形邊界 (${VERTEX_MIN}–${VERTEX_MAX} 頂點)`),
      el('label', { class: 'border px-2 py-1 rounded text-xs cursor-pointer hover:bg-stone-50', title: '上傳 GeoJSON，或 Shapefile（.zip / 多選 .shp+.dbf+.prj）— 自動偵測 WGS84 / TWD97、轉成 local m' },
        '📂 GeoJSON / Shapefile 上傳', geoFileInput
      )
    ),
    gpsHelpDetails,                       // v2.11.11：GPS 量測位置說明（折疊式）
    el('div', { class: 'text-xs text-stone-600 mb-1' },
      `頂點以「local meters 相對 plot.locationTWD97」儲存。系統會自動：去重連續點 / 強制 CCW / 自交檢查 / 算 Shoelace 面積。`
    ),
    irregularBody
  );
  renderIrregularTable();

  const slopeSourceInit = existing?.slopeSource || (existing?.slopeDegrees != null ? 'field' : '');
  const slopeSourceWrap = el('div', { class: 'flex flex-wrap gap-3 text-xs' },
    ...[
      { v: '', label: '未設定' },
      { v: 'field', label: '野外斜度計' },
      { v: 'dem', label: 'DEM 推導' },
      { v: 'dem_field_avg', label: '兩者平均' }
    ].map(({ v, label }) => el('label', { style: 'cursor:pointer' },
      el('input', {
        type: 'radio', name: 'slopeSource', value: v,
        style: 'vertical-align:middle;margin-right:4px',
        ...(slopeSourceInit === v ? { checked: 'true' } : {})
      }),
      label
    ))
  );

  // v2.8.4：方法學名目尺寸（水平）— 目前 hardcode 20×25（rectangle 台灣永久樣區）；
  //         未來 methodology.plotDimensions 加入後可改讀 meth.plotDimensions
  const NOMINAL_W_HORIZ = 20;
  const NOMINAL_L_HORIZ = 25;

  // v2.8.4：雙軸坡度 row — rectangle 顯示「寬邊坡度 / 長邊坡度」雙欄；其他形狀隱藏 length 欄並改 width label 為「坡度」
  //         label 用 createTextNode 以便 recompute 動態切換文案
  //         注意：宣告必須在 recompute 之前（雖然 JS 函式 hoisting 讓引用安全，但靜態可讀性差）
  const slopeWidthLabel = document.createTextNode('寬邊坡度 (°)');
  const slopeWidthField = el('div', { class: 'field' },
    el('label', { for: 'f-slopeWidthDeg' }, slopeWidthLabel,
      el('span', { class: 'req' }, ' *'),
      el('span', { style: 'font-size:11px;color:#57534e' }, '　0–90')),
    slopeWidthInput
  );
  const slopeLengthField = el('div', { class: 'field' },
    el('label', { for: 'f-slopeLengthDeg' }, '長邊坡度 (°)',
      el('span', { class: 'req' }, ' *'),
      el('span', { style: 'font-size:11px;color:#57534e' }, '　0–90')),
    slopeLengthInput
  );
  // v2.11.20：D1 — 坡向（朝下坡方位角）— 只給地圖視覺旋轉用，不影響任何計算
  const slopeAspectField = el('div', { class: 'field' },
    el('label', { for: 'f-slopeAspect' }, '坡向（°，選填）',
      el('span', { style: 'font-size:11px;color:#57534e' }, '　0=北 / 90=東 / 180=南 / 270=西')),
    slopeAspectInput,
    el('div', { style: 'font-size:11px;color:#0369a1;margin-top:2px' },
      '🧭 朝下坡方位角；只用於地圖將矩形/方形樣區邊界旋轉到正確方向，不影響面積/體積計算。空白 = N-S 對齊。')
  );
  // v2.8.5：auto-fill hint — recompute() 會依 shape 切換 display；circle/irregular 沒寬/長故隱藏
  const autofillHint = el('div', { style: 'font-size:11px;color:#0369a1;margin:-4px 0 4px' },
    '✨ 輸入兩邊坡度 → 自動換算寬/長（沿坡距）。若需手動覆蓋，直接編輯寬/長欄位即可。'
  );

  function recompute() {
    const shape = shapeSel.value;
    // v2.8.5：square 比照 rectangle 走雙軸坡度（寬/長坡度 + 寬/長 inputs auto-fill）
    //         circle / irregular 維持單軸坡度（只顯示「坡度」一欄）
    const isDualSlopeShape = shape === 'rectangle' || shape === 'square';
    rectFields.style.display = isDualSlopeShape ? '' : 'none';
    irregularFields.style.display = shape === 'irregular' ? '' : 'none';
    // square 仍顯示面積 dropdown（user 選水平名目面積）；rectangle 用 hardcoded 20×25 故隱藏；irregular 由 vertices 算故隱藏
    areaSelField.style.display = (shape === 'rectangle' || shape === 'irregular') ? 'none' : '';
    slopeLengthField.style.display = isDualSlopeShape ? '' : 'none';
    // 同步切換 required，避免 hidden input 仍被 HTML5 native validation 卡住 submit
    // （症狀：Console 噴 "An invalid form control with name='slopeLengthDeg' is not focusable."）
    slopeLengthInput.required = isDualSlopeShape;
    slopeWidthLabel.textContent = isDualSlopeShape ? '寬邊坡度 (°)' : '坡度 (°)';
    autofillHint.style.display = isDualSlopeShape ? '' : 'none';
    // v2.11.20 D1：坡向只在 rectangle/square/irregular 顯示（circle 圓形旋轉無意義）
    slopeAspectField.style.display = (shape === 'circle') ? 'none' : '';

    if (shape === 'irregular') {
      validateAndPreviewIrregular();
      return;
    }

    // v2.8.6：auto-fill 解除 dimType gate — 兩種 methodology 都自動填
    //   dimType='slope_distance': storage = 沿坡距 = nominal / cos(slope)；填值依坡度而變
    //   dimType='horizontal':     storage = 水平 = nominal 直接；填值不受坡度影響
    //   dirty flag：user 手改寬/長後就不再自動覆蓋
    if (isDualSlopeShape) {
      const nominalW = shape === 'rectangle' ? NOMINAL_W_HORIZ : Math.sqrt(parseInt(areaSel.value, 10) || 500);
      const nominalL = shape === 'rectangle' ? NOMINAL_L_HORIZ : nominalW;  // square: 水平名目寬=長
      const sW_in = parseFloat(slopeWidthInput.value);
      const sL_in = parseFloat(slopeLengthInput.value);
      const bothSlopesIn = Number.isFinite(sW_in) && Number.isFinite(sL_in);
      let targetW, targetL;
      if (dimType === 'slope_distance' && bothSlopesIn) {
        const sd = nominalToSlopeDistance(nominalW, nominalL, sW_in, sL_in);
        targetW = sd.widthSlope;
        targetL = sd.lengthSlope;
      } else {
        // dimType='horizontal' OR 沒填齊坡度 → 填水平名目（slope-independent）
        targetW = nominalW;
        targetL = nominalL;
      }
      if (!widthDirty)  widthInput.value  = targetW.toFixed(2);
      if (!lengthDirty) lengthInput.value = targetL.toFixed(2);
    }

    let area = NaN;
    if (isDualSlopeShape) {
      const w = parseFloat(widthInput.value);
      const l = parseFloat(lengthInput.value);
      if (Number.isFinite(w) && Number.isFinite(l) && w > 0 && l > 0) area = w * l;
    } else {
      area = parseInt(areaSel.value, 10);
    }
    // v2.8.4 / v2.8.5：cos 校正 — rectangle/square 雙軸；circle/irregular 單軸
    const sWraw = parseFloat(slopeWidthInput.value);
    const sLraw = parseFloat(slopeLengthInput.value);
    const sW = Number.isFinite(sWraw) ? sWraw : 0;
    const sL = isDualSlopeShape
      ? (Number.isFinite(sLraw) ? sLraw : 0)
      : sW;  // 單軸：sL 不參與校正，這裡只是 placeholder
    const allSlopesEntered = isDualSlopeShape
      ? (Number.isFinite(sWraw) && Number.isFinite(sLraw))
      : Number.isFinite(sWraw);
    // v2.8.6：雙向 area 換算（依 dimType）— 給 preview 顯示「另一邊」資訊
    let areaH, areaSlope;
    if (dimType === 'slope_distance') {
      areaH = isDualSlopeShape
        ? computeAreaHorizontal2D(area, sW, sL, dimType)
        : computeAreaHorizontal(area, sW, dimType);
      areaSlope = area;  // storage 已是沿坡距
    } else {  // dimType='horizontal'
      areaH = area;  // storage 已是水平
      areaSlope = isDualSlopeShape
        ? computeAreaSlope2D(area, sW, sL)
        : computeAreaSlope(area, sW);
    }

    if (Number.isFinite(area) && area > 0) {
      const lines = [`名目面積（${dimTypeLabel}）：<b>${area.toFixed(1)} m²</b>`];
      // v2.8.6：依 dimType 顯示「另一邊」 — slope_distance 顯示水平投影、horizontal 顯示沿坡距
      if (allSlopesEntered && (sW > 0 || sL > 0)) {
        const cosFormula = isDualSlopeShape
          ? `cos ${sW.toFixed(1)}° × cos ${sL.toFixed(1)}° = ${(Math.cos(sW * Math.PI/180) * Math.cos(sL * Math.PI/180)).toFixed(3)}`
          : `cos ${sW.toFixed(1)}° = ${Math.cos(sW * Math.PI/180).toFixed(3)}`;
        if (dimType === 'slope_distance') {
          lines.push(`水平投影面積（碳計算用）：<b>${areaH.toFixed(1)} m²</b> <span class="text-stone-500">(× ${cosFormula})</span>`);
        } else {
          lines.push(`<span class="text-amber-700">沿坡距面積（現場拉皮尺）：<b>${areaSlope.toFixed(1)} m²</b></span> <span class="text-stone-500">(÷ ${cosFormula})</span>`);
        }
      }
      // v2.8.6：rectangle/square + dimType='horizontal' + 坡度齊 → 額外顯示「現場拉皮尺」單邊長度
      if (isDualSlopeShape && dimType === 'horizontal' && allSlopesEntered && (sW > 0 || sL > 0)) {
        const wH = parseFloat(widthInput.value) || 0;
        const lH = parseFloat(lengthInput.value) || 0;
        const wSlope = sW > 0 ? wH / Math.cos(sW * Math.PI / 180) : wH;
        const lSlope = sL > 0 ? lH / Math.cos(sL * Math.PI / 180) : lH;
        lines.push(`<span class="text-amber-700">現場拉皮尺：寬 <b>${wSlope.toFixed(2)}</b> m / 長 <b>${lSlope.toFixed(2)}</b> m（surveyor 沿坡實際拉的長度）</span>`);
      }
      // 驗算（rectangle/square）
      if (isDualSlopeShape && allSlopesEntered && areaH > 0) {
        const nominalW = shape === 'rectangle' ? NOMINAL_W_HORIZ : Math.sqrt(parseInt(areaSel.value, 10) || 500);
        const nominalL = shape === 'rectangle' ? NOMINAL_L_HORIZ : nominalW;
        const nominalArea = nominalW * nominalL;
        const okDelta = Math.abs(areaH - nominalArea);
        const checkmark = okDelta < 1 ? ' ✓' : '';
        const dimLabel = shape === 'rectangle'
          ? `${NOMINAL_W_HORIZ}×${NOMINAL_L_HORIZ}`
          : `${nominalW.toFixed(2)}×${nominalL.toFixed(2)}`;
        lines.push(`<span class="text-emerald-700">驗算：水平 ${dimLabel} = ${nominalArea.toFixed(0)} m² 名目${checkmark}</span>`);
      }
      previewBox.innerHTML = lines.join('<br>');
    } else {
      previewBox.innerHTML = '<span class="text-stone-400">填完幾何 / 坡度後，下方會即時顯示換算結果</span>';
    }
  }
  // v2.8.5：shape 切換時 reset dirty + 清寬/長 — 必須在 recompute listener 之前註冊
  //         這樣 user 切 rectangle ↔ square 時 auto-fill 會用新形狀的名目重算
  shapeSel.addEventListener('change', () => {
    if (existing == null) {
      widthDirty = false;
      lengthDirty = false;
      widthInput.value = '';
      lengthInput.value = '';
    }
  });
  [shapeSel, areaSel, widthInput, lengthInput, slopeWidthInput, slopeLengthInput].forEach(i => {
    i.addEventListener('input', recompute);
    i.addEventListener('change', recompute);
  });

  const geomBlock = el('div', { class: 'field', style: 'background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px' },
    el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' },
      `🗺️ 樣區幾何 + 雙軸坡度（v2.9.1）　`,
      el('span', { style: 'font-size:11px;color:#166534;font-weight:400' }, `量測單位 = ${dimTypeLabel}（方法學設定）`)
    ),
    el('div', { class: 'field' },
      el('label', { for: 'f-shape' }, '形狀', el('span', { class: 'req' }, ' *')),
      shapeSel
    ),
    areaSelField,
    rectFields,
    irregularFields,
    el('div', { class: 'field-row' },
      slopeWidthField,
      slopeLengthField
    ),
    autofillHint,
    slopeAspectField,        // v2.11.20 D1：坡向（選填，視覺旋轉用）
    el('div', { class: 'field' },
      el('label', {}, '坡度來源'),
      slopeSourceWrap
    ),
    previewBox
  );

  // v2.11.11：novalidate 關閉 HTML5 native validation，改用 JS 集中驗證 + formMessages 顯示
  //   起因：hidden 但 required 的 input 會讓 native validation 卡住 submit 卻不顯示錯誤
  //         （Console: "An invalid form control with name='X' is not focusable"）
  const f = el('form', { class: 'space-y-2', novalidate: 'true' },
    formMessages,                       // v2.11.11：訊息面板放最頂端
    field({ label: '樣區編號', name: 'code', required: true, value: existing?.code || '', placeholder: `${project.code}-001` }),
    field({ label: '林班-小班', name: 'forestUnit', value: existing?.forestUnit || '', placeholder: '123-2' }),
    el('div', { class: 'field' },
      el('label', {}, 'GPS 座標 ', el('span', { class: 'req' }, '*')),
      el('div', { class: 'flex items-center flex-wrap gap-2' }, gpsBtn, gpsStatus),
      gpsManualEntry,                   // v2.10.4：手動輸入 fallback
      lngInput, latInput, accInput
    ),
    // v2.11.28：立木定位模式（樣區級設定 — 預設 offset 向後相容）
    //   offset = 皮尺 X/Y（適合森林 0.05 ha 樣區）
    //   gps    = 立木直接量測 GPS（適合公園 / 大面積普查 / 平地林）
    //   mixed  = 兩種都允許，每棵樹建立時 surveyor 自選
    el('div', { class: 'field', style: 'background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px' },
      el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:4px' },
        '🧭 立木定位模式',
        el('span', { class: 'text-xs text-stone-500 ml-1' }, '（v2.11.28 / 影響此樣區所有立木）')),
      el('div', { class: 'text-xs text-stone-700 mb-2' },
        '森林 0.05 ha 樣區建議「皮尺偏移」；公園 / 大面積普查建議「GPS 量測」；不確定請選「混合」。'),
      (() => {
        const initPosMode = existing?.positionMode || 'offset';
        const opts = [
          { v: 'offset', label: '📐 皮尺偏移（X/Y）', hint: '距樣區原點' },
          { v: 'gps',    label: '📍 GPS 直接量測',    hint: '每棵樹各自定位' },
          { v: 'mixed',  label: '🔀 混合',             hint: '兩種都允許' }
        ];
        // v2.11.50：根因＝全域 .field input{width:100%;padding;border}（style.css）也套到這裡的 radio，
        //   使 radio 撐滿整列、圓圈置中、CJK 標籤被擠成逐字直書。修：radio 用 inline style 覆蓋
        //   （width:auto / flex:0 0 auto / 無 padding / 無 border），標籤靠左、可自然換行收在黃框內。
        return el('div', { class: 'space-y-2' },
          ...opts.map(o => el('label', { class: 'flex items-start gap-2 cursor-pointer text-sm', style: 'text-align:left' },
            el('input', { type: 'radio', name: 'positionMode', value: o.v,
              style: 'width:auto;min-width:0;flex:0 0 auto;margin:3px 0 0 0;padding:0;border:0',
              ...(o.v === initPosMode ? { checked: 'true' } : {}) }),
            el('span', {}, o.label,
              el('span', { class: 'text-xs text-stone-500 ml-1' }, `（${o.hint}）`))
          ))
        );
      })()
    ),
    geomBlock,
    field({ label: '設置日期', name: 'establishedAt', type: 'date', required: true, value: existing?.establishedAt ? (existing.establishedAt.toDate ? existing.establishedAt.toDate() : new Date(existing.establishedAt)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deletePlot(project, existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  recompute();  // 初始預覽

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    // v2.11.11：所有阻擋型錯誤統一收集到 errors[]，submit 時一次顯示在 formMessages
    const errors = [];
    const lng = parseFloat(fd.get('lng'));
    const lat = parseFloat(fd.get('lat'));
    if (!lng || !lat) errors.push('請先抓取 GPS（或手動輸入座標）');
    // 樣區編號
    const code = (fd.get('code') || '').trim();
    if (!code) errors.push('請填樣區編號');
    // 設置日期
    if (!fd.get('establishedAt')) errors.push('請選擇設置日期');
    // v1.6：照片 required 驗證
    if (photoReq && photoUp.count === 0) errors.push('方法學要求至少一張樣區照片');

    // v2.7.16 / v2.8.0：幾何 + 坡度 — 算 area + plotDimensions + areaHorizontal_m2
    const shape = fd.get('shape');
    let area_m2, plotDimensions;
    if (shape === 'rectangle' || shape === 'square') {
      // v2.8.5：square 比照 rectangle 走雙軸 — 寬/長 inputs（auto-fill 自坡度 + 名目）
      const w = parseFloat(fd.get('widthM'));
      const l = parseFloat(fd.get('lengthM'));
      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(l) || l <= 0) {
        errors.push(`${shape === 'rectangle' ? '矩形' : '方形'}樣區需填寬與長（> 0）`);
      } else {
        area_m2 = w * l;
        if (shape === 'square') {
          // square 額外保留 side（水平名目側邊，從 areaSel 推出）以維持向後相容下游讀取
          const nominalArea = parseInt(fd.get('area_m2'), 10) || (w * l);
          plotDimensions = { side: Math.sqrt(nominalArea), width: w, length: l };
        } else {
          plotDimensions = { width: w, length: l };
        }
      }
    } else if (shape === 'irregular') {
      // v2.8.0：不規則多邊形 — strict 驗證 + Shoelace 面積
      const v = validatePolygon(irregularVertices);
      if (!v.ok) {
        errors.push('不規則多邊形驗證失敗：' + v.error);
      } else {
        area_m2 = v.area;
        const bbox = computeBbox(v.vertices);
        plotDimensions = {
          vertices: v.vertices,           // [{x,y},...] CCW + 去重後
          bbox,                            // { minX, maxX, minY, maxY }
        };
        if (irregularSrcInfo) plotDimensions.sourceInfo = irregularSrcInfo;
      }
    } else if (shape === 'circle') {
      area_m2 = parseInt(fd.get('area_m2'), 10);
      plotDimensions = { radius: Math.sqrt(area_m2 / Math.PI) };
    }
    // v2.8.5：square 已併入上面 rectangle/square 分支；舊「else { square }」分支移除
    // v2.8.4 / v2.8.5：雙軸坡度 — rectangle/square 兩個 input；circle/irregular 只取 width 並複製給 length
    const isDualSlopeShape = shape === 'rectangle' || shape === 'square';
    const slopeWidthRaw  = parseFloat(fd.get('slopeWidthDeg'));
    const slopeLengthRaw = parseFloat(fd.get('slopeLengthDeg'));
    if (!Number.isFinite(slopeWidthRaw)) {
      errors.push(isDualSlopeShape ? '請填寬邊坡度' : '請填坡度');
    }
    if (isDualSlopeShape && !Number.isFinite(slopeLengthRaw)) {
      errors.push('請填長邊坡度');
    }

    // v2.11.11：errors 收集完 → 一次顯示，return 前不再做後續處理
    if (errors.length > 0) {
      showFormMessages(errors.map(t => ({ level: 'error', text: t })));
      return;
    }
    clearFormMessages();

    const t97 = wgs84ToTwd97(lng, lat);
    const slopeWidthDeg  = slopeWidthRaw;
    const slopeLengthDeg = isDualSlopeShape ? slopeLengthRaw : slopeWidthRaw;
    // 主坡度（向後相容下游：QAQC error / analytics / 碳計算）= 長邊坡度
    const slopeFinal = slopeLengthDeg;
    const slopeSourceRaw = fd.get('slopeSource');
    // v2.8.5：areaH 計算 — rectangle/square 雙軸；circle/irregular 單軸
    const areaHorizontal_m2 = isDualSlopeShape
      ? computeAreaHorizontal2D(area_m2, slopeWidthDeg, slopeLengthDeg, dimType)
      : computeAreaHorizontal(area_m2, slopeWidthDeg, dimType);
    // v2.11.28：立木定位模式（offset / gps / mixed；舊資料 fallback 'offset'）
    const positionModeRaw = fd.get('positionMode');
    const positionMode = ['offset', 'gps', 'mixed'].includes(positionModeRaw) ? positionModeRaw : 'offset';
    const data = {
      code: fd.get('code').trim(),
      forestUnit: fd.get('forestUnit').trim() || null,
      location: new fb.GeoPoint(lat, lng),
      locationTWD97: { x: t97.x, y: t97.y },
      locationAccuracy_m: parseFloat(fd.get('accuracy')) || null,
      positionMode,                     // v2.11.28：立木定位模式
      shape,
      area_m2,
      // v2.7.16 / v2.8.4：新欄位
      plotDimensions,
      slopeDegrees: slopeFinal,
      slopeWidthDeg,                  // v2.8.4：寬邊坡度
      slopeLengthDeg,                 // v2.8.4：長邊坡度
      // v2.11.20 D1：坡向重新啟用（選填，純視覺旋轉用）— 空字串 / 非數字 → null
      slopeAspect: (() => {
        const raw = (fd.get('slopeAspect') || '').toString().trim();
        if (!raw) return null;
        const v = parseFloat(raw);
        if (!Number.isFinite(v)) return null;
        // normalize 0-360
        return ((v % 360) + 360) % 360;
      })(),
      slopeSource: slopeSourceRaw || null,
      areaHorizontal_m2,
      dimensionType: dimType,
      migrationPending: false,  // 走過 v2.7.16+ 表單 → 不再 pending
      establishedAt: new Date(fd.get('establishedAt')),
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp(),
      // v2.11.94：移除 insideBoundary 硬編 true（註解寫「對林班界做點面套疊」但從未實作）。
      //   界內／界外改由 analytics.getPlotBoundaryStatus() 即時套疊專案邊界，不落地欄位。
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      // v1.6：先建/更新 plot 取得 id，再上傳照片，最後寫回 photos URL
      let plotId;
      if (existing) {
        plotId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        data.qaqc = defaultQaqc();  // v2.7.17：新 plot 帶 QAQC 預設子結構
        const ref = await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots'), data);
        plotId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({ projectId: project.id, plotId, prefix: 'plot' });
        await fb.updateDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId), { photos });
      }
      // v2.11.28：編輯既有 plot 後同步 state.plot 記憶體（避免下次 openTreeForm 讀到 stale 欄位）
      // 舊系統 state.plot 只在進入 plot detail 頁時 getDoc 一次、無 onSnapshot 訂閱 → 改 positionMode 後新立木看不到 GPS UI
      if (existing && state.plot?.id === plotId) {
        try {
          const fresh = await fb.getDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plotId));
          if (fresh.exists()) state.plot = { id: plotId, ...fresh.data() };
        } catch (e) { console.warn('[v2.11.28 refresh state.plot after edit]', e); }
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      // v2.11.11：Firestore 失敗也用 panel 顯示（帶 error code 方便 debug）
      const errCode = e.code ? ` [${e.code}]` : '';
      showFormMessages([{ level: 'error', text: `儲存失敗${errCode}：${e.message}` }]);
      console.error('[plot save]', e);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? '編輯樣區' : '新樣區', f);
}

// v1.5.1 bug #3：surveyor 修正自己被 flag/reject 的資料 → 自動回 pending
// 保留 qaComment 給 dataManager 看歷史
// v2.3：return boolean 讓 caller 知道是否觸發了 reset，以便接著跑專案層狀態機
function applySurveyorReQaReset(data, existing) {
  if (!existing) return false;
  if (existing.createdBy !== state.user.uid) return false;
  // v2.11.90：加入 'verified' — 調查者修改「已審核通過」的自建項目時，自動退回 pending 重新送審
  //   （原僅 flagged/rejected 會退回；verified 被改卻仍掛 verified＝MRV 可查證性漏洞）。
  //   markQA 驗證只設 qaStatus/qaMarkedBy/qaMarkedAt/qaComment(=''），本函式清前三者即乾淨閉環；
  //   存檔 toast 會自動顯示「已更新（重新送審）」，調查者即知已退回。
  //   註：專案整案 verified 後會 locked，surveyor 根本開不了表單（client+rules 雙擋）→ 此路徑只在
  //   「專案未鎖定、但個別項目已 verified」時觸發，退回後 maybeDemoteAfterReset 處理狀態機連動。
  if (!['flagged', 'rejected', 'verified'].includes(existing.qaStatus)) return false;
  data.qaStatus = 'pending';
  data.qaMarkedBy = null;
  data.qaMarkedAt = null;
  return true;
}

// v2.3：surveyor reset 後若 project.status='review' 退回 active + auto-unlock
async function maybeDemoteAfterReset(project, didReset) {
  if (!didReset) return;
  try {
    const result = await applyStatusAfterSurveyorReset(project, true);
    if (result === 'demoted-active') {
      toast('▶ 專案自動退回「進行中」（已解除鎖定）', 4000);
      setTimeout(() => location.reload(), 1800);
    }
  } catch (e) { console.warn('[v2.3 surveyor reset status] failed', e); }
}

async function deletePlot(project, plot) {
  if (!confirm(`確定刪除樣區 ${plot.code}？子項立木與更新記錄會殘留（v1 限制）`)) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id));
    toast('已刪除');
    closeModal();
    location.hash = `#/p/${project.id}`;
  } catch (e) { toast('刪除失敗：' + e.message); }
}

// ===== 立木表單 =====
// v2.3.3：個體編號自動帶 plotCode + 下一個未用流水號（DEMO-010-001 格式）
//   - prefix 顯示 plot.code-（唯讀），右側 input 預設下一個流水號
//   - 編輯既有：保留原 treeNum，prefix 仍顯示但不可改
//   - submit 寫入 treeCode（完整字串）+ treeNum（流水號 number）
export async function openTreeForm(project, plot, existing = null) {
  // v2.8.1：reviewer（非 admin）對 inSample 立木自動跳轉 QAQC 重測 modal
  //   admin god view 維持原本完整 tree 編輯權
  if (existing && existing.qaqc?.inSample === true && isReviewer() && !isSystemAdmin()) {
    return openTreeQaqcRemeasureForm(project, plot, existing);
  }
  // v2.3.3：算下一個未用流水號（query 同 plot 已存在的 trees）
  let nextNum = 1;
  if (!existing) {
    try {
      const ts = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
      const usedNums = ts.docs.map(d => parseInt(d.data().treeNum, 10)).filter(n => Number.isFinite(n));
      nextNum = usedNums.length ? Math.max(...usedNums) + 1 : 1;
    } catch (e) { console.warn('[openTreeForm] count trees failed', e); }
  }
  const padNum = (n) => String(n).padStart(3, '0');

  // ===== I-4 / I-5（v2.11.70）：複查脈絡 — 上期測值 + 跨期 delta + 本期狀態（fate）/ recruitment =====
  const _periods = derivePlotPeriods(plot);
  const _curPeriod = currentPlotPeriod(plot);
  const curSeq = Number(_curPeriod?.seq) || 1;
  const isResurvey = curSeq > 1;
  const periodOpenedDate = (seq) => {
    const p = _periods.find(x => Number(x.seq) === Number(seq));
    const d = p?.openedAt;
    if (!d) return null;
    if (typeof d?.toDate === 'function') return d.toDate();
    if (d instanceof Date) return d;
    if (typeof d === 'string' || typeof d === 'number') { const dt = new Date(d); return isNaN(dt) ? null : dt; }
    return null;
  };
  // 上期 measurement（periodId < 本期，取最近一期）— 僅編輯既有立木且處於複查期才抓
  let priorMeas = null, priorSeq = null, deltaYears = null;
  if (existing && existing.id && isResurvey) {
    try {
      const ms = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', existing.id, 'measurements'));
      const arr = ms.docs.map(d => d.data())
        .filter(x => Number.isFinite(Number(x.periodId)) && Number(x.periodId) < curSeq)
        .sort((a, b) => Number(b.periodId) - Number(a.periodId));
      if (arr.length) {
        priorMeas = arr[0];
        priorSeq = Number(priorMeas.periodId);
        const dPrev = periodOpenedDate(priorSeq);
        const dCur = periodOpenedDate(curSeq);
        if (dPrev && dCur && dCur > dPrev) deltaYears = (dCur - dPrev) / (365.25 * 86400000);
      }
    } catch (e) { console.warn('[I-4 prior measurement fetch]', e); }
  }
  // recruitment：複查期「新增」立木（無上期 measurement = 本期才出現）
  const isRecruit = isResurvey && (!existing || (existing && !priorMeas && !(existing.recruitedPeriod)));

  // v2.10.5：樹種搜尋（取代 datalist；資料源 = Firestore 224 種 + fallback 靜態 TREES）
  //   保留變數名 speciesInput 以最小化下方計算邏輯改動
  // v2.10.9：若 plot.elevation_m 已有 → 初始 band；不在 → fire & forget DEM lookup
  const initialBand = Number.isFinite(plot.elevation_m) ? elevationToBand(plot.elevation_m) : null;
  const speciesPicker = createSpeciesPicker({
    name: 'speciesZh', required: true,
    value: existing?.speciesZh || '',
    elevationBand: initialBand,
  });
  const speciesInput = speciesPicker.input;

  // v2.10.9：背景 DEM auto-detect（plot 沒 elevation_m 才 fetch）
  if (!Number.isFinite(plot.elevation_m) && plot.location) {
    const lat = plot.location.latitude ?? plot.location._lat;
    const lng = plot.location.longitude ?? plot.location._long;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      getElevation(lat, lng).then(elev => {
        if (elev == null) return;
        const band = elevationToBand(elev);
        // setBand({auto:true}) — 若 user 已手動點過 pill，不覆蓋
        speciesPicker.setBand(band, { auto: true });
        const willOverride = !speciesPicker.isBandUserTouched();
        toast(`📍 DEM 偵測 plot 海拔 ${elev.toFixed(0)}m → ${bandLabel(band)}${willOverride ? '（已自動切換）' : '（已尊重你手動選擇）'}`, 4000);
        // writeback Firestore（PI/admin 才寫）
        if (isPi() || isSystemAdmin()) {
          const ref = fb.doc(fb.db, 'projects', project.id, 'plots', plot.id);
          fb.updateDoc(ref, {
            elevation_m: +elev.toFixed(1),
            elevationSource: 'open-meteo',
            elevationFetchedAt: fb.serverTimestamp(),
          }).catch(e => console.warn('[plot.elevation_m writeback] failed', e));
        }
      });
    }
  }

  const consWarn = el('div', { class: 'text-xs mt-1' });
  function updateConsWarn() {
    // 優先從 picker cache 找（含 Firestore 新 226 種），fallback 靜態 SPECIES
    const matched = speciesPicker.getMatched();
    const cons = matched?.conservationGrade ?? SPECIES.find(x => x.zh === speciesInput.value)?.cons ?? null;
    if (cons) consWarn.innerHTML = `<span class="cons-warn">⚠ 保育類 第 ${cons} 級</span>`;
    else consWarn.innerHTML = '';
  }
  speciesInput.addEventListener('input', updateConsWarn);
  updateConsWarn();

  // DBH / H 即時計算顯示
  const calcOut = el('div', { class: 'bg-stone-50 rounded p-2 text-xs text-stone-700 my-2' });
  function updateCalc() {
    const dbh = parseFloat(f.querySelector('[name=dbh_cm]').value);
    const h = parseFloat(f.querySelector('[name=height_m]').value);
    const zh = speciesInput.value;
    // v2.10.7：優先 picker.getMatched()（Firestore 224 種有 sci / treeType / family）
    //   fallback 靜態 SPECIES.find（自由輸入新物種仍可走 sci-regex）
    const matched = speciesPicker.getMatched();
    const sci = matched?.sci ?? SPECIES.find(x => x.zh === zh)?.sci ?? '';
    const treeType = matched?.treeType ?? null;
    if (!dbh || !h) { calcOut.textContent = '輸入 DBH 與樹高即時試算'; return; }
    const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh: zh, speciesSci: sci, treeType });
    calcOut.innerHTML =
      `<div>斷面積 <b>${m.basalArea_m2}</b> m² ｜ 幹材積 <b>${m.volume_m3}</b> m³</div>` +
      `<div>全株生物量 <b>${m.biomass_kg}</b> kg ｜ 碳蓄積 <b>${m.carbon_kg}</b> kg ｜ CO₂ 當量 <b>${m.co2_kg}</b> kg</div>` +
      `<div class="text-[10px] text-stone-500 mt-1">${speciesParamsLabel(zh, sci, treeType)}</div>`;
  }

  // 病蟲害 checkbox（v1.6.9：inline style 寫死在 HTML，不依賴 CSS file，避開任何快取問題）
  const existingPests = new Set(existing?.pestSymptoms || []);
  const pestBox = el('div', { style: 'font-size:0' });
  const labStyle = 'display:inline-block;width:33%;font-size:14px;white-space:nowrap;line-height:1.8;vertical-align:top;color:#1c1917;cursor:pointer';
  const inpStyle = 'vertical-align:middle;margin-right:4px;width:16px;height:16px';
  pestBox.innerHTML = PEST_OPTIONS.map(p =>
    `<label style="${labStyle}"><input type="checkbox" name="pest" value="${p}"${existingPests.has(p) ? ' checked' : ''} style="${inpStyle}"> ${p}</label>`
  ).join('');

  // v1.6.13：立木照片上傳（拍特徵：樹皮、葉、花果、整體外觀）
  const treePhotoUp = photoUploader({ existing: existing?.photos || [] });
  const treePhotoLabel = el('label', {}, '立木照片',
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（樹皮 / 葉 / 花果 / 整體，≤5MB / 張）'));

  // v2.5：立木個體座標 X/Y（樣區內局部，自動換算 absolute TWD97 + WGS84）
  // v2.11.28：加入 GPS 直接量測模式（offset / gps / mixed 由 plot.positionMode 決定）
  const meth = project.methodology || DEFAULT_METHODOLOGY;
  const originType = meth.plotOriginType || 'center';
  const originLabel = originType === 'center' ? '中心點' : '左下角';
  const xyHint = originType === 'center'
    ? '皮尺距樣區中心點的偏移量(東向 X / 北向 Y,可正可負)'
    : '皮尺距樣區左下角的距離(向東 X / 向北 Y,皆為正)';

  // v2.11.28:定位模式邏輯
  const plotPosMode = plot.positionMode || 'offset';  // fallback 向後相容
  // 該樹實際定位來源 - 編輯既有:用既存欄位;新建:依 plot 模式預設(mixed -> offset 為預設)
  const initPosSource = existing?.positionSource
    ?? (plotPosMode === 'gps' ? 'gps' : 'offset');
  let currentPosSource = initPosSource;

  // ===== offset 區塊(X/Y 皮尺) =====
  const xInput = el('input', {
    type: 'number', name: 'localX_m', step: '0.01',
    value: existing?.localX_m ?? '',
    style: 'width:100%;border:1px solid #d6d3d1;border-radius:6px;padding:8px 10px;font-size:16px'
  });
  const yInput = el('input', {
    type: 'number', name: 'localY_m', step: '0.01',
    value: existing?.localY_m ?? '',
    style: 'width:100%;border:1px solid #d6d3d1;border-radius:6px;padding:8px 10px;font-size:16px'
  });
  const xyCalc = el('div', { class: 'text-xs', style: 'background:#f5f5f4;border-radius:6px;padding:6px 8px;margin-top:6px' });
  function updateXyCalc() {
    const lx = parseFloat(xInput.value);
    const ly = parseFloat(yInput.value);
    const px = plot.locationTWD97?.x;
    const py = plot.locationTWD97?.y;
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
      xyCalc.innerHTML = '<span class="text-stone-500">輸入 X / Y 即時換算絕對座標</span>';
      return;
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      xyCalc.innerHTML = '<span class="text-amber-700">⚠ 樣區尚未設定 GPS 座標 — 無法換算絕對位置</span>';
      return;
    }
    const absX = px + lx;
    const absY = py + ly;
    let lngLat = '—';
    try {
      const w = twd97ToWgs84(absX, absY);
      if (w?.lng != null) lngLat = `${w.lng.toFixed(6)}, ${w.lat.toFixed(6)}`;
    } catch (e) {}
    xyCalc.innerHTML =
      `<div>絕對 TWD97：<b>X=${absX.toFixed(2)} m, Y=${absY.toFixed(2)} m</b></div>` +
      `<div>WGS84（lng, lat）：<b>${lngLat}</b></div>`;
  }
  xInput.addEventListener('input', updateXyCalc);
  yInput.addEventListener('input', updateXyCalc);
  const offsetBlock = el('div', { class: 'field', style: 'background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:10px' },
    el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:4px' },
      `📐 立木位置（${originLabel}原點）`,
      el('span', { class: 'text-xs text-stone-500 ml-1' }, '（皮尺偏移 X/Y）')),
    el('div', { class: 'text-xs text-stone-600 mb-2' }, xyHint),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'X (m)'), xInput),
      el('div', { class: 'field' }, el('label', {}, 'Y (m)'), yInput)
    ),
    xyCalc
  );
  // 延遲一拍以等 DOM 接上才更新提示
  setTimeout(updateXyCalc, 0);

  // ===== v2.11.28：GPS 區塊（立木直接量測）=====
  const initGpsLat = existing?.location?.latitude ?? existing?.location?._lat ?? null;
  const initGpsLng = existing?.location?.longitude ?? existing?.location?._long ?? null;
  const initGpsAcc = existing?.gpsAccuracy_m ?? null;
  const gpsLngInput = el('input', { type: 'hidden', name: 'gpsLng', value: initGpsLng ?? '' });
  const gpsLatInput = el('input', { type: 'hidden', name: 'gpsLat', value: initGpsLat ?? '' });
  const gpsAccInput = el('input', { type: 'hidden', name: 'gpsAccuracy', value: initGpsAcc ?? '' });
  const gpsStatusTree = el('div', { class: 'text-xs text-stone-700 mt-1' }, '尚未定位');
  const gpsBtnTree = el('button', {
    type: 'button',
    class: 'bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded font-medium'
  }, '📍 抓取目前位置');

  function applyTreeGpsResult(lat, lng, accuracy) {
    gpsLatInput.value = lat;
    gpsLngInput.value = lng;
    gpsAccInput.value = (accuracy != null && Number.isFinite(accuracy)) ? accuracy : '';
    let accLabel = '';
    let accClass = 'text-emerald-700';
    if (Number.isFinite(accuracy)) {
      accLabel = ` ±${Math.round(accuracy)}m`;
      if (accuracy > 10) accClass = 'text-amber-700';
      if (accuracy > 25) accClass = 'text-red-700';
    }
    let twdLabel = '';
    try {
      const t = wgs84ToTwd97(lng, lat);
      twdLabel = ` ｜ TWD97 (${t.x}, ${t.y})`;
    } catch (e) {}
    const warn = (Number.isFinite(accuracy) && accuracy > 10)
      ? '<br><span class="text-amber-700 text-[11px]">⚠ GPS 精度 >10m，相鄰立木可能位置重疊。建議在開闊處重新取點，或之後在地圖頁長壓 marker 微調。</span>'
      : '';
    gpsStatusTree.innerHTML = `<span class="${accClass}">📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}${accLabel}</span>${twdLabel}${warn}`;
    gpsBtnTree.textContent = '📍 重新定位';
  }

  // v2.11.31 (J-1)：手動輸入 / 退回皮尺 兩條 fallback 的旗標 — submit 時決定 manuallyAdjusted
  // 編輯既有 manually-adjusted 樹 → 預設保留 true（除非 user 重抓 GPS 才 reset）
  let treeGpsManualEntry = !!existing?.manuallyAdjusted;

  gpsBtnTree.addEventListener('click', () => {
    if (!navigator.geolocation) {
      gpsStatusTree.innerHTML = '<span class="text-red-700">❌ 此裝置不支援 Geolocation API。請改用下方「✏️ 手動輸入座標」或「📐 退回皮尺 X/Y」。</span>';
      treeManualEntryDetails?.setAttribute('open', '');  // 自動展開手動輸入
      return;
    }
    gpsBtnTree.disabled = true;
    gpsBtnTree.textContent = '⏳ 定位中...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          treeGpsManualEntry = false;     // v2.11.31：GPS 量測成功 → 覆蓋手動標記
          applyTreeGpsResult(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        }
        catch (e) { console.error('[tree GPS apply]', e); }
        finally { gpsBtnTree.disabled = false; }
      },
      (err) => {
        const hint = { 1: '權限被拒 — 網址列 🔒→「位置」改允許→重整', 2: '無法定位 — 隱私權設定或無網路', 3: '逾時 — 訊號不佳' }[err.code] || err.message;
        gpsStatusTree.innerHTML = `<span class="text-red-700">❌ GPS 失敗 (code ${err.code})：${hint}</span><br><span class="text-stone-600 text-[11px]">→ 用下方「✏️ 手動輸入座標」或「📐 退回皮尺 X/Y」</span>`;
        treeManualEntryDetails?.setAttribute('open', '');  // v2.11.31：GPS 失敗自動展開手動輸入
        gpsBtnTree.disabled = false;
        gpsBtnTree.textContent = '📍 抓取目前位置';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  // ===== v2.11.31 (路 J-1)：GPS 模式手動 fallback — 兩條 escape =====
  // (1) 手填 lat/lng — 無 GPS 訊號但有座標來源（Google Maps 離線 / 紙本地圖）
  // (2) 退回皮尺 X/Y — GPS 完全無訊號緊急用，本棵樹改用 plot 原點 + 皮尺定位
  // 路 J-1 設計：野外山區 3-6 hr 離線 + 無 GPS 也能完整新增立木，避免「卡死無法操作」
  const treeManualLatInput = el('input', {
    type: 'number', step: '0.000001', placeholder: '緯度 lat',
    style: 'width:130px;border:1px solid #d6d3d1;border-radius:4px;padding:4px 6px;font-size:13px'
  });
  const treeManualLngInput = el('input', {
    type: 'number', step: '0.000001', placeholder: '經度 lng',
    style: 'width:130px;border:1px solid #d6d3d1;border-radius:4px;padding:4px 6px;font-size:13px'
  });
  // v2.11.80 (J-1b)：TWD97 X/Y 手動輸入 — 與 lat/lng 並列的第二種座標來源
  //   台灣圖資（QGIS / 紙本地形圖 / 政府開放資料）多為 TWD97 二度分帶（TM2 / EPSG:3826）X/Y，
  //   野外無 GPS 時可直接讀圖上 X/Y 輸入，免手算換經緯度。轉回 WGS84 後與 lat/lng 走同一套 apply。
  const treeManualXInput = el('input', {
    type: 'number', step: '0.01', placeholder: 'X 東距 (m)',
    style: 'width:130px;border:1px solid #d6d3d1;border-radius:4px;padding:4px 6px;font-size:13px'
  });
  const treeManualYInput = el('input', {
    type: 'number', step: '0.01', placeholder: 'Y 北距 (m)',
    style: 'width:130px;border:1px solid #d6d3d1;border-radius:4px;padding:4px 6px;font-size:13px'
  });
  let treeManualCoordMode = 'latlng';   // 'latlng' | 'twd97'

  // 共用收尾：手動座標（不論來源）→ 套用 + Taiwan 範圍軟提示 + ✋ 標記
  function applyTreeManualLatLng(lat, lng, sourceLabel) {
    treeGpsManualEntry = true;
    applyTreeGpsResult(lat, lng, null);   // accuracy=null → 不顯示 ±Nm
    const outOfTaiwan = (lat < 21 || lat > 26 || lng < 119 || lng > 123);
    const taiwanWarn = outOfTaiwan
      ? '<br><span class="text-amber-700 text-[11px]">⚠ 座標不在台灣範圍（21-26°N / 119-123°E），仍套用。若用 TWD97 請確認 X / Y 沒填反</span>'
      : '';
    gpsStatusTree.innerHTML += ` <span class="text-amber-700 text-[11px]">✋ ${sourceLabel}</span>${taiwanWarn}`;
  }

  const treeApplyManualBtn = el('button', {
    type: 'button',
    class: 'bg-stone-200 hover:bg-stone-300 text-stone-800 px-3 py-1 rounded text-xs font-medium'
  }, '套用');
  treeApplyManualBtn.addEventListener('click', () => {
    if (treeManualCoordMode === 'twd97') {
      const x = parseFloat(treeManualXInput.value);
      const y = parseFloat(treeManualYInput.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        gpsStatusTree.innerHTML = '<span class="text-red-700">❌ TWD97 X / Y 必填且為數字</span>';
        return;
      }
      let w = null;
      try { w = twd97ToWgs84(x, y); } catch (e) { w = null; }
      if (!w || !Number.isFinite(w.lat) || !Number.isFinite(w.lng)) {
        gpsStatusTree.innerHTML = '<span class="text-red-700">❌ TWD97 座標轉換失敗，請確認 X / Y 數值</span>';
        return;
      }
      applyTreeManualLatLng(w.lat, w.lng, '手動輸入 TWD97');
    } else {
      const lat = parseFloat(treeManualLatInput.value);
      const lng = parseFloat(treeManualLngInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        gpsStatusTree.innerHTML = '<span class="text-red-700">❌ 緯度 / 經度必填且為數字</span>';
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        gpsStatusTree.innerHTML = '<span class="text-red-700">❌ 座標超出範圍（lat -90~90 / lng -180~180）</span>';
        return;
      }
      applyTreeManualLatLng(lat, lng, '手動輸入');
    }
  });

  // 兩種座標型式的輸入列 + 提示（切換時互相顯隱）
  const treeLatLngRow = el('div', { class: 'flex flex-wrap gap-2 items-center mt-2' },
    el('span', { class: 'text-xs' }, 'lat:'), treeManualLatInput,
    el('span', { class: 'text-xs' }, 'lng:'), treeManualLngInput);
  const treeTwd97Row = el('div', { class: 'flex flex-wrap gap-2 items-center mt-2', style: 'display:none' },
    el('span', { class: 'text-xs' }, 'X:'), treeManualXInput,
    el('span', { class: 'text-xs' }, 'Y:'), treeManualYInput);
  const treeLatLngHint = el('div', { class: 'text-xs text-stone-500 mt-1' },
    '小技巧：Google Maps（含離線地圖）長按位置 → 出現座標 → 複製貼上。lat 在前、lng 在後。或從紙本地圖讀。手動輸入會標記 ✋（manuallyAdjusted=true）。');
  const treeTwd97Hint = el('div', { class: 'text-xs text-stone-500 mt-1', style: 'display:none' },
    'TWD97 二度分帶（TM2 / EPSG:3826）：X 東距約 150000–350000、Y 北距約 2400000–2800000（7 位數）。可從 QGIS、紙本地形圖或政府圖資讀取。系統會自動轉為經緯度並標記 ✋（manuallyAdjusted=true）。');

  function setTreeManualMode(mode) {
    treeManualCoordMode = mode;
    treeLatLngRow.style.display  = mode === 'latlng' ? '' : 'none';
    treeTwd97Row.style.display   = mode === 'twd97'  ? '' : 'none';
    treeLatLngHint.style.display = mode === 'latlng' ? '' : 'none';
    treeTwd97Hint.style.display  = mode === 'twd97'  ? '' : 'none';
  }

  // 座標型式切換（radio）— inline width:auto 覆蓋全域 .field input{width:100%}（見 memory feedback_forestmrv_ui_gotchas）
  const treeManualModeToggle = el('div', { class: 'flex gap-4 items-center mt-2 text-xs' },
    el('label', { class: 'flex items-center gap-1 cursor-pointer' },
      el('input', { type: 'radio', name: 'treeManualCoordMode', value: 'latlng', checked: 'true',
        style: 'width:auto', class: 'accent-forest-700',
        onchange: (e) => { if (e.target.checked) setTreeManualMode('latlng'); } }),
      '經緯度 (lat/lng)'),
    el('label', { class: 'flex items-center gap-1 cursor-pointer' },
      el('input', { type: 'radio', name: 'treeManualCoordMode', value: 'twd97',
        style: 'width:auto', class: 'accent-forest-700',
        onchange: (e) => { if (e.target.checked) setTreeManualMode('twd97'); } }),
      'TWD97 (X/Y)'));

  const treeManualEntryDetails = el('details', { class: 'mt-2' },
    el('summary', { class: 'cursor-pointer text-xs text-blue-700 hover:text-blue-900' },
      '✏️ 無 GPS 訊號？手動輸入座標（經緯度 或 TWD97 X/Y）'),
    treeManualModeToggle,
    treeLatLngRow,
    treeTwd97Row,
    el('div', { class: 'mt-2' }, treeApplyManualBtn),
    treeLatLngHint,
    treeTwd97Hint
  );

  // 編輯既有 GPS-mode 樹：還原顯示
  if (Number.isFinite(initGpsLat) && Number.isFinite(initGpsLng) && initPosSource === 'gps') {
    applyTreeGpsResult(initGpsLat, initGpsLng, initGpsAcc);
  }

  const gpsBlock = el('div', { class: 'field', style: 'background:#ecfdf5;border:1px solid #86efac;border-radius:6px;padding:10px' },
    el('label', { style: 'font-weight:600;font-size:14px;display:block;margin-bottom:4px' },
      '📍 立木 GPS 位置',
      el('span', { class: 'text-xs text-stone-500 ml-1' }, '（v2.11.28 / 站到樹下取點）')),
    el('div', { class: 'text-xs text-stone-600 mb-2' },
      '站到立木正下方按「抓取目前位置」。精度 >10m 會警示；可之後在地圖頁長壓 marker 微調。'),
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, gpsBtnTree),
    gpsStatusTree,
    gpsLngInput, gpsLatInput, gpsAccInput,
    treeManualEntryDetails               // v2.11.31 (J-1)：手動輸入 lat/lng fallback
  );

  // ===== mixed 模式：每棵樹的來源切換 =====
  const sourceToggle = (plotPosMode === 'mixed')
    ? el('div', { class: 'field', style: 'background:#faf5ff;border:1px solid #d8b4fe;border-radius:6px;padding:8px 10px' },
        el('label', { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px' },
          '🔀 本棵樹定位來源'),
        el('div', { class: 'flex gap-4 text-sm' },
          el('label', { class: 'flex items-center gap-1.5 cursor-pointer' },
            el('input', { type: 'radio', name: 'posSourceToggle', value: 'offset',
              ...(currentPosSource === 'offset' ? { checked: 'true' } : {}),
              onchange: (ev) => { if (ev.target.checked) { currentPosSource = 'offset'; applyPosVisibility(); } }
            }),
            '📐 皮尺 X/Y'),
          el('label', { class: 'flex items-center gap-1.5 cursor-pointer' },
            el('input', { type: 'radio', name: 'posSourceToggle', value: 'gps',
              ...(currentPosSource === 'gps' ? { checked: 'true' } : {}),
              onchange: (ev) => { if (ev.target.checked) { currentPosSource = 'gps'; applyPosVisibility(); } }
            }),
            '📍 GPS 量測')
        )
      )
    : null;

  function applyPosVisibility() {
    if (plotPosMode === 'mixed') {
      offsetBlock.style.display = currentPosSource === 'offset' ? '' : 'none';
      gpsBlock.style.display = currentPosSource === 'gps' ? '' : 'none';
    } else if (plotPosMode === 'gps') {
      // v2.11.31 (J-1)：允許 per-tree 切到 offset（緊急 fallback，野外 GPS 完全無訊號時）
      offsetBlock.style.display = currentPosSource === 'offset' ? '' : 'none';
      gpsBlock.style.display = currentPosSource === 'gps' ? '' : 'none';
    } else {
      offsetBlock.style.display = '';
      gpsBlock.style.display = 'none';
    }
  }

  // ===== v2.11.31 (路 J-1)：plot.positionMode='gps' 時的「退回皮尺」緊急 escape =====
  // 加在 gpsBlock 與 offsetBlock 底部，user 可在兩個區塊之間切換
  if (plotPosMode === 'gps') {
    const fallbackToOffsetBtn = el('button', {
      type: 'button',
      class: 'bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-1 rounded mt-2'
    }, '切換為皮尺 X/Y 輸入');
    fallbackToOffsetBtn.addEventListener('click', () => {
      currentPosSource = 'offset';
      applyPosVisibility();
      toast('已切換為皮尺 X/Y 模式（僅本棵樹）');
    });
    const fallbackToOffsetDetails = el('details', { class: 'mt-1' },
      el('summary', { class: 'cursor-pointer text-xs text-amber-700 hover:text-amber-900' },
        '📐 退回皮尺 X/Y 模式（GPS 完全無訊號緊急用）'),
      el('div', { class: 'text-xs text-amber-700 mt-2' },
        '本棵樹定位來源將被標記為「皮尺」（positionSource=offset），與樣區 GPS 模式設定不一致 — 資料層級可接受、為定位精度註記。'),
      fallbackToOffsetBtn
    );
    gpsBlock.appendChild(fallbackToOffsetDetails);

    const backToGpsBtn = el('button', {
      type: 'button',
      class: 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1 rounded mt-2'
    }, '切換回 GPS 量測');
    backToGpsBtn.addEventListener('click', () => {
      currentPosSource = 'gps';
      applyPosVisibility();
      toast('已切換回 GPS 量測模式');
    });
    const backToGpsDetails = el('details', { class: 'mt-1' },
      el('summary', { class: 'cursor-pointer text-xs text-emerald-700 hover:text-emerald-900' },
        '📍 切換回 GPS 量測模式'),
      el('div', { class: 'text-xs text-stone-600 mt-2' },
        '改回 GPS 取點（樣區設定為 GPS 模式，本棵樹原本走 fallback 才會看到此選項）。'),
      backToGpsBtn
    );
    offsetBlock.appendChild(backToGpsDetails);
  }

  // v2.3.3：個體編號 — prefix（plot.code-）+ 序號 input + 即時預覽
  const treeNumInput = el('input', {
    type: 'number', name: 'treeNum', step: '1', min: '1', required: 'true',
    value: existing?.treeNum ?? nextNum,
    style: 'flex:1;border:1px solid #d6d3d1;border-left:none;border-radius:0 6px 6px 0;padding:8px 10px;font-size:16px;min-width:0'
  });
  const treeCodePreview = el('div', {
    class: 'text-xs text-stone-600 mt-1',
    style: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace'
  }, `最終編號：${plot.code}-${padNum(parseInt(treeNumInput.value, 10) || nextNum)}`);
  function updateTreeCodePreview() {
    const n = parseInt(treeNumInput.value, 10);
    treeCodePreview.textContent = Number.isFinite(n) && n > 0
      ? `最終編號：${plot.code}-${padNum(n)}`
      : `最終編號：${plot.code}-???（請輸入流水號）`;
  }
  treeNumInput.addEventListener('input', updateTreeCodePreview);

  // ===== I-4：跨期 delta 即時警示（通用保守上下界 — 開場 Q3 已定；樹種別參考表留 I-6/後續）=====
  // 軟警示（amber，永不擋存 — surveyor 記錄現場真實，警示促雙重確認）：
  //   ΔDBH<0（樹幹不會縮）｜ΔDBH 年增 >5 cm/yr（極寬鬆通用上界）｜無期距時 ΔDBH>15 cm｜ΔH<−1 m（斷梢可能）
  const I4_BOUND = { DBH_NEG_TOL: -0.05, DBH_YR_MAX: 5, DBH_ABS_MAX: 15, H_DROP: -1.0 };
  const deltaLine = el('div', { class: 'text-xs mt-1' });
  const resurveyPanel = priorMeas ? el('div', {
    class: 'text-xs bg-indigo-50 border border-indigo-200 rounded p-2 my-2'
  },
    el('div', { class: 'font-medium text-indigo-900' },
      `📊 上期（第 ${priorSeq} 期${(() => { const d = periodOpenedDate(priorSeq); return d ? ' @ ' + fmtDate(d) : ''; })()}）`),
    el('div', { class: 'text-indigo-800 mt-0.5' },
      `DBH ${priorMeas.dbh_cm ?? '—'} cm ｜ H ${priorMeas.height_m ?? '—'} m ｜ 活力 ${({ healthy: '健康', weak: '衰弱', 'standing-dead': '枯立', fallen: '倒伏' })[priorMeas.vitality] || priorMeas.vitality || '—'}`
      + (deltaYears ? ` ｜ 期距 ${deltaYears.toFixed(1)} 年` : '')),
    deltaLine
  ) : null;
  function updateDelta() {
    if (!priorMeas) return;
    const dbh = parseFloat(f.querySelector('[name=dbh_cm]')?.value);
    const h = parseFloat(f.querySelector('[name=height_m]')?.value);
    if (!Number.isFinite(dbh) && !Number.isFinite(h)) {
      deltaLine.innerHTML = '<span class="text-stone-500">輸入本期 DBH / 樹高即時比對上期</span>';
      return;
    }
    const warns = [];
    const parts = [];
    if (Number.isFinite(dbh) && Number.isFinite(priorMeas.dbh_cm)) {
      const dd = dbh - priorMeas.dbh_cm;
      const ddYr = deltaYears ? dd / deltaYears : null;
      parts.push(`ΔDBH ${dd >= 0 ? '+' : ''}${dd.toFixed(1)} cm${ddYr != null ? `（${ddYr >= 0 ? '+' : ''}${ddYr.toFixed(2)}/yr）` : ''}`);
      if (dd < I4_BOUND.DBH_NEG_TOL) warns.push(`DBH 負成長 ${dd.toFixed(1)} cm（樹幹不會縮；請確認量測或樹牌身分）`);
      else if (ddYr != null && ddYr > I4_BOUND.DBH_YR_MAX) warns.push(`DBH 年增 ${ddYr.toFixed(1)} cm/yr 偏高（請確認）`);
      else if (ddYr == null && dd > I4_BOUND.DBH_ABS_MAX) warns.push(`DBH 增量 ${dd.toFixed(1)} cm 偏大（無期距可年化；請確認）`);
    }
    if (Number.isFinite(h) && Number.isFinite(priorMeas.height_m)) {
      const dh = h - priorMeas.height_m;
      parts.push(`ΔH ${dh >= 0 ? '+' : ''}${dh.toFixed(1)} m`);
      if (dh < I4_BOUND.H_DROP) warns.push(`樹高退縮 ${dh.toFixed(1)} m（斷梢可能；請確認）`);
    }
    if (warns.length) {
      deltaLine.innerHTML = `<div class="text-amber-800 font-medium">⚠ ${parts.join(' ｜ ')}</div>`
        + warns.map(w => `<div class="text-amber-700">• ${w}</div>`).join('');
    } else {
      deltaLine.innerHTML = `<span class="text-emerald-700">✅ ${parts.join(' ｜ ') || '—'}</span>`;
    }
  }

  // ===== I-5：本期狀態（fate）+ recruitment 自動標記 =====
  const fateField = (existing && existing.id && isResurvey) ? field({
    label: `本期狀態（第 ${curSeq} 期複查）`, name: 'resurveyFate',
    options: [
      { value: 'alive', label: '存活（本期復測）' },
      { value: 'dead', label: '本期死亡（枯死 / 倒伏）' },
      { value: 'missing', label: '失蹤 — 無法尋獲' },
      { value: 'tag-lost', label: '樹牌脫落 — 身分存疑' }
    ],
    value: existing?.resurveyFate || 'alive'
  }) : null;
  const recruitNote = isRecruit ? el('div', {
    class: 'text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded p-2 my-2'
  }, `✨ 本樹於第 ${curSeq} 期新增 = recruitment（新進個體，系統自動標記 recruitedPeriod=${curSeq}）`) : null;

  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field' },
      el('label', {}, '個體編號 ', el('span', { class: 'req' }, '*')),
      el('div', { style: 'display:flex;align-items:stretch' },
        el('span', {
          style: 'background:#f5f5f4;border:1px solid #d6d3d1;border-right:none;border-radius:6px 0 0 6px;padding:8px 10px;font-size:16px;color:#57534e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap'
        }, `${plot.code}-`),
        treeNumInput
      ),
      treeCodePreview
    ),
    el('div', { class: 'field' },
      el('label', { class: 'flex items-center justify-between gap-2' },
        el('span', {}, '樹種 ', el('span', { class: 'req' }, '*')),
        // v2.11.0：AI 樹種辨識按鈕（拍葉/花/皮 → Pl@ntNet → top-3 → 套用 picker）
        // v2.11.3：onPick 帶 imageBlob → 自動加入 tree.photos（一動作雙功能，省 surveyor 重拍）
        el('button', {
          type: 'button',
          class: 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2 py-1 rounded font-medium whitespace-nowrap',
          onclick: () => openAiIdentifyModal({
            onPick: ({ zh, imageBlob }) => {
              speciesPicker.setValue(zh);
              speciesInput.dispatchEvent(new Event('input', { bubbles: true }));
              // v2.11.3：把 AI 辨識用的照片加入立木 photo 陣列（pending，submit 才上傳 Storage）
              if (imageBlob && treePhotoUp) {
                treePhotoUp.addFile(imageBlob);
              }
            }
          })
        }, '📸 AI 辨識')
      ),
      speciesPicker.root,                    // v2.10.5：picker.root 含 input + dropdown panel
      consWarn
    ),
    // v2.5：立木個體座標（樣區內局部 X/Y → 自動算 absolute TWD97 + WGS84）
    // v2.11.28：依 plot.positionMode 動態顯示 offset / GPS / mixed-toggle
    sourceToggle,
    offsetBlock,
    gpsBlock,
    el('div', { class: 'field-row' },
      field({ label: 'DBH (cm)', name: 'dbh_cm', type: 'number', step: '0.1', min: '0', required: true, value: existing?.dbh_cm ?? '' }),
      field({ label: '樹高 H (m)', name: 'height_m', type: 'number', step: '0.1', min: '0', required: true, value: existing?.height_m ?? '' })
    ),
    field({ label: '枝下高 (m)', name: 'branchHeight_m', type: 'number', step: '0.1', min: '0', value: existing?.branchHeight_m ?? '' }),
    calcOut,
    recruitNote,        // I-5：複查期新增立木標記（null 安全）
    resurveyPanel,      // I-4：上期值 + 跨期 delta 即時警示（null 安全）
    fateField,          // I-5：本期狀態 fate（僅複查既有立木顯示，null 安全）
    field({ label: '活力', name: 'vitality', required: true,
      options: [
        { value: 'healthy', label: '健康' },
        { value: 'weak', label: '衰弱' },
        { value: 'standing-dead', label: '枯立' },
        { value: 'fallen', label: '倒伏' }
      ], value: existing?.vitality || 'healthy' }),
    el('div', { class: 'field' },
      el('label', {}, '病蟲害症狀（複選）'),
      pestBox
    ),
    field({ label: '標記方式', name: 'marking',
      options: [
        { value: 'none', label: '無' },
        { value: 'paint', label: '噴漆' },
        { value: 'tag', label: '號牌' }
      ], value: existing?.marking || 'none' }),
    el('div', { class: 'field' }, treePhotoLabel, treePhotoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deleteSubdoc(project, plot, 'trees', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  // 即時計算
  f.querySelector('[name=dbh_cm]').addEventListener('input', updateCalc);
  f.querySelector('[name=height_m]').addEventListener('input', updateCalc);
  speciesInput.addEventListener('input', updateCalc);
  updateCalc();
  // I-4：跨期 delta 即時比對（與 updateCalc 並行掛同樣 dbh/height input 事件）
  if (priorMeas) {
    f.querySelector('[name=dbh_cm]').addEventListener('input', updateDelta);
    f.querySelector('[name=height_m]').addEventListener('input', updateDelta);
    updateDelta();
  }
  // v2.11.28：依 plot.positionMode 初始顯示 offset / GPS / mixed-toggle
  applyPosVisibility();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const sp = SPECIES.find(x => x.zh === speciesZh) || {};
    // v2.10.7：優先 picker.getMatched()（Firestore 224 種有 sci / treeType / conservationGrade）
    const matched = speciesPicker.getMatched();
    const speciesSci = matched?.sci ?? sp.sci ?? null;
    const speciesCons = matched?.conservationGrade ?? sp.cons ?? null;
    const treeType = matched?.treeType ?? null;
    const dbh = parseFloat(fd.get('dbh_cm'));
    const h = parseFloat(fd.get('height_m'));
    const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh, speciesSci, treeType });
    const treeNumVal = parseInt(fd.get('treeNum'), 10);
    // v2.11.75：同樣區「重號」防呆 — 立木表單 nextNum 可被使用者覆寫，且無唯一性檢查
    //   → 學生易把「既有立木」當「新立木」重打一筆相同 treeNum/treeCode（散布圖/I-6/統計會
    //   雙重計數株數、BA、材積、碳量）。新建（!existing）才檢查；編輯沿用原號不擋。
    if (!existing && Number.isFinite(treeNumVal)) {
      let dupTree = null;
      try {
        const _ts = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
        const _d = _ts.docs.find(d => parseInt(d.data().treeNum, 10) === treeNumVal);
        if (_d) dupTree = { id: _d.id, ...(_d.data()) };
      } catch (e) { console.warn('[v2.11.75] dup-treeNum check failed', e); }
      if (dupTree) {
        const dupCode = dupTree.treeCode || `${plot.code}-${padNum(treeNumVal)}`;
        if (isResurvey) {
          // 複查期：很可能是要「重測」既有立木 → 導向既有立木的編輯/複查表單
          const go = confirm(`本樣區已有立木「${dupCode}」（第 ${treeNumVal} 號）。\n\n複查期不應重新建立同號立木。要改為「重測既有立木 ${dupCode}」嗎？\n\n按「確定」開啟該株的複查表單；按「取消」回到目前表單修改編號。`);
          if (go) { closeModal(); return void openTreeForm(project, plot, dupTree); }
          toast(`第 ${treeNumVal} 號已存在，請改用其他編號，或重測既有立木。`);
          return;
        }
        // 第一期/非複查：直接擋下，要求改號
        toast(`本樣區已有立木「${dupCode}」（第 ${treeNumVal} 號），請改用其他編號。`);
        return;
      }
    }
    // v2.5：立木座標換算（local X/Y → absolute TWD97 + WGS84 geopoint）
    // v2.11.28：依 currentPosSource 分支 — offset (X/Y→絕對) 或 gps (絕對→反算 X/Y)
    const positionSource = currentPosSource;
    let localX = null, localY = null;
    let treeLocationTWD97 = null, treeLocationWGS84 = null;
    let gpsAccuracy_m = null;
    let fixedAt = null;
    const px = plot.locationTWD97?.x;
    const py = plot.locationTWD97?.y;
    // v2.11.74：local 座標 sanity bound（offset + gps 兩模式共用）— 擋住絕對座標等級誤填
    const _maxDimT = Math.max(
      plot.plotDimensions?.width || 0, plot.plotDimensions?.length || 0, plot.plotDimensions?.side || 0,
      Number.isFinite(plot.area_m2) ? Math.sqrt(plot.area_m2) : 0, 50);
    const _capT = _maxDimT * 4 + 100;   // 容許略超出邊界，但擋住 ~百公尺以上的絕對座標誤填

    if (positionSource === 'gps') {
      const gLat = parseFloat(fd.get('gpsLat'));
      const gLng = parseFloat(fd.get('gpsLng'));
      const gAcc = parseFloat(fd.get('gpsAccuracy'));
      if (!Number.isFinite(gLat) || !Number.isFinite(gLng)) {
        toast('GPS 模式需先按「📍 抓取目前位置」');
        return;
      }
      gpsAccuracy_m = Number.isFinite(gAcc) ? gAcc : null;
      // 編輯既有 GPS 樹且 GPS 座標沒重抓 → 沿用原 fixedAt；否則寫新 server timestamp
      const existLat = existing?.location?.latitude ?? existing?.location?._lat;
      const existLng = existing?.location?.longitude ?? existing?.location?._long;
      const reusingExistingFix = existing?.positionSource === 'gps'
        && Number.isFinite(existLat)
        && Math.abs(existLat - gLat) < 1e-7
        && Math.abs(existLng - gLng) < 1e-7;
      fixedAt = reusingExistingFix ? (existing.fixedAt || null) : fb.serverTimestamp();
      try {
        const t = wgs84ToTwd97(gLng, gLat);
        treeLocationTWD97 = { x: t.x, y: t.y };
        treeLocationWGS84 = new fb.GeoPoint(gLat, gLng);
        // 反算 local X/Y（給樣區內顯示用 — 相對 plot 中心 TWD97）
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const _lx = +(t.x - px).toFixed(2);
          const _ly = +(t.y - py).toFixed(2);
          // v2.11.74：防呆 — 反算 local 若爆量（通常代表 plot.locationTWD97 中心被誤填絕對座標
          //   或 GPS 量在別的樣區），不把垃圾寫進 localX/localY（render 端散布圖會用它），改記 null。
          if (Math.abs(_lx) > _capT || Math.abs(_ly) > _capT) {
            console.warn(`[v2.11.74] GPS 反算 local (${_lx}, ${_ly}) 超出 ±${Math.round(_capT)} m，不寫入 localX/Y（保留絕對座標）`);
            localX = null; localY = null;
          } else {
            localX = _lx; localY = _ly;
          }
        }
      } catch (e) { console.warn('[v2.11.28 tree gps→twd97]', e); }
    } else {
      // offset 模式（傳統皮尺）
      const lx = parseFloat(fd.get('localX_m'));
      const ly = parseFloat(fd.get('localY_m'));
      // 防呆：X/Y 是「樣區內」皮尺距離（公尺，約 0–樣區邊長），學生常誤把 TWD97 絕對座標
      // （如 200282）填進來 → 產生距樣區數十萬公尺的點、render 爆掉卡死。擋住絕對座標等級的錯值。
      // v2.11.74：_maxDimT/_capT 已上移至分支前（offset + gps 共用）
      if ((Number.isFinite(lx) && Math.abs(lx) > _capT) || (Number.isFinite(ly) && Math.abs(ly) > _capT)) {
        toast(`X / Y 是樣區「內」皮尺距離（公尺），本樣區約 0–${Math.round(_maxDimT)} m。你輸入的 (${lx}, ${ly}) 超出合理範圍，請確認是否誤填了 TWD97 絕對座標。`);
        return;
      }
      localX = Number.isFinite(lx) ? lx : null;
      localY = Number.isFinite(ly) ? ly : null;
      if (Number.isFinite(lx) && Number.isFinite(ly)
          && Number.isFinite(px) && Number.isFinite(py)) {
        const absX = px + lx;
        const absY = py + ly;
        treeLocationTWD97 = { x: absX, y: absY };
        try {
          const w = twd97ToWgs84(absX, absY);
          if (w?.lng != null && w?.lat != null) {
            treeLocationWGS84 = new fb.GeoPoint(w.lat, w.lng);
          }
        } catch (e) { console.warn('[v2.5 tree wgs84]', e); }
      }
    }

    // v2.11.75：座標鄰近「軟」提示 — 新樹/編輯後 local 座標若與另一株 < 0.5 m，可能是重複定位
    //   （配合重號防呆抓另一種「同位置兩棵」的輸入錯誤）。可忽略，按確定仍可儲存。
    if (Number.isFinite(localX) && Number.isFinite(localY)) {
      const PROX_M = 0.5;
      try {
        const _ts2 = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
        let near = null, nearD = Infinity;
        for (const d of _ts2.docs) {
          if (d.id === existing?.id) continue;   // 編輯自己不比
          const t = d.data();
          if (!Number.isFinite(t.localX_m) || !Number.isFinite(t.localY_m)) continue;
          const dist = Math.hypot(t.localX_m - localX, t.localY_m - localY);
          if (dist < PROX_M && dist < nearD) { near = { code: t.treeCode || `#${t.treeNum}`, dist }; nearD = dist; }
        }
        if (near) {
          const ok = confirm(`此座標 (${localX}, ${localY}) 與既有立木「${near.code}」僅相距約 ${near.dist.toFixed(2)} m，可能是重複定位或量錯。\n\n仍要儲存嗎？`);
          if (!ok) return;
        }
      } catch (e) { console.warn('[v2.11.75] proximity check failed', e); }
    }

    const data = {
      treeNum: treeNumVal,
      // v2.3.3：完整字串編號（DEMO-010-001 格式），方便顯示與匯出
      treeCode: `${plot.code}-${String(treeNumVal).padStart(3, '0')}`,
      speciesZh,
      speciesSci,                       // v2.10.7：優先 picker（含 Firestore 新 species sci）
      conservationGrade: speciesCons,
      treeType,                         // v2.10.7：存樹型供將來重算 / 統計分析
      dbh_cm: dbh,
      height_m: h,
      branchHeight_m: parseFloat(fd.get('branchHeight_m')) || null,
      vitality: fd.get('vitality'),
      pestSymptoms: fd.getAll('pest'),
      marking: fd.get('marking'),
      notes: fd.get('notes').trim() || null,
      // v2.5 立木個體座標 / v2.11.28 雙模式
      localX_m: localX,
      localY_m: localY,
      locationTWD97: treeLocationTWD97,
      location: treeLocationWGS84,
      positionSource,                   // v2.11.28：'offset' | 'gps'
      gpsAccuracy_m,                    // v2.11.28：GPS 模式才有值
      fixedAt,                          // v2.11.28：GPS 取點時間
      // v2.11.31 (J-1)：GPS-mode 樹的「手動標記」— 來源：(a) 表單手填 lat/lng；(b) 編輯既有已 manually-adjusted 樹；(c) 地圖長壓微調（已存欄位）
      // offset 模式不適用 manuallyAdjusted 概念（皮尺本來就是手動定位），一律 false
      manuallyAdjusted: positionSource === 'gps' ? treeGpsManualEntry : false,
      // I-5：本期狀態（複查期才有 fate select；新建/第一期 → alive）+ recruitment 期別自動標記
      resurveyFate: fd.get('resurveyFate') || existing?.resurveyFate || 'alive',
      recruitedPeriod: existing?.recruitedPeriod ?? (isRecruit ? curSeq : null),
      // I-6c（v2.11.86）：本期已複查標記 — 存檔即蓋當期期號，供立木清單「上期紅字→本期黑字」判斷
      lastMeasuredPeriod: curSeq,
      ...m,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees');
      // v1.6.13：先建/更新 tree 取得 id，再上傳照片，最後寫回 photos URL
      let treeId;
      if (existing) {
        treeId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, treeId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        data.qaqc = defaultTreeQaqc();  // v2.8.1：新立木帶 QAQC 預設子結構
        const ref = await fb.addDoc(colRef, data);
        treeId = ref.id;
      }
      if (treePhotoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (treePhotoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await treePhotoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `tree-${treeId}`
        });
        await fb.updateDoc(fb.doc(colRef, treeId), { photos });
      }
      // I-1（v2.11.70）：write-through 當期 measurement 逐期歷史（純加性、失敗只 warn 不阻斷）
      await writeTreeMeasurementSnapshot(project, plot, treeId, data, 'tree-form');
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  // v2.3.3：標題顯示完整 treeCode（舊資料 fallback：plot.code + 補零 treeNum）
  const titleCode = existing ? (existing.treeCode || `${plot.code}-${String(existing.treeNum || 0).padStart(3, '0')}`) : null;
  openModal(existing ? `編輯立木 ${titleCode}` : '新立木', f);
}

// ===== 自然更新表單 =====
export function openRegenForm(project, plot, existing = null) {
  // v2.10.5：樹種搜尋（取代 datalist）
  const regenPicker = createSpeciesPicker({
    name: 'speciesZh', required: true,
    value: existing?.speciesZh || '',
  });
  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field' },
      el('label', {}, '樹種 ', el('span', { class: 'req' }, ' *')),
      regenPicker.root
    ),
    field({ label: '苗高分級', name: 'heightClass', required: true,
      options: [
        { value: '<30', label: '< 30 cm' },
        { value: '30-130', label: '30 – 130 cm' },
        { value: '>130', label: '> 130 cm' }
      ], value: existing?.heightClass || '<30' }),
    field({ label: '株數', name: 'count', type: 'number', step: '1', min: '0', required: true, value: existing?.count ?? '' }),
    field({ label: '競爭植被覆蓋度 (%)', name: 'competitionCover_pct', type: 'number', step: '5', min: '0', max: '100', value: existing?.competitionCover_pct ?? '' }),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600', onclick: () => deleteSubdoc(project, plot, 'regeneration', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const sp = SPECIES.find(x => x.zh === speciesZh) || {};
    const data = {
      speciesZh,
      speciesSci: sp.sci || null,
      heightClass: fd.get('heightClass'),
      count: parseInt(fd.get('count'), 10),
      competitionCover_pct: fd.get('competitionCover_pct') ? parseInt(fd.get('competitionCover_pct'), 10) : null,
      notes: fd.get('notes').trim() || null
    };
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'regeneration');
      if (existing) {
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, existing.id), data);
        toast(data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新');
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';  // v1.5
        await fb.addDoc(colRef, data);
        toast('已建立（待審核）');
      }
      closeModal();
    } catch (e) { toast('儲存失敗：' + e.message); }
  });
  openModal(existing ? '編輯更新記錄' : '新更新記錄', f);
}

async function deleteSubdoc(project, plot, subColl, existing) {
  if (!confirm('確定刪除？')) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, subColl, existing.id));
    toast('已刪除');
    closeModal();
  } catch (e) { toast('刪除失敗：' + e.message); }
}

// ===== v2.0 共用：調查場次（surveyRound）helper =====
// 自動產生當前季度標籤，如 'Q2-2026'。PI 可在 methodology 改設成月份模式。
function currentSurveyRound() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `Q${q}-${now.getFullYear()}`;
}

// ===== v2.0 模組一：地被植物（understory）— 5 點樣方法 =====
// 一筆 = 一個小樣方一次調查；species[] 為 nested array 記多筆物種覆蓋度
export function openUnderstoryForm(project, plot, existing = null) {
  const cfg = project.methodology?.understoryConfig || DEFAULT_METHODOLOGY.understoryConfig;
  const photoReq = !!cfg.requirePhotos;

  // 物種子表：state 持有 species 陣列，動態加列/刪列
  let speciesRows = existing?.species ? [...existing.species] : [];

  // datalist 草本字典（依 lifeForm 分組註記）
  const herbList = el('datalist', { id: 'dl-herbs' },
    ...HERBS.map(h => el('option', { value: h.zh },
      `${h.lifeForm}${h.isInvasive ? ' ⚠入侵' : ''} ｜ ${h.sci}`))
  );

  const speciesContainer = el('div', { class: 'space-y-2' });
  function redrawSpecies() {
    speciesContainer.innerHTML = '';
    if (speciesRows.length === 0) {
      speciesContainer.appendChild(el('p', { class: 'text-xs text-stone-500 italic' }, '尚無物種紀錄，按下方「＋ 加物種」開始'));
      return;
    }
    speciesRows.forEach((sr, idx) => {
      const card = el('div', {
        class: 'border rounded p-2 space-y-1 ' + (sr.isInvasive ? 'bg-orange-50 border-orange-300' : 'bg-stone-50')
      });
      const speciesIn = el('input', {
        type: 'text', list: 'dl-herbs', placeholder: '物種中文', value: sr.speciesZh || '',
        class: 'border rounded px-2 py-1 w-full text-sm', autocomplete: 'off'
      });
      speciesIn.addEventListener('input', () => {
        sr.speciesZh = speciesIn.value;
        const h = findHerb(speciesIn.value);
        if (h) {
          sr.speciesSci = h.sci;
          sr.lifeForm = h.lifeForm;
          sr.isInvasive = h.isInvasive || isInvasive(speciesIn.value);
          lifeFormSel.value = h.lifeForm;
        } else {
          sr.isInvasive = isInvasive(speciesIn.value);
        }
        redrawSpecies();
      });
      const lifeFormSel = el('select', { class: 'border rounded px-2 py-1 text-sm' },
        ...['草本', '蕨類', '苔蘚', '藤本', '灌木幼株'].map(lf => {
          const opt = el('option', { value: lf }, lf);
          if (sr.lifeForm === lf) opt.setAttribute('selected', 'true');
          return opt;
        })
      );
      lifeFormSel.addEventListener('change', () => { sr.lifeForm = lifeFormSel.value; });
      const covInput = el('input', {
        type: 'number', min: '0', max: '100', step: '1', placeholder: '覆蓋%',
        value: sr.coverage ?? '', class: 'border rounded px-2 py-1 w-20 text-sm'
      });
      covInput.addEventListener('input', () => { sr.coverage = parseInt(covInput.value, 10) || 0; });
      const heightInput = el('input', {
        type: 'number', min: '0', step: '1', placeholder: '高cm',
        value: sr.height_cm ?? '', class: 'border rounded px-2 py-1 w-20 text-sm'
      });
      heightInput.addEventListener('input', () => { sr.height_cm = parseInt(heightInput.value, 10) || null; });
      const delBtn = el('button', {
        type: 'button', class: 'text-red-600 text-sm px-2',
        onclick: () => { speciesRows.splice(idx, 1); redrawSpecies(); }
      }, '✕');
      const invasiveTag = sr.isInvasive
        ? el('div', { class: 'text-xs text-orange-700 font-medium' }, '⚠ 公告外來入侵種')
        : null;
      card.appendChild(speciesIn);
      card.appendChild(el('div', { class: 'flex gap-2 items-center' },
        lifeFormSel,
        covInput, el('span', { class: 'text-xs text-stone-500' }, '%'),
        heightInput, el('span', { class: 'text-xs text-stone-500' }, 'cm'),
        delBtn
      ));
      if (invasiveTag) card.appendChild(invasiveTag);
      speciesContainer.appendChild(card);
    });
  }
  redrawSpecies();

  const addSpeciesBtn = el('button', {
    type: 'button', class: 'border border-dashed border-stone-400 rounded w-full py-2 text-sm text-stone-600',
    onclick: () => {
      speciesRows.push({ speciesZh: '', speciesSci: null, lifeForm: '草本', coverage: 0, height_cm: null, isInvasive: false });
      redrawSpecies();
    }
  }, '＋ 加物種');

  // 樣方照片
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '樣方俯拍照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（從正上方拍 1m×1m 範圍）'));

  const f = el('form', { class: 'space-y-2' },
    herbList,
    el('div', { class: 'field-row' },
      field({ label: '小樣方位置', name: 'quadratCode', required: true,
        options: cfg.quadratCodes.map(c => ({ value: c, label: { N: '北', E: '東', S: '南', W: '西', C: '中央' }[c] || c })),
        value: existing?.quadratCode || 'C' }),
      field({ label: '樣方大小', name: 'quadratSize', required: true,
        options: [
          { value: '1x1', label: '1 × 1 m' },
          { value: '2x2', label: '2 × 2 m' },
          { value: '5x5', label: '5 × 5 m' }
        ], value: existing?.quadratSize || cfg.quadratSize || '1x1' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound(), placeholder: 'Q2-2026' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '整體覆蓋度 (%)', name: 'totalCoverage', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.totalCoverage ?? '' }),
      field({ label: '枯枝落葉層厚 (cm)', name: 'litterDepth_cm', type: 'number', step: '0.5', min: '0',
        value: existing?.litterDepth_cm ?? '' })
    ),
    el('div', { class: 'field' },
      el('label', {}, '物種紀錄（覆蓋度可加總超過 100% — 多層交疊允許）'),
      speciesContainer,
      addSpeciesBtn
    ),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'understory', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張樣方照片'); return; }
    // 過濾空物種列
    const cleanSpecies = speciesRows.filter(s => s.speciesZh && s.speciesZh.trim());
    const fd = new FormData(f);
    const data = {
      quadratCode: fd.get('quadratCode'),
      quadratSize: fd.get('quadratSize'),
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      totalCoverage: parseInt(fd.get('totalCoverage'), 10),
      litterDepth_cm: fd.get('litterDepth_cm') ? parseFloat(fd.get('litterDepth_cm')) : null,
      species: cleanSpecies,
      invasiveCount: cleanSpecies.filter(s => s.isInvasive).length,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'understory');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `understory-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯地被樣方 ${existing.quadratCode}` : '新地被樣方', f);
}

// ===== v2.0 模組二：水土保持（soilCons）— 5 點定點觀測 =====
// 一筆 = 一個觀測點一次調查；自動帶上次同 stationCode 代表照供比對
export async function openSoilConsForm(project, plot, existing = null) {
  const cfg = project.methodology?.soilConsConfig || DEFAULT_METHODOLOGY.soilConsConfig;
  const photoReq = !!cfg.requirePhotos;

  // 抓上一筆同 stationCode 的紀錄（給比對照片）
  let lastRecord = null;
  const stationCode = existing?.stationCode || 'C';
  try {
    const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'soilCons');
    const qSnap = await fb.getDocs(fb.query(colRef,
      fb.where('stationCode', '==', stationCode),
      fb.orderBy('surveyDate', 'desc')
    ));
    for (const d of qSnap.docs) {
      if (existing && d.id === existing.id) continue;
      lastRecord = { id: d.id, ...d.data() };
      break;
    }
  } catch (e) { /* 無索引或無資料時略過 */ }

  // 比對照片區
  const compareBox = el('div', { class: 'bg-stone-50 rounded p-2 text-xs' });
  function updateCompareBox(curStation) {
    compareBox.innerHTML = '';
    if (!lastRecord || lastRecord.stationCode !== curStation) {
      compareBox.appendChild(el('div', { class: 'text-stone-500 italic' }, '尚無同點位歷史紀錄'));
      return;
    }
    const lastPhoto = (lastRecord.photos || [])[0];
    compareBox.appendChild(el('div', { class: 'font-medium mb-1' },
      `📅 上次調查：${(lastRecord.surveyDate?.toDate ? lastRecord.surveyDate.toDate() : new Date(lastRecord.surveyDate || 0)).toISOString().slice(0, 10)} `,
      `（${lastRecord.surveyRound || '—'}）`
    ));
    compareBox.appendChild(el('div', {},
      `沖蝕等級 ${lastRecord.erosionLevel} · 植生覆蓋 ${lastRecord.vegCoverage}% · 排水 ${lastRecord.drainage || '—'}`
    ));
    if (lastPhoto?.url) {
      compareBox.appendChild(el('div', { class: 'mt-1' },
        el('img', { src: lastPhoto.url, style: 'width:80px;height:80px;object-fit:cover;border-radius:4px;border:1px solid #d6d3d1' })
      ));
    }
  }

  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '定點照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（建議朝固定方位拍，便於比對）'));

  const stationSelect = el('select', { name: 'stationCode', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...cfg.stationCodes.map(c => {
      const lab = { N: '北 N', E: '東 E', S: '南 S', W: '西 W', C: '中央 C' }[c] || c;
      const opt = el('option', { value: c }, lab);
      if (c === stationCode) opt.setAttribute('selected', 'true');
      return opt;
    })
  );
  stationSelect.addEventListener('change', () => updateCompareBox(stationSelect.value));

  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field' },
        el('label', {}, '觀測點 ', el('span', { class: 'req' }, '*')),
        stationSelect
      ),
      field({ label: '事件類型', name: 'eventType', required: true,
        options: [
          { value: 'routine', label: '例行季調' },
          { value: 'post-typhoon', label: '颱風後' },
          { value: 'post-rain', label: '豪雨後' },
          { value: 'post-construction', label: '工程後' }
        ], value: existing?.eventType || 'routine' })
    ),
    field({ label: '事件名稱（如颱風名／豪雨日期，例行可留空）', name: 'eventName',
      value: existing?.eventName || '', placeholder: '丹娜絲颱風 / 0822 豪雨' }),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound(), placeholder: 'Q2-2026' })
    ),
    compareBox,
    el('div', { class: 'field-row' },
      field({ label: '植生覆蓋率 (%)', name: 'vegCoverage', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.vegCoverage ?? '' }),
      field({ label: '裸露面積率 (%)', name: 'bareRatio', type: 'number', step: '1', min: '0', max: '100',
        required: true, value: existing?.bareRatio ?? '' })
    ),
    field({ label: '沖蝕等級 (1-5)', name: 'erosionLevel', required: true,
      options: [
        { value: 1, label: '1 — 無明顯沖蝕' },
        { value: 2, label: '2 — 輕微面蝕' },
        { value: 3, label: '3 — 溝蝕 < 5 cm' },
        { value: 4, label: '4 — 溝蝕 5–30 cm' },
        { value: 5, label: '5 — 崩塌或大型溝蝕' }
      ], value: existing?.erosionLevel || 1 }),
    el('div', { class: 'field-row' },
      field({ label: '沖蝕針讀值 (cm)', name: 'erosionPin_cm', type: 'number', step: '0.1',
        value: existing?.erosionPin_cm ?? '', placeholder: '無沖蝕針可留空' }),
      field({ label: '坍塌面積 (m²)', name: 'collapseArea_m2', type: 'number', step: '0.5', min: '0',
        value: existing?.collapseArea_m2 ?? '', placeholder: '無坍塌可留空' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '排水狀況', name: 'drainage', required: true,
        options: [
          { value: 'good', label: '良好' },
          { value: 'ponding', label: '積水' },
          { value: 'scouring', label: '淘刷' },
          { value: 'blocked', label: '阻塞' }
        ], value: existing?.drainage || 'good' }),
      field({ label: '保護工狀況', name: 'protectionStatus',
        options: [
          { value: 'none', label: '無設置' },
          { value: 'intact', label: '完好' },
          { value: 'partial', label: '局部破損' },
          { value: 'failed', label: '失效' }
        ], value: existing?.protectionStatus || 'none' })
    ),
    field({ label: '保護工類型（若有設置）', name: 'protectionType',
      options: [
        { value: '', label: '— 無 —' },
        { value: 'contour', label: '等高溝' },
        { value: 'staking', label: '打樁編柵' },
        { value: 'vegetation', label: '植生帶' },
        { value: 'concrete', label: '混凝土' },
        { value: 'masonry', label: '砌石' },
        { value: 'other', label: '其他' }
      ], value: existing?.protectionType || '' }),
    field({ label: '入侵植物覆蓋 (%)', name: 'invasiveCoverage', type: 'number', step: '1', min: '0', max: '100',
      value: existing?.invasiveCoverage ?? '' }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'soilCons', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  // 自動算 bareRatio = 100 - vegCoverage
  f.querySelector('[name=vegCoverage]').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) f.querySelector('[name=bareRatio]').value = Math.max(0, 100 - v);
  });

  updateCompareBox(stationCode);

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張定點照片'); return; }
    const fd = new FormData(f);
    const data = {
      stationCode: fd.get('stationCode'),
      eventType: fd.get('eventType'),
      eventName: fd.get('eventName').trim() || null,
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      vegCoverage: parseInt(fd.get('vegCoverage'), 10),
      bareRatio: parseInt(fd.get('bareRatio'), 10),
      erosionLevel: parseInt(fd.get('erosionLevel'), 10),
      erosionPin_cm: fd.get('erosionPin_cm') ? parseFloat(fd.get('erosionPin_cm')) : null,
      collapseArea_m2: fd.get('collapseArea_m2') ? parseFloat(fd.get('collapseArea_m2')) : null,
      drainage: fd.get('drainage'),
      protectionStatus: fd.get('protectionStatus'),
      protectionType: fd.get('protectionType') || null,
      invasiveCoverage: fd.get('invasiveCoverage') ? parseInt(fd.get('invasiveCoverage'), 10) : null,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'soilCons');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `soilcons-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯水保紀錄 ${existing.stationCode}` : '新水保紀錄', f);
}

// ===== v2.1 模組三：野生動物（wildlife）— 4 種方法切換 =====
// 一筆 = 一次觀察（直接目擊 / 痕跡 / 自動相機 / 鳴聲）
// 物種 datalist 用 ANIMALS 字典，自動帶保育等級色階
export function openWildlifeForm(project, plot, existing = null) {
  const cfg = project.methodology?.wildlifeConfig || DEFAULT_METHODOLOGY.wildlifeConfig;
  const photoReq = !!cfg.requirePhotos;

  // 動物字典 datalist（按 group 分組顯示）
  const animalList = el('datalist', { id: 'dl-animals' },
    ...ANIMALS.map(a => el('option', { value: a.zh },
      `${a.group}${a.cons ? ` [${a.cons} 級]` : ''} ｜ ${a.sci}`))
  );

  // method 切換：依選的方法顯示對應必填欄位
  const methodFields = {
    sign: null, cam: null, audio: null
  };

  const consWarn = el('div', { class: 'text-xs mt-1' });
  const speciesInput = el('input', {
    type: 'text', name: 'speciesZh', required: 'true',
    list: 'dl-animals', placeholder: '輸入或選擇',
    value: existing?.speciesZh || '',
    autocomplete: 'off',
    class: 'w-full border rounded px-2 py-1'
  });
  function updateConsWarn() {
    const a = findAnimal(speciesInput.value);
    if (a?.cons) {
      const colorMap = { 'I': '#dc2626', 'II': '#f97316', 'III': '#eab308' };
      const labelMap = { 'I': '瀕臨絕種', 'II': '珍貴稀有', 'III': '其他應予保育' };
      consWarn.innerHTML = `<span style="background:${colorMap[a.cons]};color:#fff;padding:2px 8px;border-radius:4px;font-weight:600">⚠ 第 ${a.cons} 級 — ${labelMap[a.cons]}</span> <span style="color:#57534e">${a.sci}</span>`;
    } else if (a) {
      consWarn.innerHTML = `<span style="color:#57534e">${a.group} ｜ ${a.sci}</span>`;
    } else {
      consWarn.innerHTML = '';
    }
  }
  speciesInput.addEventListener('input', updateConsWarn);
  updateConsWarn();

  // method 切換 listener
  const methodSelect = el('select', { name: 'method', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...['direct', 'sign', 'cam', 'audio'].map(m => {
      const labelMap = { direct: '直接目擊', sign: '痕跡（足印/糞便/食痕）', cam: '自動相機', audio: '鳴聲調查' };
      const opt = el('option', { value: m }, labelMap[m]);
      if (existing?.method === m) opt.setAttribute('selected', 'true');
      return opt;
    })
  );

  // 各方法專屬欄位區
  const signBox = el('div', { class: 'field hidden' },
    field({ label: '痕跡類型', name: 'signType',
      options: [
        { value: 'footprint', label: '足印' },
        { value: 'feces', label: '糞便' },
        { value: 'feeding', label: '食痕' },
        { value: 'scratching', label: '刨痕' },
        { value: 'nest', label: '巢穴' },
        { value: 'call', label: '鳴聲（聽到未見）' },
        { value: 'other', label: '其他' }
      ], value: existing?.signType || 'footprint' })
  );
  const camBox = el('div', { class: 'field hidden' },
    field({ label: '相機編號 / 點位 ID', name: 'camId',
      value: existing?.camId || '', placeholder: 'CAM-001' }),
    field({ label: '相機觸發時間', name: 'camTriggerTime', type: 'datetime-local',
      value: existing?.camTriggerTime ? toDatetimeLocal(existing.camTriggerTime) : '' })
  );
  const audioBox = el('div', { class: 'field hidden' },
    field({ label: '聽聲時長 (分鐘)', name: 'audioMinutes', type: 'number', step: '0.5', min: '0',
      value: existing?.audioMinutes ?? 5 })
  );

  function updateMethodVisibility() {
    const m = methodSelect.value;
    signBox.classList.toggle('hidden', m !== 'sign');
    camBox.classList.toggle('hidden', m !== 'cam');
    audioBox.classList.toggle('hidden', m !== 'audio');
    // 動態調整 required
    signBox.querySelector('[name=signType]').required = (m === 'sign');
    camBox.querySelector('[name=camId]').required = (m === 'cam');
    audioBox.querySelector('[name=audioMinutes]').required = (m === 'audio');
  }
  methodSelect.addEventListener('change', updateMethodVisibility);

  // v2.3.6：wildlife GPS 用共用 helper（與 plot 表單同款行為，加距 plot 中心顯示）
  const wlInitLat = existing?.location?.latitude ?? existing?.location?._lat ?? null;
  const wlInitLng = existing?.location?.longitude ?? existing?.location?._long ?? null;
  // v2.10.4：destructure 多接 manualEntry
  const { gpsBtn, gpsStatus, manualEntry: wlManualEntry, lngInput, latInput } = createGpsButton({
    initialLat: wlInitLat,
    initialLng: wlInitLng,
    showInitialAsExisting: true,
    plotForDistance: plot
  });

  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '紀錄照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（直接目擊：個體；痕跡：糞便/足印特寫；相機：原檔；音訊可免）'));

  const f = el('form', { class: 'space-y-2' },
    animalList,
    el('div', { class: 'field' },
      el('label', {}, '調查方法 ', el('span', { class: 'req' }, '*')),
      methodSelect
    ),
    el('div', { class: 'field' },
      el('label', {}, '物種中名 ', el('span', { class: 'req' }, '*')),
      speciesInput,
      consWarn
    ),
    signBox, camBox, audioBox,
    el('div', { class: 'field-row' },
      field({ label: '隻數 / 估計個體數', name: 'count', type: 'number', step: '1', min: '0', required: true,
        value: existing?.count ?? 1 }),
      field({ label: '齡別/性別', name: 'ageSex',
        options: [
          { value: '', label: '— 不確定 —' },
          { value: 'adult-M', label: '成體公' },
          { value: 'adult-F', label: '成體母' },
          { value: 'adult-U', label: '成體（性別不明）' },
          { value: 'juvenile', label: '幼體' },
          { value: 'mixed', label: '混齡' }
        ], value: existing?.ageSex || '' })
    ),
    field({ label: '行為', name: 'activity',
      options: [
        { value: '', label: '— 未確認 —' },
        { value: 'foraging', label: '覓食' },
        { value: 'resting', label: '休息' },
        { value: 'moving', label: '移動' },
        { value: 'alert', label: '警戒' },
        { value: 'breeding', label: '育幼/繁殖' },
        { value: 'calling', label: '鳴叫' }
      ], value: existing?.activity || '' }),
    field({ label: '微棲地', name: 'habitat',
      options: [
        { value: '', label: '— 未指定 —' },
        { value: 'canopy', label: '林冠層' },
        { value: 'understory', label: '林下層' },
        { value: 'ground', label: '地表' },
        { value: 'water', label: '水域' },
        { value: 'edge', label: '林緣' },
        { value: 'open', label: '空曠地' }
      ], value: existing?.habitat || '' }),
    el('div', { class: 'field-row' },
      field({ label: '調查日期', name: 'surveyDate', type: 'date', required: true,
        value: existing?.surveyDate ? (existing.surveyDate.toDate ? existing.surveyDate.toDate() : new Date(existing.surveyDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '調查場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound() })
    ),
    el('div', { class: 'field' },
      el('label', {}, '觀察點 GPS ',
        el('span', { class: 'text-xs text-stone-500' }, '（容許 plot 邊界外，會顯示距離）')),
      el('div', { class: 'flex items-center flex-wrap gap-2' }, gpsBtn, gpsStatus),
      wlManualEntry,                    // v2.10.4：手動輸入 fallback
      lngInput, latInput
    ),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註 / 行為描述', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'wildlife', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  updateMethodVisibility();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張紀錄照片'); return; }
    const fd = new FormData(f);
    const speciesZh = fd.get('speciesZh').trim();
    const a = findAnimal(speciesZh) || {};
    const lng = parseFloat(fd.get('lng'));
    const lat = parseFloat(fd.get('lat'));
    const data = {
      method: fd.get('method'),
      speciesZh,
      speciesSci: a.sci || null,
      group: a.group || null,
      conservationGrade: a.cons || null,
      count: parseInt(fd.get('count'), 10),
      ageSex: fd.get('ageSex') || null,
      activity: fd.get('activity') || null,
      habitat: fd.get('habitat') || null,
      signType: fd.get('signType') || null,
      camId: fd.get('camId')?.trim() || null,
      camTriggerTime: fd.get('camTriggerTime') ? new Date(fd.get('camTriggerTime')) : null,
      audioMinutes: fd.get('audioMinutes') ? parseFloat(fd.get('audioMinutes')) : null,
      location: (lng && lat) ? new fb.GeoPoint(lat, lng) : null,
      surveyDate: new Date(fd.get('surveyDate')),
      surveyRound: fd.get('surveyRound').trim(),
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };
    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'wildlife');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `wildlife-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : '已建立（待審核）');
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false; submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯野生動物紀錄` : '新野生動物紀錄', f);
}

// 共用：datetime-local 轉換 helper
function toDatetimeLocal(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 共用：兩點 WGS84 距離（公尺）— Haversine
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===== v2.2 模組四：經濟收穫（harvest）— 通用化命名（土肉桂為首） =====
// 紀錄綁立木個體（treeId 必填）；採後狀態同步 tree.vitality；自動算碳扣減（kg dry × 0.5 × 44/12 / 1000 = tCO₂e）
export async function openHarvestForm(project, plot, existing = null) {
  const cfg = project.methodology?.harvestConfig || DEFAULT_METHODOLOGY.harvestConfig;
  const photoReq = !!cfg.requirePhotos;
  const speciesWhitelist = cfg.species || ['土肉桂'];

  // 抓本 plot 內白名單樹種的 trees 給 treeId 下拉
  let candidateTrees = [];
  try {
    const treesSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'trees'));
    candidateTrees = treesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => speciesWhitelist.includes(t.speciesZh))
      .sort((a, b) => (a.treeNum || 0) - (b.treeNum || 0));
  } catch {}

  if (candidateTrees.length === 0 && !existing) {
    openModal('新採收紀錄', el('div', { class: 'space-y-2' },
      el('p', { class: 'text-sm' }, '此 plot 內沒有白名單樹種的立木。'),
      el('p', { class: 'text-xs text-stone-600' },
        `白名單：${speciesWhitelist.join(' / ')}（可在「設計 → 編輯方法學 → v2.2」修改）`),
      el('p', { class: 'text-xs text-stone-600' }, '請先在「立木調查」加入該樹種的立木。'),
      el('button', { type: 'button', class: 'w-full border py-2 rounded mt-3', onclick: closeModal }, '關閉')
    ));
    return;
  }

  // 找出當前選中的 tree（編輯模式）
  let selectedTree = existing
    ? candidateTrees.find(t => t.id === existing.treeId) || (existing.treeId ? { id: existing.treeId, treeNum: existing.treeNum, speciesZh: existing.speciesZh, dbh_cm: existing.dbh_at_harvest } : null)
    : candidateTrees[0];

  const treeSelect = el('select', { name: 'treeId', required: 'true', class: 'border rounded px-2 py-1 w-full' },
    ...candidateTrees.map(t => {
      const opt = el('option', { value: t.id },
        `#${t.treeNum || '?'} · ${t.speciesZh} · DBH ${t.dbh_cm?.toFixed(1) || '?'} cm`);
      if (selectedTree?.id === t.id) opt.setAttribute('selected', 'true');
      return opt;
    })
  );

  // 計算自動帶 dbh_at_harvest（從選中 tree 帶過來）
  const dbhAuto = el('div', { class: 'text-xs text-stone-500 my-1' });
  function updateTreeInfo() {
    const t = candidateTrees.find(x => x.id === treeSelect.value);
    if (t) {
      dbhAuto.textContent = `自動帶：${t.speciesZh}，原 DBH ${t.dbh_cm?.toFixed(1) || '?'} cm`;
      const dbhField = f?.querySelector('[name=dbh_at_harvest]');
      if (dbhField && !existing) dbhField.value = t.dbh_cm?.toFixed(1) || '';
    }
  }
  treeSelect.addEventListener('change', updateTreeInfo);

  // 即時碳扣減試算
  const carbonOut = el('div', { class: 'bg-stone-50 rounded p-2 text-xs my-2' });
  function updateCarbonCalc() {
    const fresh = parseFloat(f?.querySelector('[name=harvestAmount_kg_fresh]')?.value);
    let dry = parseFloat(f?.querySelector('[name=harvestAmount_kg_dry]')?.value);
    const moisture = cfg.moistureDefault ?? 0.5;
    if (!isNaN(fresh) && isNaN(dry)) {
      dry = fresh * (1 - moisture);
    }
    if (isNaN(fresh) && isNaN(dry)) { carbonOut.textContent = '輸入鮮重或乾重即時試算碳扣減'; return; }
    const dryEst = !isNaN(dry) ? dry : fresh * (1 - moisture);
    const carbonRemoved_kgC = dryEst * 0.5;  // 碳含量 50%
    const co2_kg = carbonRemoved_kgC * 44 / 12;
    carbonOut.innerHTML =
      `<div>估算乾重 <b>${dryEst.toFixed(2)}</b> kg ${isNaN(dry) ? `（從鮮重×${(1 - moisture).toFixed(2)}）` : ''}</div>` +
      `<div>碳扣減 <b>${(carbonRemoved_kgC / 1000).toFixed(4)}</b> t-C ｜ CO₂ 扣減 <b>${(co2_kg / 1000).toFixed(4)}</b> tCO₂e</div>`;
  }

  // 照片上傳
  const photoUp = photoUploader({ existing: existing?.photos || [] });
  const photoLabel = el('label', {}, '採收照片', photoReq ? el('span', { class: 'req' }, ' *') : null,
    el('span', { class: 'text-xs text-stone-500 ml-1' }, '（採前 / 採後 / 產品 至少一張）'));

  const f = el('form', { class: 'space-y-2' },
    el('div', { class: 'field' },
      el('label', {}, '採收個體 ', el('span', { class: 'req' }, '*')),
      treeSelect,
      dbhAuto
    ),
    el('div', { class: 'field-row' },
      field({ label: '採收日期', name: 'harvestDate', type: 'date', required: true,
        value: existing?.harvestDate ? (existing.harvestDate.toDate ? existing.harvestDate.toDate() : new Date(existing.harvestDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10) }),
      field({ label: '場次', name: 'surveyRound', required: true,
        value: existing?.surveyRound || currentSurveyRound() })
    ),
    el('div', { class: 'field-row' },
      field({ label: '採收部位', name: 'harvestType', required: true,
        options: [
          { value: 'bark', label: '樹皮' },
          { value: 'leaves', label: '嫩葉' },
          { value: 'twigs', label: '嫩枝' },
          { value: 'flowers', label: '花' },
          { value: 'roots', label: '根' },
          { value: 'whole', label: '全株' }
        ], value: existing?.harvestType || 'bark' }),
      field({ label: '採收方式', name: 'harvestMethod', required: true,
        options: [
          { value: 'half-bark', label: '半皮取（保留樹幹存活）' },
          { value: 'ring', label: '環剝' },
          { value: 'leaf-pruning', label: '剪葉' },
          { value: 'branch-pruning', label: '枝條修剪' },
          { value: 'coppice', label: '全砍重萌（萌芽更新）' },
          { value: 'root-dig', label: '挖根' }
        ], value: existing?.harvestMethod || 'half-bark' })
    ),
    el('div', { class: 'field-row' },
      field({ label: '鮮重 (kg)', name: 'harvestAmount_kg_fresh', type: 'number', step: '0.01', min: '0', required: true,
        value: existing?.harvestAmount_kg_fresh ?? '' }),
      field({ label: '乾重 (kg) — 可後補', name: 'harvestAmount_kg_dry', type: 'number', step: '0.01', min: '0',
        value: existing?.harvestAmount_kg_dry ?? '' })
    ),
    field({ label: '採收時 DBH (cm)', name: 'dbh_at_harvest', type: 'number', step: '0.1', min: '0', required: true,
      value: existing?.dbh_at_harvest ?? selectedTree?.dbh_cm ?? '' }),
    carbonOut,
    field({ label: '產品用途', name: 'productUse',
      options: [
        { value: '', label: '— 未指定 —' },
        { value: 'essential-oil', label: '精油' },
        { value: 'powder', label: '桂皮粉 / 香料粉' },
        { value: 'tea', label: '茶飲' },
        { value: 'seedling', label: '種苗' },
        { value: 'medicinal', label: '藥用' },
        { value: 'other', label: '其他' }
      ], value: existing?.productUse || '' }),
    field({ label: '採後植株狀態', name: 'treeStatusAfter', required: true,
      options: [
        { value: 'kept-resprout', label: '存活並重萌（半皮取常見）' },
        { value: 'kept-no-sprout', label: '存活未萌（觀察期）' },
        { value: 'dead', label: '枯死' },
        { value: 'removed', label: '砍除根除（→ 自動 set tree 為 standing-dead）' }
      ], value: existing?.treeStatusAfter || 'kept-resprout' }),
    field({ label: '預計下次回測日期', name: 'nextSurveyDate', type: 'date',
      value: existing?.nextSurveyDate ? (existing.nextSurveyDate.toDate ? existing.nextSurveyDate.toDate() : new Date(existing.nextSurveyDate)).toISOString().slice(0, 10) : '' }),
    el('div', { class: 'field' }, photoLabel, photoUp.element),
    field({ label: '備註 / 萌芽情形描述', name: 'notes', type: 'textarea', value: existing?.notes || '' }),
    el('div', { class: 'flex gap-2 pt-2' },
      el('button', { type: 'submit', class: 'flex-1 bg-forest-700 text-white py-2 rounded' }, '儲存'),
      existing ? el('button', { type: 'button', class: 'border py-2 px-3 rounded text-red-600',
        onclick: () => deleteSubdoc(project, plot, 'harvest', existing) }, '刪除') : null,
      el('button', { type: 'button', class: 'flex-1 border py-2 rounded', onclick: closeModal }, '取消')
    )
  );

  // 即時試算
  f.querySelector('[name=harvestAmount_kg_fresh]').addEventListener('input', updateCarbonCalc);
  f.querySelector('[name=harvestAmount_kg_dry]').addEventListener('input', updateCarbonCalc);
  updateCarbonCalc();
  updateTreeInfo();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoReq && photoUp.count === 0) { toast('方法學要求至少一張採收照片'); return; }
    const fd = new FormData(f);
    const treeId = fd.get('treeId');
    const tree = candidateTrees.find(t => t.id === treeId);
    const fresh = parseFloat(fd.get('harvestAmount_kg_fresh'));
    let dry = parseFloat(fd.get('harvestAmount_kg_dry'));
    const moisture = cfg.moistureDefault ?? 0.5;
    if (isNaN(dry)) dry = fresh * (1 - moisture);
    const carbonRemoved_kgC = dry * 0.5;
    const carbonRemoved_tCO2e = (carbonRemoved_kgC * 44 / 12) / 1000;

    const treeStatusAfter = fd.get('treeStatusAfter');
    const data = {
      treeId,
      treeNum: tree?.treeNum || existing?.treeNum || null,
      speciesZh: tree?.speciesZh || existing?.speciesZh || null,
      harvestDate: new Date(fd.get('harvestDate')),
      surveyRound: fd.get('surveyRound').trim(),
      harvestType: fd.get('harvestType'),
      harvestMethod: fd.get('harvestMethod'),
      harvestAmount_kg_fresh: fresh,
      harvestAmount_kg_dry: !isNaN(parseFloat(fd.get('harvestAmount_kg_dry'))) ? parseFloat(fd.get('harvestAmount_kg_dry')) : null,
      dryEstimated_kg: dry,                   // 永遠存估算結果
      moistureContent: moisture,
      carbonRemoved_kgC: +carbonRemoved_kgC.toFixed(3),
      carbonRemoved_tCO2e: +carbonRemoved_tCO2e.toFixed(6),
      dbh_at_harvest: parseFloat(fd.get('dbh_at_harvest')),
      productUse: fd.get('productUse') || null,
      treeStatusAfter,
      nextSurveyDate: fd.get('nextSurveyDate') ? new Date(fd.get('nextSurveyDate')) : null,
      notes: fd.get('notes').trim() || null,
      updatedAt: fb.serverTimestamp()
    };

    const submitBtn = f.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = '儲存中...';
    try {
      const colRef = fb.collection(fb.db, 'projects', project.id, 'plots', plot.id, 'harvest');
      let docId;
      if (existing) {
        docId = existing.id;
        const _didReset = applySurveyorReQaReset(data, existing);
        await fb.updateDoc(fb.doc(colRef, docId), data);
        await maybeDemoteAfterReset(project, _didReset);
      } else {
        data.createdBy = state.user.uid;
        data.createdAt = fb.serverTimestamp();
        data.qaStatus = 'pending';
        const ref = await fb.addDoc(colRef, data);
        docId = ref.id;
      }
      if (photoUp.count > 0 || (existing?.photos?.length ?? 0) > 0) {
        if (photoUp.count > 0) submitBtn.textContent = '上傳照片中...';
        const photos = await photoUp.commit({
          projectId: project.id, plotId: plot.id, prefix: `harvest-${docId}`
        });
        await fb.updateDoc(fb.doc(colRef, docId), { photos });
      }
      // tree 雙向同步：砍除根除 → 自動 set tree.vitality='standing-dead'
      if (treeStatusAfter === 'removed' && tree) {
        try {
          await fb.updateDoc(
            fb.doc(fb.db, 'projects', project.id, 'plots', plot.id, 'trees', tree.id),
            {
              vitality: 'standing-dead',
              harvestedAt: data.harvestDate,
              harvestRemovedBy: state.user.uid,
              updatedAt: fb.serverTimestamp()
            }
          );
        } catch (e) { console.warn('tree vitality sync failed:', e.message); }
      }
      toast(existing
        ? (data.qaStatus === 'pending' ? '已更新（重新送審）' : '已更新')
        : (treeStatusAfter === 'removed' ? '已建立 + tree 已標記枯立' : '已建立（待審核）'));
      closeModal();
    } catch (e) {
      toast('儲存失敗：' + e.message);
      submitBtn.disabled = false; submitBtn.textContent = '儲存';
    }
  });
  openModal(existing ? `編輯採收紀錄 #${existing.treeNum}` : '新採收紀錄', f);
}

// ===== Seed Demo Data =====
export async function seedDemoData(project) {
  if (!confirm('將灌入 3 個示範樣區（蓮華池附近虛構座標）+ 約 30 株立木 + 約 20 筆更新。繼續？')) return;
  toast('灌入中...');
  try {
    // 三個示範樣區（蓮華池研究中心附近）
    // v2.8.3：rectangle 20×25 為台灣永久樣區慣例 → 改一半 demo 為 rectangle，其餘保留 circle/square 作對照
    const demoPlots = [
      { code: `${project.code}-001`, lat: 23.9176, lng: 120.8838, forestUnit: '示範-1', shape: 'rectangle', area_m2: 500, notes: '柳杉人工林（20×25 矩形，台灣永久樣區慣例）' },
      { code: `${project.code}-002`, lat: 23.9192, lng: 120.8856, forestUnit: '示範-2', shape: 'square', area_m2: 400, notes: '天然闊葉林（方形對照組）' },
      { code: `${project.code}-003`, lat: 23.9158, lng: 120.8821, forestUnit: '示範-1', shape: 'rectangle', area_m2: 500, notes: '混合林（20×25 矩形）' }
    ];
    // v2.7.16：seed plots 帶 v2.6 schema 欄位（slope=0 平地、dimensionType 從 methodology）
    // v2.8.3：rectangle shape 用 20×25（500 m²）；其他形狀沿用既有計算
    const dimType = project?.methodology?.dimensionType || 'slope_distance';
    for (const p of demoPlots) {
      const t97 = wgs84ToTwd97(p.lng, p.lat);
      let dims;
      if (p.shape === 'circle') dims = { radius: Math.sqrt(p.area_m2 / Math.PI) };
      else if (p.shape === 'rectangle') dims = { width: 20, length: 25 };  // 台灣永久樣區
      else dims = { side: Math.sqrt(p.area_m2), width: Math.sqrt(p.area_m2), length: Math.sqrt(p.area_m2) };
      const plotRef = await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots'), {
        code: p.code,
        forestUnit: p.forestUnit,
        location: new fb.GeoPoint(p.lat, p.lng),
        locationTWD97: { x: t97.x, y: t97.y },
        shape: p.shape,
        area_m2: p.area_m2,
        // v2.7.16 / v2.8.4
        plotDimensions: dims,
        slopeDegrees: 0,
        slopeWidthDeg: 0,
        slopeLengthDeg: 0,
        slopeAspect: null,
        slopeSource: null,
        dimensionType: dimType,
        areaHorizontal_m2: p.area_m2,
        migrationPending: false,
        // v2.7.17：QAQC 預設
        qaqc: defaultQaqc(),
        establishedAt: new Date(),
        notes: p.notes,
        // v2.11.94：移除 insideBoundary 硬編 true（見 analytics.getPlotBoundaryStatus 即時套疊）
        createdBy: state.user.uid,
        createdAt: fb.serverTimestamp(),
        updatedAt: fb.serverTimestamp()
      });
      // 每個樣區 8-12 株假立木
      const n = 8 + Math.floor(Math.random() * 5);
      for (let i = 1; i <= n; i++) {
        const sp = SPECIES[Math.floor(Math.random() * 12)];
        const dbh = +(15 + Math.random() * 50).toFixed(1);
        const h = +(8 + Math.random() * 15).toFixed(1);
        const m = calcTreeMetrics({ dbh_cm: dbh, height_m: h, speciesZh: sp.zh, speciesSci: sp.sci });
        const vitOpts = ['healthy', 'healthy', 'healthy', 'weak', 'standing-dead'];
        await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots', plotRef.id, 'trees'), {
          treeNum: i,
          speciesZh: sp.zh, speciesSci: sp.sci, conservationGrade: sp.cons || null,
          dbh_cm: dbh, height_m: h,
          vitality: vitOpts[Math.floor(Math.random() * vitOpts.length)],
          pestSymptoms: Math.random() < 0.2 ? ['葉斑'] : [],
          marking: 'paint',
          ...m,
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
          qaStatus: 'pending',
          // v2.8.1：seed tree 帶 QAQC 預設子結構
          qaqc: defaultTreeQaqc()
        });
      }
      // 更新記錄 5-8 筆
      const rn = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < rn; i++) {
        const sp = SPECIES[Math.floor(Math.random() * 12)];
        const hc = ['<30', '30-130', '>130'][Math.floor(Math.random() * 3)];
        await fb.addDoc(fb.collection(fb.db, 'projects', project.id, 'plots', plotRef.id, 'regeneration'), {
          speciesZh: sp.zh, speciesSci: sp.sci,
          heightClass: hc,
          count: Math.floor(Math.random() * 30) + 1,
          competitionCover_pct: Math.floor(Math.random() * 80),
          createdBy: state.user.uid,
          createdAt: fb.serverTimestamp(),
          qaStatus: 'pending'
        });
      }
    }
    toast('示範資料已灌入！');
  } catch (e) { toast('灌入失敗：' + e.message); }
}
