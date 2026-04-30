// ===== analytics.js — v1.5 儀表板 + 地圖 + 匯出（含 QA 統計、reviewer 匿名化）=====

import { fb, $, $$, el, toast, state, isReviewer, anonName, userLabel } from './app.js';
// v2.3：階段 2 — 進度 KPI 用全 6 子集合 verified 比例
import { computeProgress, STATUS, STATUS_META } from './project-status.js?v=28040';
// v2.7.17：QAQC 工作流（給匯出 QAQC sheet 使用）
// v2.8.1：tree-level QAQC（給匯出立木 QAQC sheet 使用）
import { getPlotQaqcStatus, getTreeQaqcStatus, QAQC_STATUS_META, RESOLUTION_LABEL, computeErrorStats, computeTreeErrorStats, DEFAULT_QAQC_CONFIG } from './plot-qaqc.js?v=28040';

// 共用：抓取本專案所有樣區與立木 + v2.0 地被/水保 + v2.1 野生動物 + v2.2 經濟收穫
async function fetchAllData(project) {
  const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
  const plots = [];
  const trees = [];
  const regen = [];
  const understory = [];   // v2.0
  const soilCons = [];     // v2.0
  const wildlife = [];     // v2.1
  const harvest = [];      // v2.2
  for (const pd of plotsSnap.docs) {
    const plot = { id: pd.id, ...pd.data() };
    plots.push(plot);
    const tSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'trees'));
    tSnap.forEach(td => trees.push({ id: td.id, plotId: pd.id, plotCode: plot.code, ...td.data() }));
    const rSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'regeneration'));
    rSnap.forEach(rd => regen.push({ id: rd.id, plotId: pd.id, plotCode: plot.code, ...rd.data() }));
    try {
      const uSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'understory'));
      uSnap.forEach(ud => understory.push({ id: ud.id, plotId: pd.id, plotCode: plot.code, ...ud.data() }));
    } catch {}
    try {
      const sSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'soilCons'));
      sSnap.forEach(sd => soilCons.push({ id: sd.id, plotId: pd.id, plotCode: plot.code, ...sd.data() }));
    } catch {}
    try {
      const wSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'wildlife'));
      wSnap.forEach(wd => wildlife.push({ id: wd.id, plotId: pd.id, plotCode: plot.code, ...wd.data() }));
    } catch {}
    try {
      const hSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'harvest'));
      hSnap.forEach(hd => harvest.push({ id: hd.id, plotId: pd.id, plotCode: plot.code, ...hd.data() }));
    } catch {}
  }
  return { plots, trees, regen, understory, soilCons, wildlife, harvest };
}

// 全域 chart instances（避免重畫時重疊）
const _charts = {};
function killChart(key) { if (_charts[key]) { _charts[key].destroy(); delete _charts[key]; } }

