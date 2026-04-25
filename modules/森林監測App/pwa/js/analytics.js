// ===== analytics.js — v1.5 儀表板 + 地圖 + 匯出（含 QA 統計、reviewer 匿名化）=====

import { fb, $, $$, el, toast, state, isReviewer, anonName } from './app.js';

// 共用：抓取本專案所有樣區與立木
async function fetchAllData(project) {
  const plotsSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots'));
  const plots = [];
  const trees = [];
  const regen = [];
  for (const pd of plotsSnap.docs) {
    const plot = { id: pd.id, ...pd.data() };
    plots.push(plot);
    const tSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'trees'));
    tSnap.forEach(td => trees.push({ id: td.id, plotId: pd.id, plotCode: plot.code, ...td.data() }));
    const rSnap = await fb.getDocs(fb.collection(fb.db, 'projects', project.id, 'plots', pd.id, 'regeneration'));
    rSnap.forEach(rd => regen.push({ id: rd.id, plotId: pd.id, plotCode: plot.code, ...rd.data() }));
  }
  return { plots, trees, regen };
}

// 全域 chart instances（避免重畫時重疊）
const _charts = {};
function killChart(key) { if (_charts[key]) { _charts[key].destroy(); delete _charts[key]; } }

// ===== Dashboard =====
export async function renderDashboard(project) {
  const { plots, trees } = await fetchAllData(project);

  // 摘要 KPI
  const totalArea = plots.reduce((s, p) => s + (p.area_m2 || 0), 0);
  const totalTrees = trees.length;
  const totalBA = trees.reduce((s, t) => s + (t.basalArea_m2 || 0), 0);
  const totalV = trees.reduce((s, t) => s + (t.volume_m3 || 0), 0);
  const totalC = trees.reduce((s, t) => s + (t.carbon_kg || 0), 0);
  const cBox = $('#dashboard-summary');
  cBox.innerHTML = '';
  const kpis = [
    ['樣區數', plots.length],
    ['總調查面積', `${totalArea} m²`],
    ['立木總數', totalTrees],
    ['總材積', `${totalV.toFixed(2)} m³`],
    ['總斷面積', `${totalBA.toFixed(2)} m²`],
    ['總碳蓄積', `${(totalC / 1000).toFixed(2)} t`]
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

  // QA 狀態（plots + trees 合計）
  const qaCount = { pending: 0, verified: 0, flagged: 0, rejected: 0 };
  [...plots, ...trees].forEach(d => {
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
    const surveyorLabel = isReviewer() ? anonName(p.createdBy) : (p.createdBy || '').slice(0, 8);
    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: p.insideBoundary === false ? '#dc2626' : dotColor,
      fillColor: dotColor,
      fillOpacity: 0.7,
      weight: 2
    }).bindPopup(`
      <strong>${p.code}</strong> <span style="font-size:11px;background:#f5f5f4;padding:1px 4px;border-radius:3px">${p.qaStatus || 'pending'}</span><br>
      ${p.forestUnit || ''} · ${p.shape === 'circle' ? '圓' : '方'} ${p.area_m2}m²<br>
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
  const { plots, trees, regen } = await fetchAllData(project);
  const wb = XLSX.utils.book_new();

  const anonOrReal = (uid) => isReviewer() ? anonName(uid) : uid;
  const plotsRows = plots.map(p => ({
    樣區編號: p.code,
    林班小班: p.forestUnit || '',
    形狀: p.shape,
    面積_m2: p.area_m2,
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
    碳量_kg: t.carbon_kg,
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

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${project.code}_森林監測_${stamp}.xlsx`);
  toast('匯出完成');
}

export async function exportCsv(project, kind) {
  toast('準備匯出...');
  const data = await fetchAllData(project);
  const map = { plots: data.plots, trees: data.trees, regeneration: data.regen };
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