// ===== Dashboard =====
export async function renderDashboard(project) {
  const { plots, trees, understory, soilCons, wildlife, harvest } = await fetchAllData(project);
  // v2.3：QA 進度（全 6 子集合 + plots，排除 shell）
  let progress = null;
  try { progress = await computeProgress(project.id); } catch {}

  // 摘要 KPI
  const totalArea = plots.reduce((s, p) => s + (p.area_m2 || 0), 0);
  const totalTrees = trees.length;
  const totalBA = trees.reduce((s, t) => s + (t.basalArea_m2 || 0), 0);
  const totalV = trees.reduce((s, t) => s + (t.volume_m3 || 0), 0);
  const totalC = trees.reduce((s, t) => s + (t.carbon_kg || 0), 0);
  const totalCO2 = trees.reduce((s, t) => s + (t.co2_kg || 0), 0);  // v1.6.20
  const cBox = $('#dashboard-summary');
  cBox.innerHTML = '';

  // v2.3：進度狀態卡（跨 2 欄寬度，最顯眼位置）
  if (progress) {
    const status = project.status || STATUS.ACTIVE;
    const meta = STATUS_META[status] || STATUS_META.active;
    const pct = progress.total > 0 ? Math.round(100 * progress.verified / progress.total) : 0;
    const card = el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2' },
      el('div', { class: 'flex items-center justify-between mb-2' },
        el('div', { class: 'text-xs text-stone-500' }, '專案進度'),
        el('span', { html: `<span class="${meta.badgeCls} text-xs px-2 py-0.5 rounded">${meta.label}</span>` })
      ),
      el('div', { class: 'flex items-baseline gap-2' },
        el('div', { class: 'text-2xl font-bold' }, `${pct}%`),
        el('div', { class: 'text-xs text-stone-500' }, `${progress.verified} / ${progress.total} verified`)
      ),
      el('div', { class: 'mt-2 w-full bg-stone-100 rounded-full h-2 overflow-hidden' },
        el('div', { class: 'bg-green-500 h-2 rounded-full transition-all', style: `width:${pct}%` })
      ),
      el('div', { class: 'flex gap-2 text-xs text-stone-500 mt-1 flex-wrap' },
        progress.pending > 0  ? el('span', {}, `⏳ ${progress.pending} 待審`) : null,
        progress.flagged > 0  ? el('span', { class: 'text-amber-700' }, `⚠ ${progress.flagged} flagged`) : null,
        progress.rejected > 0 ? el('span', { class: 'text-red-600' }, `✕ ${progress.rejected} rejected`) : null
      )
    );
    cBox.appendChild(card);
  }

  const kpis = [
    ['樣區數', plots.length],
    ['總調查面積', `${totalArea} m²`],
    ['立木總數', totalTrees],
    ['總材積', `${totalV.toFixed(2)} m³`],
    ['總斷面積', `${totalBA.toFixed(2)} m²`],
    ['總碳蓄積', `${(totalC / 1000).toFixed(2)} t-C`],
    ['總 CO₂ 當量', `${(totalCO2 / 1000).toFixed(2)} t-CO₂`]
  ];
  kpis.forEach(([k, v]) => cBox.appendChild(
    el('div', { class: 'bg-white rounded-lg shadow p-3' },
      el('div', { class: 'text-xs text-stone-500' }, k),
      el('div', { class: 'text-xl font-bold' }, String(v))
    )
  ));

  // 直徑分布（5 cm 一級）
  killChart('dbh');
  const bins = {};
  trees.forEach(t => {
    if (!t.dbh_cm) return;
    const b = Math.floor(t.dbh_cm / 5) * 5;
    bins[b] = (bins[b] || 0) + 1;
  });
  const labels = Object.keys(bins).map(Number).sort((a, b) => a - b);
  _charts.dbh = new Chart($('#chart-dbh'), {
    type: 'bar',
    data: {
      labels: labels.map(l => `${l}-${l + 5}`),
      datasets: [{ label: '株數', data: labels.map(l => bins[l]), backgroundColor: '#15803d' }]
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'DBH (cm)' } }, y: { title: { display: true, text: '株數' } } } }
  });

  // 樹種重要值（IV = 相對密度 + 相對優勢度）
  killChart('iv');
  const sp = {};
  trees.forEach(t => {
    if (!t.speciesZh) return;
    sp[t.speciesZh] = sp[t.speciesZh] || { count: 0, ba: 0 };
    sp[t.speciesZh].count++;
    sp[t.speciesZh].ba += t.basalArea_m2 || 0;
  });
  const totalBAall = Object.values(sp).reduce((s, x) => s + x.ba, 0) || 1;
  const totalCount = trees.length || 1;
  const ivList = Object.entries(sp).map(([name, v]) => ({
    name,
    iv: 100 * (v.count / totalCount + v.ba / totalBAall) / 2
  })).sort((a, b) => b.iv - a.iv).slice(0, 10);
  _charts.iv = new Chart($('#chart-iv'), {
    type: 'bar',
    data: {
      labels: ivList.map(x => x.name),
      datasets: [{ label: 'IV (%)', data: ivList.map(x => +x.iv.toFixed(1)), backgroundColor: '#65a30d' }]
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  // 健康狀態 (donut)
  killChart('vitality');
  const vCount = { healthy: 0, weak: 0, 'standing-dead': 0, fallen: 0 };
  trees.forEach(t => { if (t.vitality && vCount[t.vitality] != null) vCount[t.vitality]++; });
  _charts.vitality = new Chart($('#chart-vitality'), {
    type: 'doughnut',
    data: {
      labels: ['健康', '衰弱', '枯立', '倒伏'],
      datasets: [{
        data: [vCount.healthy, vCount.weak, vCount['standing-dead'], vCount.fallen],
        backgroundColor: ['#16a34a', '#eab308', '#a8a29e', '#dc2626']
      }]
    }
  });

  // v2.0：新增模組摘要 KPI（若啟用）
  const mods = project.methodology?.modules || {};
  if (mods.understory && understory.length > 0) {
    const totalSpecies = understory.reduce((s, u) => s + (u.species || []).length, 0);
    const totalInvasive = understory.reduce((s, u) => s + (u.invasiveCount || 0), 0);
    const avgCov = understory.reduce((s, u) => s + (u.totalCoverage || 0), 0) / understory.length;
    cBox.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2 sm:col-span-2 border-l-4 border-emerald-500' },
      el('div', { class: 'text-xs text-stone-500' }, '🌿 地被植物'),
      el('div', { class: 'text-sm' }, `${understory.length} 樣方次 · 物種紀錄 ${totalSpecies}`),
      el('div', { class: 'text-sm' }, `平均覆蓋 ${avgCov.toFixed(0)}% · ⚠ 入侵 ${totalInvasive}`)
    ));
  }
  if (mods.soilCons && soilCons.length > 0) {
    const highErosion = soilCons.filter(s => s.erosionLevel >= 4).length;
    const avgVeg = soilCons.reduce((s, x) => s + (x.vegCoverage || 0), 0) / soilCons.length;
    cBox.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2 sm:col-span-2 border-l-4 border-amber-600' },
      el('div', { class: 'text-xs text-stone-500' }, '⛰️ 水土保持'),
      el('div', { class: 'text-sm' }, `${soilCons.length} 紀錄 · 平均植覆 ${avgVeg.toFixed(0)}%`),
      el('div', { class: 'text-sm' + (highErosion > 0 ? ' text-red-700 font-medium' : '') },
        `沖蝕 ≥ 4 級：${highErosion} 點次${highErosion > 0 ? ' ⚠' : ''}`)
    ));
  }
  // v2.1：野生動物 KPI
  if (mods.wildlife && wildlife.length > 0) {
    const uniqueSpecies = new Set(wildlife.map(w => w.speciesZh)).size;
    const consI = wildlife.filter(w => w.conservationGrade === 'I').length;
    const consII = wildlife.filter(w => w.conservationGrade === 'II').length;
    cBox.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2 sm:col-span-2 border-l-4 border-yellow-600' },
      el('div', { class: 'text-xs text-stone-500' }, '🦌 野生動物'),
      el('div', { class: 'text-sm' }, `${wildlife.length} 筆紀錄 · 物種 ${uniqueSpecies}`),
      el('div', { class: 'text-sm' + (consI > 0 ? ' text-red-700 font-medium' : '') },
        `保育類 I 級 ${consI} · II 級 ${consII}`)
    ));
  }
  // v2.2：經濟收穫 KPI（年度累計碳扣減）
  if (mods.harvest && harvest.length > 0) {
    const totalFresh = harvest.reduce((s, h) => s + (h.harvestAmount_kg_fresh || 0), 0);
    const totalCO2 = harvest.reduce((s, h) => s + (h.carbonRemoved_tCO2e || 0), 0);
    const removed = harvest.filter(h => h.treeStatusAfter === 'removed').length;
    cBox.appendChild(el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2 sm:col-span-2 border-l-4 border-orange-600' },
      el('div', { class: 'text-xs text-stone-500' }, '🌰 經濟收穫'),
      el('div', { class: 'text-sm' }, `${harvest.length} 筆 · 鮮重 ${totalFresh.toFixed(2)} kg`),
      el('div', { class: 'text-sm text-orange-700 font-medium' },
        `CO₂ 扣減 ${totalCO2.toFixed(4)} tCO₂e · 砍除 ${removed}`)
    ));
  }

  // QA 狀態（全模組合計）
  const qaCount = { pending: 0, verified: 0, flagged: 0, rejected: 0 };
  [...plots, ...trees, ...understory, ...soilCons, ...wildlife, ...harvest].forEach(d => {
    const s = d.qaStatus || 'pending';
    if (qaCount[s] != null) qaCount[s]++;
  });
  // 在 KPI 區追加一張 QA 摘要小卡（用既有的 dashboard-summary）
  const qaTotal = qaCount.pending + qaCount.verified + qaCount.flagged + qaCount.rejected;
  if (qaTotal > 0) {
    const qaCard = el('div', { class: 'bg-white rounded-lg shadow p-3 col-span-2 sm:col-span-4' },
      el('div', { class: 'text-xs text-stone-500 mb-1' }, 'QA 進度'),
      el('div', { class: 'flex gap-3 text-sm flex-wrap' },
        el('span', {}, `⚪ pending ${qaCount.pending}`),
        el('span', { class: 'text-green-700' }, `✓ verified ${qaCount.verified}`),
        el('span', { class: 'text-amber-700' }, `⚠ flagged ${qaCount.flagged}`),
        el('span', { class: 'text-red-700' }, `✕ rejected ${qaCount.rejected}`),
        el('span', { class: 'text-stone-600' }, `（${Math.round(qaCount.verified / qaTotal * 100)}% 已通過）`)
      )
    );
    cBox.appendChild(qaCard);
  }
}

// ===== Map =====
let _map = null;
let _layerGroup = null;
export async function renderMap(project) {
  const mapEl = $('#map');
  if (_map) { _map.remove(); _map = null; }
  _map = L.map('map').setView([23.9176, 120.8838], 13);  // 預設蓮華池
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(_map);
  _layerGroup = L.layerGroup().addTo(_map);

  const { plots, trees } = await fetchAllData(project);
  if (plots.length === 0) { toast('還沒有樣區可顯示'); return; }

  const points = [];
  plots.forEach(p => {
    if (!p.location) return;
    const lat = p.location.latitude || p.location._lat;
    const lng = p.location.longitude || p.location._long;
    points.push([lat, lng]);
    const tCount = trees.filter(t => t.plotId === p.id).length;
    // QA 狀態決定顏色
    const qaColor = { pending: '#a8a29e', verified: '#15803d', flagged: '#eab308', rejected: '#dc2626' };
    const dotColor = qaColor[p.qaStatus] || '#15803d';
    const surveyorLabel = isReviewer() ? anonName(p.createdBy) : userLabel(p.createdBy, '—');
    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: p.insideBoundary === false ? '#dc2626' : dotColor,
      fillColor: dotColor,
      fillOpacity: 0.7,
      weight: 2
    }).bindPopup(`
      <strong>${p.code}</strong> <span style="font-size:11px;background:#f5f5f4;padding:1px 4px;border-radius:3px">${p.qaStatus || 'pending'}</span><br>
      ${p.forestUnit || ''} · ${({ circle: '圓', square: '方', rectangle: '矩', irregular: '不規則' })[p.shape] || '方'} ${p.area_m2 ? Math.round(p.area_m2) : '?'}m²${p.shape === 'irregular' && Array.isArray(p.plotDimensions?.vertices) ? ' · ' + p.plotDimensions.vertices.length + '頂點' : ''}${Number.isFinite(p.slopeDegrees) && p.slopeDegrees > 0 ? ` · 坡 ${p.slopeDegrees.toFixed(0)}°` : ''}<br>
      立木 ${tCount} 株<br>
      調查者：${surveyorLabel}<br>
      <a href="#/p/${project.id}/plot/${p.id}">→ 開啟樣區</a>
    `);
    _layerGroup.addLayer(marker);
  });
  if (points.length > 0) _map.fitBounds(points, { padding: [40, 40] });
}

// ===== 匯出 =====
export async function exportXlsx(project) {
  toast('準備匯出...');
  const { plots, trees, regen, understory, soilCons, wildlife, harvest } = await fetchAllData(project);
  const wb = XLSX.utils.book_new();

  const anonOrReal = (uid) => isReviewer() ? anonName(uid) : uid;
  const plotsRows = plots.map(p => ({
    樣區編號: p.code,
    林班小班: p.forestUnit || '',
    形狀: p.shape,
    面積_m2: p.area_m2,
    // v2.7.16：樣區幾何 + 坡度修正欄位（IPCC TACCC 對齊：透明、可比、完整、一致）
    // v2.8.0：irregular 加頂點數與 bbox
    寬_m: p.plotDimensions?.width ?? '',
    長_m: p.plotDimensions?.length ?? '',
    半徑_m: p.plotDimensions?.radius ?? '',
    頂點數: (p.shape === 'irregular' && Array.isArray(p.plotDimensions?.vertices)) ? p.plotDimensions.vertices.length : '',
    bbox_寬_m: (p.shape === 'irregular' && p.plotDimensions?.bbox) ? (p.plotDimensions.bbox.maxX - p.plotDimensions.bbox.minX).toFixed(2) : '',
    bbox_長_m: (p.shape === 'irregular' && p.plotDimensions?.bbox) ? (p.plotDimensions.bbox.maxY - p.plotDimensions.bbox.minY).toFixed(2) : '',
    多邊形來源: p.plotDimensions?.sourceInfo || '',
    坡度_度: Number.isFinite(p.slopeDegrees) ? p.slopeDegrees : '',
    坡向_度: p.slopeAspect ?? '',
    坡度來源: p.slopeSource || '',
    量測單位: p.dimensionType || '',
    水平投影面積_m2: p.areaHorizontal_m2 ?? '',
    經度_WGS84: p.location?.longitude || p.location?._long,
    緯度_WGS84: p.location?.latitude || p.location?._lat,
    TWD97_X: p.locationTWD97?.x,
    TWD97_Y: p.locationTWD97?.y,
    GPS精度_m: p.locationAccuracy_m,
    在範圍內: p.insideBoundary,
    設置日期: fmtDate(p.establishedAt),
    建立者: anonOrReal(p.createdBy),
    QA狀態: p.qaStatus || 'pending',
    QA評論: p.qaComment || '',
    備註: p.notes || ''
  }));
  const treesRows = trees.map(t => ({
    樣區: t.plotCode,
    序號: t.treeNum,
    // v2.3.3：完整個體編號（DEMO-010-001 格式），舊資料即時 derive
    個體編號: t.treeCode || `${t.plotCode}-${String(t.treeNum || 0).padStart(3, '0')}`,
    中名: t.speciesZh,
    學名: t.speciesSci || '',
    保育等級: t.conservationGrade || '',
    DBH_cm: t.dbh_cm,
    H_m: t.height_m,
    枝下高_m: t.branchHeight_m || '',
    活力: t.vitality,
    病蟲害: (t.pestSymptoms || []).join(';'),
    標記: t.marking,
    斷面積_m2: t.basalArea_m2,
    材積_m3: t.volume_m3,
    生物量_kg: t.biomass_kg || '',
    碳量_kg: t.carbon_kg,
    CO2當量_kg: t.co2_kg || '',
    建立者: anonOrReal(t.createdBy),
    QA狀態: t.qaStatus || 'pending',
    QA評論: t.qaComment || '',
    備註: t.notes || ''
  }));
  const regenRows = regen.map(r => ({
    樣區: r.plotCode,
    中名: r.speciesZh,
    學名: r.speciesSci || '',
    苗高分級: r.heightClass,
    株數: r.count,
    競爭覆蓋_pct: r.competitionCover_pct,
    備註: r.notes || ''
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plotsRows), '樣區');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(treesRows), '立木');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regenRows), '更新');

  // v2.7.17：QAQC 抽樣查證表（reviewer 抽樣 → 重測 → 誤差 → 處置）+ 面積換算說明
  const qaqcRows = plots
    .filter(p => p.qaqc?.inSample === true || p.qaqc?.verifiedAt != null)
    .map(p => {
      const q = p.qaqc || {};
      const status = getPlotQaqcStatus(p);
      return {
        樣區編號: p.code,
        抽樣理由: q.sampleReason || '',
        抽樣時間: q.sampledAt ? fmtDate(q.sampledAt) : '',
        抽樣者: q.sampledBy ? anonOrReal(q.sampledBy) : '',
        surveyor原坡度_度: Number.isFinite(p.slopeDegrees) ? p.slopeDegrees : '',
        reviewer重測坡度_度: Number.isFinite(q.slopeVerified) ? q.slopeVerified : '',
        坡度誤差_度: Number.isFinite(q.slopeError_deg) ? q.slopeError_deg : '',
        surveyor原水平面積_m2: Number.isFinite(p.areaHorizontal_m2) ? p.areaHorizontal_m2 : '',
        reviewer重測水平面積_m2: Number.isFinite(q.areaVerifiedHorizontal) ? q.areaVerifiedHorizontal : '',
        面積誤差_pct: Number.isFinite(q.areaError_pct) ? q.areaError_pct : '',
        通過閾值: q.withinThreshold === true ? '✅' : (q.withinThreshold === false ? '❌' : ''),
        重測時間: q.verifiedAt ? fmtDate(q.verifiedAt) : '',
        重測者: q.verifiedBy ? anonOrReal(q.verifiedBy) : '',
        QAQC狀態: QAQC_STATUS_META[status]?.label || '',
        處置: q.resolution ? (RESOLUTION_LABEL[q.resolution] || q.resolution) : '',
        處置說明: q.resolutionNote || '',
        處置時間: q.resolvedAt ? fmtDate(q.resolvedAt) : '',
      };
    });
  if (qaqcRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qaqcRows), 'QAQC抽樣查證');
  }

  // v2.8.1：立木層級 QAQC sheet（trees with qaqc.inSample=true）
  const treeQaqcRows = trees.filter(t => t.qaqc?.inSample === true || t.qaqc?.verifiedAt != null).map(t => {
    const q = t.qaqc || {};
    const status = getTreeQaqcStatus(t);
    return {
      樣區: t.plotCode || '',
      立木編號: t.treeCode || ('#' + (t.treeNum || '')),
      樹種: t.speciesZh || '',
      抽樣時間: q.sampledAt ? fmtDate(q.sampledAt) : '',
      抽樣者: q.sampledBy ? anonOrReal(q.sampledBy) : '',
      surveyor原DBH_cm: Number.isFinite(t.dbh_cm) ? t.dbh_cm : '',
      reviewer重測DBH_cm: Number.isFinite(q.dbhVerified) ? q.dbhVerified : '',
      DBH誤差_cm: Number.isFinite(q.dbhError_cm) ? q.dbhError_cm : '',
      DBH誤差_pct: Number.isFinite(q.dbhError_pct) ? q.dbhError_pct : '',
      surveyor原H_m: Number.isFinite(t.height_m) ? t.height_m : '',
      reviewer重測H_m: Number.isFinite(q.heightVerified) ? q.heightVerified : '',
      H誤差_m: Number.isFinite(q.heightError_m) ? q.heightError_m : '',
      H誤差_pct: Number.isFinite(q.heightError_pct) ? q.heightError_pct : '',
      surveyor原X_m: Number.isFinite(t.localX_m) ? t.localX_m : '',
      surveyor原Y_m: Number.isFinite(t.localY_m) ? t.localY_m : '',
      reviewer重測X_m: Number.isFinite(q.localXVerified) ? q.localXVerified : '',
      reviewer重測Y_m: Number.isFinite(q.localYVerified) ? q.localYVerified : '',
      位置誤差_m: Number.isFinite(q.positionError_m) ? q.positionError_m : '',
      通過閾值: q.withinThreshold === true ? '✅' : (q.withinThreshold === false ? '❌' : ''),
      重測時間: q.verifiedAt ? fmtDate(q.verifiedAt) : '',
      重測者: q.verifiedBy ? anonOrReal(q.verifiedBy) : '',
      QAQC狀態: ({
        not_sampled: '不在抽樣', pending: '待重測', passed: '通過',
        failed_unresolved: '超閾待處置', failed_resolved: '已處置'
      })[status] || '',
      處置: q.resolution ? (RESOLUTION_LABEL[q.resolution] || q.resolution) : '',
      處置說明: q.resolutionNote || '',
      處置時間: q.resolvedAt ? fmtDate(q.resolvedAt) : '',
    };
  });
  if (treeQaqcRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(treeQaqcRows), 'QAQC立木查證');
  }

  // v2.7.17：面積換算 + QAQC 摘要說明（給第三方查證 reference；IPCC TACCC 對齊）
  const cfg = { ...DEFAULT_QAQC_CONFIG, ...(project.qaqcConfig || {}) };
  const stats = computeErrorStats(plots);
  const realPlotCount = plots.filter(p => p.qaStatus !== 'shell').length;
  const sampledCount = plots.filter(p => p.qaqc?.inSample === true).length;
  const docRows = [
    { 項目: '專案代碼', 值: project.code, 備註: '' },
    { 項目: '專案名稱', 值: project.name || '', 備註: '' },
    { 項目: '匯出時間', 值: new Date().toISOString().slice(0, 19).replace('T', ' '), 備註: '' },
    { 項目: '——————', 值: '——————', 備註: '——————' },
    { 項目: '樣區數（不含 shell）', 值: realPlotCount, 備註: '' },
    { 項目: '抽樣數', 值: sampledCount, 備註: `目標 ≥ ${Math.max(Math.ceil(realPlotCount * cfg.samplingFraction), cfg.minSampleSize)}（${(cfg.samplingFraction * 100).toFixed(0)}% × ${realPlotCount}，最低 ${cfg.minSampleSize}）` },
    { 項目: '坡度誤差閾值', 值: `±${cfg.slopeThreshold_deg}°`, 備註: 'IPCC GPG 合理保證等級' },
    { 項目: '面積誤差閾值', 值: `±${cfg.areaThreshold_pct}%`, 備註: 'ISO 14064-3 reasonable assurance' },
    { 項目: '——————', 值: '——————', 備註: '——————' },
    { 項目: '坡度誤差統計', 值: stats.slope.n > 0 ? `n=${stats.slope.n} mean=${stats.slope.mean.toFixed(2)}° max=${stats.slope.max.toFixed(2)}° std=${stats.slope.std.toFixed(2)}°` : '無資料', 備註: '' },
    { 項目: '面積誤差統計', 值: stats.area.n > 0 ? `n=${stats.area.n} mean=${stats.area.mean.toFixed(2)}% max=${stats.area.max.toFixed(2)}% std=${stats.area.std.toFixed(2)}%` : '無資料', 備註: '' },
    { 項目: '——————', 值: '——————', 備註: '——————' },
    { 項目: '面積換算說明', 值: '', 備註: '本案件樣區面積以「水平投影」為碳計算分母（IPCC LULUCF 標準）' },
    { 項目: '· 水平投影公式', 值: 'areaHorizontal_m2 = area_m2 × cos(slopeDegrees)', 備註: '當 dimensionType=slope_distance 時' },
    { 項目: '· 水平投影公式（已水平）', 值: 'areaHorizontal_m2 = area_m2', 備註: '當 dimensionType=horizontal 時' },
    { 項目: '· 立木座標', 值: 'horizontalY = localY × cos(slope) ; localX 不變', 備註: 'X 沿等高線、Y 沿坡向；切換沿坡距 ↔ 水平投影僅影響 Y 軸' },
    { 項目: '· MRV 引用', 值: 'IPCC 2006 GL Vol.4 Ch.4 Forest Land', 備註: '面積、生質、碳計算單位皆指水平投影' },
  ];
  if (project.qaqcSummary) {
    const qs = project.qaqcSummary;
    docRows.push({ 項目: '——————', 值: '——————', 備註: '——————' });
    docRows.push({ 項目: '簽發時間', 值: qs.verifiedAt ? fmtDate(qs.verifiedAt) : '', 備註: '' });
    docRows.push({ 項目: '簽發者', 值: qs.verifiedBy ? anonOrReal(qs.verifiedBy) : '', 備註: '' });
    docRows.push({ 項目: '簽發類型', 值: '✅ 含 QAQC 抽樣查證', 備註: '完整版（v2.7.17）' });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(docRows), '面積換算與QAQC說明');

  // v2.0：地被植物（將 species nested array 展平成多列，每物種一列）
  if (understory.length > 0) {
    const understoryRows = [];
    understory.forEach(u => {
      const baseFields = {
        樣區: u.plotCode,
        小樣方: u.quadratCode,
        樣方大小: u.quadratSize,
        調查日期: fmtDate(u.surveyDate),
        場次: u.surveyRound || '',
        整體覆蓋_pct: u.totalCoverage,
        枯枝落葉厚_cm: u.litterDepth_cm || '',
        入侵種數: u.invasiveCount || 0,
        建立者: anonOrReal(u.createdBy),
        QA狀態: u.qaStatus || 'pending',
        QA評論: u.qaComment || '',
        備註: u.notes || ''
      };
      const species = u.species || [];
      if (species.length === 0) {
        understoryRows.push({ ...baseFields, 物種中名: '', 物種學名: '', 生活型: '', 物種覆蓋_pct: '', 高_cm: '', 入侵種: '' });
      } else {
        species.forEach(sp => {
          understoryRows.push({
            ...baseFields,
            物種中名: sp.speciesZh || '',
            物種學名: sp.speciesSci || '',
            生活型: sp.lifeForm || '',
            物種覆蓋_pct: sp.coverage ?? '',
            高_cm: sp.height_cm ?? '',
            入侵種: sp.isInvasive ? '是' : ''
          });
        });
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(understoryRows), '地被植物');
  }

  // v2.0：水土保持
  if (soilCons.length > 0) {
    const soilConsRows = soilCons.map(s => ({
      樣區: s.plotCode,
      觀測點: s.stationCode,
      事件類型: { 'routine': '例行', 'post-typhoon': '颱風後', 'post-rain': '豪雨後', 'post-construction': '工程後' }[s.eventType] || s.eventType,
      事件名稱: s.eventName || '',
      調查日期: fmtDate(s.surveyDate),
      場次: s.surveyRound || '',
      植生覆蓋_pct: s.vegCoverage,
      裸露_pct: s.bareRatio,
      沖蝕等級: s.erosionLevel,
      沖蝕針_cm: s.erosionPin_cm ?? '',
      坍塌面積_m2: s.collapseArea_m2 ?? '',
      排水: { good: '良好', ponding: '積水', scouring: '淘刷', blocked: '阻塞' }[s.drainage] || '',
      保護工狀況: { none: '無設置', intact: '完好', partial: '局部破損', failed: '失效' }[s.protectionStatus] || '',
      保護工類型: s.protectionType || '',
      入侵植物覆蓋_pct: s.invasiveCoverage ?? '',
      建立者: anonOrReal(s.createdBy),
      QA狀態: s.qaStatus || 'pending',
      QA評論: s.qaComment || '',
      備註: s.notes || ''
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(soilConsRows), '水土保持');
  }

  // v2.1：野生動物
  if (wildlife.length > 0) {
    const blurI = project.methodology?.wildlifeConfig?.blurSensitive !== false;
    const wildlifeRows = wildlife.map(w => ({
      樣區: w.plotCode,
      調查日期: fmtDate(w.surveyDate),
      場次: w.surveyRound || '',
      方法: { direct: '直接目擊', sign: '痕跡', cam: '自動相機', audio: '鳴聲' }[w.method] || w.method,
      物種中名: w.speciesZh || '',
      物種學名: w.speciesSci || '',
      類群: w.group || '',
      保育等級: w.conservationGrade || '',
      隻數: w.count ?? '',
      齡別性別: w.ageSex || '',
      行為: { foraging: '覓食', resting: '休息', moving: '移動', alert: '警戒', breeding: '育幼', calling: '鳴叫' }[w.activity] || '',
      微棲地: { canopy: '林冠', understory: '林下', ground: '地表', water: '水域', edge: '林緣', open: '空曠' }[w.habitat] || '',
      痕跡類型: w.signType || '',
      相機編號: w.camId || '',
      相機觸發時間: w.camTriggerTime ? fmtDate(w.camTriggerTime) : '',
      聽聲時長_min: w.audioMinutes ?? '',
      經度_WGS84: w.location?.longitude ?? w.location?._long ?? '',
      緯度_WGS84: w.location?.latitude ?? w.location?._lat ?? '',
      // 保育類 I：blurSensitive 開時加警示但仍給座標（agency-internal use）
      敏感標記: (blurI && w.conservationGrade === 'I') ? '⚠ 敏感保育種點位 — 限機關內部使用' : '',
      建立者: anonOrReal(w.createdBy),
      QA狀態: w.qaStatus || 'pending',
      QA評論: w.qaComment || '',
      備註: w.notes || ''
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wildlifeRows), '野生動物');
  }

  // v2.2：經濟收穫（含年度累計尾列）
  if (harvest.length > 0) {
    const harvestRows = harvest.map(h => ({
      樣區: h.plotCode,
      個體編號: h.treeNum ?? '',
      樹種: h.speciesZh || '',
      採收日期: fmtDate(h.harvestDate),
      場次: h.surveyRound || '',
      採收部位: { bark: '樹皮', leaves: '嫩葉', twigs: '嫩枝', flowers: '花', roots: '根', whole: '全株' }[h.harvestType] || h.harvestType,
      採收方式: { 'half-bark': '半皮取', ring: '環剝', 'leaf-pruning': '剪葉', 'branch-pruning': '枝條修剪', coppice: '全砍重萌', 'root-dig': '挖根' }[h.harvestMethod] || h.harvestMethod,
      鮮重_kg: h.harvestAmount_kg_fresh ?? '',
      乾重_kg: h.harvestAmount_kg_dry ?? '',
      估算乾重_kg: h.dryEstimated_kg ?? '',
      含水率: h.moistureContent ?? '',
      碳扣減_kgC: h.carbonRemoved_kgC ?? '',
      CO2扣減_tCO2e: h.carbonRemoved_tCO2e ?? '',
      採收時_DBH_cm: h.dbh_at_harvest ?? '',
      產品用途: { 'essential-oil': '精油', powder: '桂皮粉', tea: '茶飲', seedling: '種苗', medicinal: '藥用', other: '其他' }[h.productUse] || '',
      採後狀態: { 'kept-resprout': '存活並重萌', 'kept-no-sprout': '存活未萌', dead: '枯死', removed: '砍除根除' }[h.treeStatusAfter] || '',
      下次回測: fmtDate(h.nextSurveyDate),
      建立者: anonOrReal(h.createdBy),
      QA狀態: h.qaStatus || 'pending',
      QA評論: h.qaComment || '',
      備註: h.notes || ''
    }));
    // 累計尾列
    const totalFresh = harvest.reduce((s, h) => s + (h.harvestAmount_kg_fresh || 0), 0);
    const totalDry = harvest.reduce((s, h) => s + (h.dryEstimated_kg || h.harvestAmount_kg_dry || 0), 0);
    const totalKgC = harvest.reduce((s, h) => s + (h.carbonRemoved_kgC || 0), 0);
    const totalCO2 = harvest.reduce((s, h) => s + (h.carbonRemoved_tCO2e || 0), 0);
    harvestRows.push({
      樣區: '【累計】',
      個體編號: '',
      樹種: `${harvest.length} 筆`,
      採收日期: '',
      場次: '',
      採收部位: '',
      採收方式: '',
      鮮重_kg: totalFresh.toFixed(2),
      乾重_kg: '',
      估算乾重_kg: totalDry.toFixed(2),
      含水率: '',
      碳扣減_kgC: totalKgC.toFixed(2),
      CO2扣減_tCO2e: totalCO2.toFixed(6),
      採收時_DBH_cm: '',
      產品用途: '',
      採後狀態: '',
      下次回測: '',
      建立者: '',
      QA狀態: '',
      QA評論: '',
      備註: ''
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(harvestRows), '經濟收穫');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${project.code}_森林監測_${stamp}.xlsx`);
  toast('匯出完成');
}

// ===== v2.7.18：QAQC 查證說明書匯出（.doc，Word 相容 HTML） =====
//   給主管機關 / 第三方查證提交用。內容隨當前狀態自適應：
//   - 未抽樣：只有專案資訊 + IPCC LULUCF 公式
//   - 已抽樣未重測：加抽樣紀錄
//   - 重測中 / 完成：加誤差表 + 處置紀錄
//   - 已簽發：加簽發紀錄與 qaqcSummary
export async function exportQaqcDocReport(project) {
  toast('產生說明書中...');
  try {
    const cfg = { ...DEFAULT_QAQC_CONFIG, ...(project.qaqcConfig || {}) };
    const meth = project.methodology || {};
    const dimType = meth.dimensionType || 'slope_distance';
    const dimTypeLabel = dimType === 'slope_distance' ? '沿坡距（野外實測）' : '水平投影（已校正）';

    // 抓所有 plot
    const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
    const plots = [];
    plotsSnap.forEach(d => plots.push({ id: d.id, ...d.data() }));
    const realPlots = plots.filter(p => p.qaStatus !== 'shell');
    const sampledPlots = realPlots.filter(p => p.qaqc?.inSample === true);
    const stats = computeErrorStats(realPlots);

    // v2.8.1：抓抽樣 plots 內的所有 trees（給 tree-level QAQC 段用）
    const treeLevelEnabled = cfg.enableTreeLevelQaqc === true;
    let allSampledTrees = [];
    if (treeLevelEnabled && sampledPlots.length > 0) {
      try {
        const treeArrs = await Promise.all(sampledPlots.map(async p => {
          const ts = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', p.id, 'trees'));
          const arr = [];
          ts.forEach(d => arr.push({ id: d.id, plotCode: p.code, ...d.data() }));
          return arr;
        }));
        allSampledTrees = [].concat(...treeArrs);
      } catch (e) { console.warn('[doc report tree fetch]', e); }
    }
    const sampledTrees = allSampledTrees.filter(t => t.qaqc?.inSample === true);
    const treeStats = treeLevelEnabled ? computeTreeErrorStats(allSampledTrees) : null;

    const piLabel = userLabel(project.pi, '—');
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const targetSize = Math.max(Math.ceil(realPlots.length * cfg.samplingFraction), cfg.minSampleSize);

    // 各 plot 重測列
    const remeasureRows = sampledPlots.map(p => {
      const q = p.qaqc || {};
      const status = getPlotQaqcStatus(p);
      const sl = QAQC_STATUS_META[status]?.label || status;
      return `
        <tr>
          <td>${p.code}</td>
          <td>${({ circle: '圓', square: '方', rectangle: '矩', irregular: '不規則' })[p.shape] || p.shape}</td>
          <td style="text-align:right">${Number.isFinite(p.slopeDegrees) ? p.slopeDegrees.toFixed(1) + '°' : '-'}</td>
          <td style="text-align:right">${Number.isFinite(q.slopeVerified) ? q.slopeVerified.toFixed(1) + '°' : '-'}</td>
          <td style="text-align:right">${Number.isFinite(q.slopeError_deg) ? '±' + q.slopeError_deg.toFixed(2) + '°' : '-'}</td>
          <td style="text-align:right">${Number.isFinite(p.areaHorizontal_m2) ? p.areaHorizontal_m2.toFixed(1) + ' m²' : '-'}</td>
          <td style="text-align:right">${Number.isFinite(q.areaVerifiedHorizontal) ? q.areaVerifiedHorizontal.toFixed(1) + ' m²' : '-'}</td>
          <td style="text-align:right">${Number.isFinite(q.areaError_pct) ? '±' + q.areaError_pct.toFixed(2) + '%' : '-'}</td>
          <td>${sl}</td>
        </tr>`;
    }).join('');

    // 處置紀錄（超閾且有 resolution）
    const resolutionRows = sampledPlots
      .filter(p => p.qaqc?.resolution)
      .map(p => {
        const q = p.qaqc;
        return `
          <tr>
            <td>${p.code}</td>
            <td>${RESOLUTION_LABEL[q.resolution] || q.resolution}</td>
            <td>${q.resolutionNote || ''}</td>
            <td>${q.resolvedAt ? fmtDate(q.resolvedAt) : '-'}</td>
            <td>${q.resolvedBy ? userLabel(q.resolvedBy, '—') : '-'}</td>
          </tr>`;
      }).join('');

    // 簽發紀錄
    const qs = project.qaqcSummary;
    const verifiedSection = (project.status === 'verified' && qs) ? `
      <h2>柒、簽發紀錄（QAQC 完整版）</h2>
      <table>
        <tr><th>項目</th><th>值</th></tr>
        <tr><td>簽發類型</td><td>✅ 含 QAQC 抽樣查證（v2.7.17 完整工作流）</td></tr>
        <tr><td>簽發時間</td><td>${qs.verifiedAt ? fmtDate(qs.verifiedAt) : '-'}</td></tr>
        <tr><td>簽發者</td><td>${qs.verifiedBy ? userLabel(qs.verifiedBy, '—') : '-'}</td></tr>
        <tr><td>抽樣 / 總樣區</td><td>${qs.sampledCount} / ${qs.totalPlots}</td></tr>
        <tr><td>通過閾值</td><td>${qs.passedCount}</td></tr>
        <tr><td>已處置（超閾）</td><td>${qs.failedResolvedCount}</td></tr>
        <tr><td>採用閾值</td><td>坡度 ±${qs.slopeThreshold_deg}° / 面積 ±${qs.areaThreshold_pct}%</td></tr>
      </table>
    ` : '';

    const html = `
<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>${project.code} 樣區查證說明書</title>
<style>
  body { font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif; font-size: 11pt; line-height: 1.6; }
  h1 { font-size: 18pt; text-align: center; margin-top: 8pt; }
  h2 { font-size: 14pt; color: #1f4e79; border-bottom: 1px solid #1f4e79; padding-bottom: 2pt; margin-top: 14pt; }
  h3 { font-size: 12pt; color: #2e75b6; margin-top: 10pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 10pt; }
  th { background-color: #d9e1f2; border: 1px solid #888; padding: 4pt 6pt; text-align: left; }
  td { border: 1px solid #888; padding: 4pt 6pt; }
  .formula { background-color: #f5f5f0; padding: 6pt 10pt; border-left: 3px solid #1f4e79; font-family: Consolas, monospace; }
  .meta { color: #666; font-size: 10pt; }
  ol, ul { margin: 4pt 0 4pt 20pt; }
  .small { font-size: 9pt; color: #888; }
</style>
</head>
<body>

<h1>樣區查證說明書（QAQC Verification Report）</h1>
<p class="meta" style="text-align:center">
專案：${project.code}　${project.name || ''}<br>
製作時間：${stamp}　產製版本：app v2.7.18 / schema v2.6.1
</p>

<h2>壹、專案資訊</h2>
<table>
  <tr><th>項目</th><th>值</th></tr>
  <tr><td>專案代碼</td><td>${project.code}</td></tr>
  <tr><td>專案名稱</td><td>${project.name || ''}</td></tr>
  <tr><td>計畫主持人</td><td>${piLabel}</td></tr>
  <tr><td>樣區數（不含 shell）</td><td>${realPlots.length}</td></tr>
  <tr><td>方法學量測單位</td><td>${dimTypeLabel}</td></tr>
  <tr><td>原點型態</td><td>${meth.plotOriginType === 'corner' ? '左下角原點（corner）' : '中心點原點（center）'}</td></tr>
  <tr><td>當前狀態</td><td>${project.status || '-'}</td></tr>
</table>

<h2>貳、樣區幾何 schema 與面積換算</h2>
<p>本系統樣區幾何依 schema v2.6（app v2.7.15 落地）：plotShape 支援 circle / square / rectangle / irregular 四種；plotDimensions 結構依形狀（circle = {radius}、square = {side, width, length}、rectangle = {width, length}、irregular = {vertices,bbox}）。v2.8.4 起每個樣區可設「寬邊坡度（slopeWidthDeg）」與「長邊坡度（slopeLengthDeg）」雙軸坡度（rectangle）— 反映野外寬/長兩方向坡度可能不同的實務（圓形/方形/不規則仍用單一坡度）；slopeDegrees 保留為主坡度（= slopeLengthDeg），向後相容碳計算/QAQC 下游邏輯。</p>

<h3>水平投影面積公式（碳計算 / 密度推算分母）</h3>
<div class="formula">
areaHorizontal_m2 = area_m2 × cos(slopeWidthDeg × π/180) × cos(slopeLengthDeg × π/180)　　當 dimensionType = 'slope_distance'（v2.8.4 雙軸）<br>
areaHorizontal_m2 = area_m2　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　當 dimensionType = 'horizontal'
</div>

<h3>不規則多邊形面積（Shoelace 公式，v2.8.0）</h3>
<div class="formula">
Area = |Σᵢ (xᵢ × yᵢ₊₁ − xᵢ₊₁ × yᵢ)| / 2　　vertices 以 local meters 相對 plot.locationTWD97 儲存<br>
邊界驗證：3–50 頂點、CCW 順序、簡單多邊形（無自交）、面積 ≥ 1 m²
</div>

<h3>立木座標換算（沿坡距 ↔ 水平投影，v2.8.4 雙軸）</h3>
<div class="formula">
horizontalX_m = localX_m × cos(slopeWidthDeg × π/180)　　X 沿寬邊（通常沿等高線）<br>
horizontalY_m = localY_m × cos(slopeLengthDeg × π/180)　　Y 沿長邊（通常沿坡）<br>
立木分布圖切換鈕（v2.7.16）即據此換算 — 雙軸坡度時水平視圖會在 X/Y 各自壓縮
</div>

<h3>MRV 對齊</h3>
<ul>
  <li>IPCC 2006 Guidelines for National Greenhouse Gas Inventories Vol.4 Ch.4 Forest Land — 面積、生質、碳計算單位皆指水平投影</li>
  <li>森林經營計畫書範本對應「貳、(一) 林地概況 — 自然環境」面積資料</li>
  <li>TMS（自願減量方法學）AR-TMS0001 / 0002 / 0003 / 0004 — 監測計畫面積定義</li>
</ul>

<h2>參、QAQC 工作流（v2.7.17）</h2>
<p>對標 ISO 14064-3、IPCC GPG（reasonable assurance ±5°/±3%）、TMS 方法學監測計畫、VVB / DOE 第三方查證程序。</p>

<ol>
  <li><b>抽樣</b>：reviewer 隨機抽 N = max(samplingFraction × 樣區數, minSampleSize) 個 plots（mulberry32 PRNG，種子可重現）。</li>
  <li><b>現場核對</b>：reviewer 對抽樣 plots 重測坡度（slopeVerified）與 dimensions（dimensionsVerified）。</li>
  <li><b>誤差計算</b>：系統算 slopeError_deg = |slopeVerified − slopeDegrees|；areaError_pct = |areaVerifiedHorizontal − areaHorizontal_m2| / areaHorizontal_m2 × 100。</li>
  <li><b>通過閾值 / 處置</b>：兩誤差皆在閾值內 → ✅ qaqcPassed；任一超閾 → reviewer 必填處置（accepted / remeasured / rejected）+ 說明（IPCC TACCC「透明」要求）。</li>
  <li><b>合格簽發</b>：所有抽樣 plots 都 passed 或 resolved → 啟用簽發 → status: review → verified（資料永久鎖定）+ 寫 qaqcSummary。</li>
</ol>

<h2>肆、QAQC 設定</h2>
<table>
  <tr><th>項目</th><th>值</th><th>說明</th></tr>
  <tr><td>抽樣比例</td><td>${(cfg.samplingFraction * 100).toFixed(0)}%</td><td>每 100 個 plot 抽 ${(cfg.samplingFraction * 100).toFixed(0)} 個</td></tr>
  <tr><td>最低樣本數</td><td>${cfg.minSampleSize}</td><td>小專案防呆下限</td></tr>
  <tr><td>坡度閾值</td><td>±${cfg.slopeThreshold_deg}°</td><td>IPCC GPG 合理保證等級</td></tr>
  <tr><td>面積閾值</td><td>±${cfg.areaThreshold_pct}%</td><td>ISO 14064-3 reasonable assurance</td></tr>
  <tr><td>本案抽樣目標</td><td>${targetSize} plots</td><td>= max(${(cfg.samplingFraction * 100).toFixed(0)}% × ${realPlots.length}, ${cfg.minSampleSize})</td></tr>
</table>

<h2>伍、抽樣紀錄</h2>
${cfg.lastSamplingSeed != null ? `
  <table>
    <tr><th>項目</th><th>值</th></tr>
    <tr><td>抽樣種子（mulberry32 PRNG）</td><td><code>${cfg.lastSamplingSeed}</code></td></tr>
    <tr><td>抽樣時間</td><td>${cfg.lastSamplingAt ? fmtDate(cfg.lastSamplingAt) : '-'}</td></tr>
    <tr><td>抽樣者</td><td>${cfg.lastSamplingBy ? userLabel(cfg.lastSamplingBy, '—') : '-'}</td></tr>
    <tr><td>抽樣大小</td><td>${cfg.lastSamplingSize || sampledPlots.length} / 目標 ${cfg.lastSamplingTarget || targetSize}</td></tr>
  </table>
  <p class="small">※ 用同種子可在 v2.7.18 系統重現本次抽樣集合（可重複性審查 reference）。</p>
` : `<p class="small">尚未進行抽樣。</p>`}

${sampledPlots.length > 0 ? `
<h2>陸、各抽樣樣區重測紀錄與誤差</h2>
<table>
  <tr><th>樣區</th><th>形狀</th><th>原坡度</th><th>重測坡度</th><th>坡度誤差</th><th>原水平面積</th><th>重測水平面積</th><th>面積誤差</th><th>狀態</th></tr>
  ${remeasureRows}
</table>

<h3>誤差統計</h3>
<table>
  <tr><th>項目</th><th>n</th><th>平均</th><th>最大</th><th>標準差</th></tr>
  <tr><td>坡度誤差</td><td>${stats.slope.n}</td><td>${stats.slope.n > 0 ? stats.slope.mean.toFixed(2) + '°' : '-'}</td><td>${stats.slope.n > 0 ? stats.slope.max.toFixed(2) + '°' : '-'}</td><td>${stats.slope.n > 0 ? stats.slope.std.toFixed(2) + '°' : '-'}</td></tr>
  <tr><td>面積誤差</td><td>${stats.area.n}</td><td>${stats.area.n > 0 ? stats.area.mean.toFixed(2) + '%' : '-'}</td><td>${stats.area.n > 0 ? stats.area.max.toFixed(2) + '%' : '-'}</td><td>${stats.area.n > 0 ? stats.area.std.toFixed(2) + '%' : '-'}</td></tr>
</table>
` : ''}

${resolutionRows ? `
<h3>處置紀錄（超閾值 plots）</h3>
<table>
  <tr><th>樣區</th><th>處置</th><th>說明</th><th>處置時間</th><th>處置者</th></tr>
  ${resolutionRows}
</table>
<p class="small">※ 依 IPCC TACCC 之「透明」原則，所有超閾值 plots 之處置與判斷依據皆列。</p>
` : ''}

${treeLevelEnabled && sampledTrees.length > 0 ? `
<h2>${sampledPlots.length > 0 ? '陸之二' : '陸'}、立木層級 QAQC（v2.8.1）</h2>

<h3>抽樣摘要</h3>
<table>
  <tr><th>項目</th><th>值</th><th>說明</th></tr>
  <tr><td>立木抽樣比例</td><td>${(cfg.treeSamplingFraction * 100).toFixed(0)}%</td><td>每 plot 內</td></tr>
  <tr><td>每 plot 最低樣本數</td><td>${cfg.minTreeSampleSize}</td><td>棵</td></tr>
  <tr><td>抽樣立木總數</td><td>${sampledTrees.length}</td><td>跨 ${sampledPlots.length} 個抽樣 plots</td></tr>
  <tr><td>DBH 閾值</td><td>±${cfg.dbhThreshold_cm} cm 或 ±${cfg.dbhThreshold_pct}%</td><td>取較鬆者通過</td></tr>
  <tr><td>高度閾值</td><td>±${cfg.heightThreshold_m} m 或 ±${cfg.heightThreshold_pct}%</td><td>取較鬆者通過</td></tr>
  <tr><td>位置閾值</td><td>±${cfg.positionThreshold_m} m</td><td>歐式距離；位置${cfg.requirePositionVerified ? '必填' : '選填'}</td></tr>
</table>

<h3>各立木重測紀錄與誤差</h3>
<table style="font-size:9pt">
  <tr><th>樣區</th><th>立木</th><th>樹種</th><th>原DBH</th><th>重測DBH</th><th>誤差</th><th>原H</th><th>重測H</th><th>誤差</th><th>位置誤差</th><th>狀態</th></tr>
  ${sampledTrees.map(t => {
    const q = t.qaqc || {};
    const status = getTreeQaqcStatus(t);
    const sl = ({
      not_sampled: '⚪', pending: '🟡', passed: '✅',
      failed_unresolved: '❌', failed_resolved: '🟢'
    })[status] || '?';
    return `<tr>
      <td>${t.plotCode || '-'}</td>
      <td>${t.treeCode || '#' + (t.treeNum || '?')}</td>
      <td>${t.speciesZh || '-'}</td>
      <td style="text-align:right">${Number.isFinite(t.dbh_cm) ? t.dbh_cm.toFixed(1) : '-'}</td>
      <td style="text-align:right">${Number.isFinite(q.dbhVerified) ? q.dbhVerified.toFixed(1) : '-'}</td>
      <td style="text-align:right">${Number.isFinite(q.dbhError_cm) ? '±' + q.dbhError_cm.toFixed(2) + ' cm' : '-'}</td>
      <td style="text-align:right">${Number.isFinite(t.height_m) ? t.height_m.toFixed(1) : '-'}</td>
      <td style="text-align:right">${Number.isFinite(q.heightVerified) ? q.heightVerified.toFixed(1) : '-'}</td>
      <td style="text-align:right">${Number.isFinite(q.heightError_m) ? '±' + q.heightError_m.toFixed(2) + ' m' : '-'}</td>
      <td style="text-align:right">${Number.isFinite(q.positionError_m) ? '±' + q.positionError_m.toFixed(2) + ' m' : '-'}</td>
      <td>${sl}</td>
    </tr>`;
  }).join('')}
</table>

<h3>立木誤差統計</h3>
<table>
  <tr><th>項目</th><th>n</th><th>平均</th><th>最大</th><th>標準差</th></tr>
  <tr><td>DBH 誤差</td><td>${treeStats.dbh.n}</td><td>${treeStats.dbh.n > 0 ? treeStats.dbh.mean.toFixed(2) + ' cm' : '-'}</td><td>${treeStats.dbh.n > 0 ? treeStats.dbh.max.toFixed(2) + ' cm' : '-'}</td><td>${treeStats.dbh.n > 0 ? treeStats.dbh.std.toFixed(2) + ' cm' : '-'}</td></tr>
  <tr><td>高度誤差</td><td>${treeStats.height.n}</td><td>${treeStats.height.n > 0 ? treeStats.height.mean.toFixed(2) + ' m' : '-'}</td><td>${treeStats.height.n > 0 ? treeStats.height.max.toFixed(2) + ' m' : '-'}</td><td>${treeStats.height.n > 0 ? treeStats.height.std.toFixed(2) + ' m' : '-'}</td></tr>
  <tr><td>位置誤差</td><td>${treeStats.position.n}</td><td>${treeStats.position.n > 0 ? treeStats.position.mean.toFixed(2) + ' m' : '-'}</td><td>${treeStats.position.n > 0 ? treeStats.position.max.toFixed(2) + ' m' : '-'}</td><td>${treeStats.position.n > 0 ? treeStats.position.std.toFixed(2) + ' m' : '-'}</td></tr>
</table>

<p class="small">※ 立木層級 QAQC 對應 IPCC GPG 合理保證等級之延伸（DBH/H 直接影響碳估算精度，1 cm DBH 誤差於 30 cm 樹 ≈ 6% 生質量誤差）。</p>
` : ''}

${verifiedSection}

<h2>${verifiedSection ? '捌' : (sampledPlots.length > 0 ? '柒' : '陸')}、聲明</h2>
<p>本說明書由 ForestMRV 系統（app v2.7.18 / schema v2.6.1）自動產製，內容反映匯出時刻之資料庫狀態。對應原始資料儲存於 Firebase Firestore（asia-east1）；歷史變動透過 createdAt / updatedAt / verifiedAt 等 timestamp 欄位追溯。</p>
<p>查證方法依 ISO 14064-3 reasonable assurance 等級，閾值與抽樣比例可由本案 reviewer 於 status=review 時調整（記錄於 project.qaqcConfig）。</p>

<p class="small" style="text-align:center;margin-top:18pt;border-top:1px solid #ccc;padding-top:8pt">
— ForestMRV v2.7.18 / 製作時間 ${stamp} —
</p>

</body>
</html>`;

    // Word 相容 .doc 匯出（HTML 包 application/msword MIME，Word/LibreOffice/Google Docs 均可開）
    const blob = new Blob(['﻿', html], { type: 'application/msword' });  // BOM 確保 UTF-8 中文不亂碼
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${project.code}_QAQC查證說明書_${dateStamp}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('查證說明書已下載');
  } catch (e) {
    toast('匯出失敗：' + e.message);
    console.error('[exportQaqcDocReport]', e);
  }
}

export async function exportCsv(project, kind) {
  toast('準備匯出...');
  const data = await fetchAllData(project);
  const map = {
    plots: data.plots, trees: data.trees, regeneration: data.regen,
    understory: data.understory, soilCons: data.soilCons,  // v2.0
    wildlife: data.wildlife, harvest: data.harvest         // v2.1 / v2.2
  };
  const rows = map[kind];
  if (!rows || rows.length === 0) { toast('沒有資料'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  // 加 BOM 讓 Excel 正確讀中文
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.code}_${kind}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('匯出完成');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}
