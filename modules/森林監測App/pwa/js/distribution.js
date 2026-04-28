// ===== distribution.js — 立木分布散布圖（v2.6.2 / v2.5.1 backlog 🅲 落地）=====
//
// 把樣區內每株立木的 localX_m / localY_m 畫成 Canvas 散布圖。
//
// 設計：
//   - 樣區邊界依 plot.shape 畫虛線方框（square）或圓（circle）
//   - 原點依 methodology.plotOriginType（'center' 4 象限 / 'corner' 1 象限）
//   - 立木點半徑依 DBH 線性縮放（4–16 px）
//   - 顏色依 vitality（healthy=綠 / weak=橘 / standing-dead=灰 / fallen=紅）
//   - hover：tooltip 顯示樣木號 + 樹種 + DBH + X/Y
//   - click：透過 callback 開編輯 modal（避開循環 import）
//   - 無 X/Y 的立木：列在「未設位置」清單，不畫進圖
//   - 樣區外的點：紅色描邊提示「資料異常」
//
// 使用：
//   import { renderTreeDistribution } from './distribution.js';
//   renderTreeDistribution(snap, plot, methodology, { onTreeClick: (id, data) => {...} });

const CANVAS_MAX = 600;          // 最大邊長 (px)
const PAD = 36;                  // 留給軸標的內邊距 (px)
const POINT_R_MIN = 4;
const POINT_R_MAX = 16;

const VITALITY_COLOR = {
  healthy:        '#15803d',  // green-700
  weak:           '#d97706',  // amber-600
  'standing-dead':'#78716c',  // stone-500
  fallen:         '#b91c1c',  // red-700
};
const VITALITY_LABEL = {
  healthy: '健康',
  weak: '衰弱',
  'standing-dead': '枯立',
  fallen: '倒伏',
};

// ===== 入口 =====
export function renderTreeDistribution(snap, plot, methodology, opts = {}) {
  const wrap   = document.getElementById('dist-canvas-wrap');
  const info   = document.getElementById('dist-info');
  const legend = document.getElementById('dist-legend');
  const count  = document.getElementById('dist-count');
  const controls = document.getElementById('dist-controls');
  if (!wrap || !info || !legend || !count) return;  // sub-tab 沒掛上

  // 1. 收集立木資料
  const trees = [];
  snap.forEach(d => trees.push({ id: d.id, ...d.data() }));
  count.textContent = `（${trees.length} 株）`;

  if (trees.length === 0) {
    wrap.innerHTML = '';
    info.innerHTML = '<span class="text-stone-500">樣區內尚無立木 — 請先到「🌳 立木調查」新增。</span>';
    legend.innerHTML = '';
    if (controls) controls.innerHTML = '';
    return;
  }

  const withXY = trees.filter(t => Number.isFinite(t.localX_m) && Number.isFinite(t.localY_m));
  const noXY = trees.length - withXY.length;
  const noXYPct = trees.length > 0 ? ((noXY / trees.length) * 100).toFixed(0) : 0;

  // 2. 樣區幾何（依 shape + area_m2 計算邊長/半徑）
  const shape = plot.shape || 'square';
  const area  = Number.isFinite(plot.area_m2) ? plot.area_m2 : 500;
  const side  = Math.sqrt(area);                  // square 邊長 (m)
  const radius = Math.sqrt(area / Math.PI);       // circle 半徑 (m)
  const originType = methodology?.plotOriginType || 'center';

  // 3. 座標範圍（用樣區幾何 + 立木 X/Y 兩者取 union 加 5% 緩衝，立木超出邊界仍可見）
  let xMin, xMax, yMin, yMax;
  if (originType === 'center') {
    const half = shape === 'circle' ? radius : side / 2;
    xMin = -half; xMax = half; yMin = -half; yMax = half;
  } else {
    xMin = 0; xMax = (shape === 'circle' ? radius * 2 : side);
    yMin = 0; yMax = (shape === 'circle' ? radius * 2 : side);
  }
  // 把樣區外的立木納入範圍
  withXY.forEach(t => {
    if (t.localX_m < xMin) xMin = t.localX_m;
    if (t.localX_m > xMax) xMax = t.localX_m;
    if (t.localY_m < yMin) yMin = t.localY_m;
    if (t.localY_m > yMax) yMax = t.localY_m;
  });
  // 5% buffer
  const xRange = xMax - xMin, yRange = yMax - yMin;
  xMin -= xRange * 0.05; xMax += xRange * 0.05;
  yMin -= yRange * 0.05; yMax += yRange * 0.05;
  // 強制正方形比例（取 max）— 否則點會被拉扁
  const span = Math.max(xMax - xMin, yMax - yMin);
  const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
  xMin = cx - span / 2; xMax = cx + span / 2;
  yMin = cy - span / 2; yMax = cy + span / 2;

  // 4. DBH 縮放
  const maxDbh = withXY.reduce((m, t) => Math.max(m, t.dbh_cm || 0), 1);

  // 5. Canvas 建立 + retina
  wrap.innerHTML = '';
  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.min(wrap.clientWidth || CANVAS_MAX, CANVAS_MAX);
  const canvas = document.createElement('canvas');
  canvas.width  = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width  = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  canvas.style.cursor = 'pointer';
  canvas.style.background = '#fafaf9';
  canvas.style.borderRadius = '6px';
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  wrap.appendChild(canvas);

  const tooltip = document.createElement('div');
  tooltip.className = 'absolute pointer-events-none bg-stone-900 text-white text-xs rounded px-2 py-1 hidden z-10';
  tooltip.style.fontFamily = 'system-ui, sans-serif';
  tooltip.style.whiteSpace = 'nowrap';
  wrap.style.position = 'relative';
  wrap.appendChild(tooltip);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 6. 座標換算函式
  const W = cssSize - PAD * 2;
  const H = cssSize - PAD * 2;
  function mxToPx(mx) { return PAD + ((mx - xMin) / (xMax - xMin)) * W; }
  function myToPy(my) { return PAD + (1 - (my - yMin) / (yMax - yMin)) * H; }   // Y 翻轉（Canvas 上下顛倒）

  // 7. 畫底圖
  drawAxes(ctx, cssSize, originType, xMin, xMax, yMin, yMax, mxToPx, myToPy);
  drawPlotBoundary(ctx, shape, originType, side, radius, mxToPx, myToPy);

  // 8. 點集（先把資料整理好，方便 hover lookup）
  const points = withXY.map(t => {
    const px = mxToPx(t.localX_m);
    const py = myToPy(t.localY_m);
    const r  = POINT_R_MIN + ((t.dbh_cm || 0) / maxDbh) * (POINT_R_MAX - POINT_R_MIN);
    const inside = isInsideBoundary(t.localX_m, t.localY_m, shape, originType, side, radius);
    return { ...t, px, py, r, inside };
  });

  // 9. 畫點（先畫小的、後畫大的，避免大點蓋小點 → 一律先畫死/弱、後畫健）
  const order = ['fallen', 'standing-dead', 'weak', 'healthy'];
  points.sort((a, b) => order.indexOf(a.vitality) - order.indexOf(b.vitality));
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.px, p.py, p.r, 0, Math.PI * 2);
    ctx.fillStyle = VITALITY_COLOR[p.vitality] || '#78716c';
    ctx.globalAlpha = 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!p.inside) {
      ctx.strokeStyle = '#dc2626';   // red-600
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
    }
    ctx.stroke();
  });

  // 10. info 行
  const outOfBounds = points.filter(p => !p.inside).length;
  const lines = [];
  lines.push(`<b>樣區規格</b>：${shape === 'circle' ? '圓形' : '方形'} / ${area} m²` +
             ` / 原點=<b>${originType === 'center' ? '中心點' : '左下角'}</b>` +
             ` / 邊長 ≈ ${shape === 'circle' ? (radius * 2).toFixed(1) : side.toFixed(1)} m`);
  lines.push(`<b>已定位</b>：${withXY.length} 株 / ${trees.length} 株（${((withXY.length / trees.length) * 100).toFixed(0)}%）`);
  if (noXY > 0) {
    lines.push(`<span class="text-amber-700"><b>⚠ 未設位置</b>：${noXY} 株（${noXYPct}%） — 立木表單填 X/Y 後即會出現在散布圖</span>`);
  }
  if (outOfBounds > 0) {
    lines.push(`<span class="text-red-600"><b>⚠ 超出樣區邊界</b>：${outOfBounds} 株（紅圈描邊） — 請檢查 X/Y 是否量錯</span>`);
  }
  info.innerHTML = lines.join('<br>');

  // 11. 圖例
  legend.innerHTML = '';
  Object.entries(VITALITY_LABEL).forEach(([v, label]) => {
    const n = points.filter(p => p.vitality === v).length;
    if (n === 0) return;  // 沒有的活力不秀
    const item = document.createElement('span');
    item.className = 'inline-flex items-center gap-1 bg-stone-50 rounded px-2 py-1';
    item.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${VITALITY_COLOR[v]}"></span>${label}（${n}）`;
    legend.appendChild(item);
  });
  // DBH 大小圖例
  const dbhItem = document.createElement('span');
  dbhItem.className = 'inline-flex items-center gap-2 bg-stone-50 rounded px-2 py-1';
  dbhItem.innerHTML = `
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a8a29e"></span>
    <span class="text-stone-500">小</span>
    <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#a8a29e"></span>
    <span class="text-stone-500">DBH 大</span>
  `;
  legend.appendChild(dbhItem);

  // 12. controls（匯出按鈕：PNG raster / SVG vector）
  if (controls) {
    controls.innerHTML = '';
    const pngBtn = document.createElement('button');
    pngBtn.className = 'border px-2.5 py-1 rounded text-xs hover:bg-stone-100';
    pngBtn.textContent = '⬇ PNG';
    pngBtn.title = '下載目前散布圖為 PNG（raster，網頁/簡報用）';
    pngBtn.onclick = () => downloadCanvasPng(canvas, plot.code);
    controls.appendChild(pngBtn);
    // v2.7.13：SVG vector 匯出（學術論文 / Adobe Illustrator 後製）
    const svgBtn = document.createElement('button');
    svgBtn.className = 'border px-2.5 py-1 rounded text-xs hover:bg-stone-100';
    svgBtn.textContent = '⬇ SVG';
    svgBtn.title = '下載目前散布圖為 SVG（vector，論文 / 後製用，可放大不失真）';
    svgBtn.onclick = () => {
      const svg = buildPlotSVG({
        size: cssSize, points, xMin, xMax, yMin, yMax,
        shape, originType, side, radius, mxToPx, myToPy, plot,
      });
      downloadSvg(svg, plot.code);
    };
    controls.appendChild(svgBtn);
  }

  // 13. hover / click
  function findPointAt(mx, my) {
    // 由近到遠找（hover 會優先抓最上層）
    let best = null, bestDist = Infinity;
    for (const p of points) {
      const d = Math.hypot(p.px - mx, p.py - my);
      if (d <= p.r + 4 && d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const p = findPointAt(mx, my);
    if (p) {
      tooltip.classList.remove('hidden');
      tooltip.innerHTML = `<b>${p.treeCode || '#' + (p.treeNum || '?')}</b>　${p.speciesZh || '?'}` +
        `<br>DBH ${(p.dbh_cm || 0).toFixed(1)} cm　H ${(p.height_m || 0).toFixed(1)} m` +
        `<br>X=${p.localX_m.toFixed(2)} Y=${p.localY_m.toFixed(2)} m` +
        `　<span style="color:${VITALITY_COLOR[p.vitality]}">${VITALITY_LABEL[p.vitality] || p.vitality || '?'}</span>` +
        (p.inside ? '' : '<br><span style="color:#fca5a5">⚠ 超出樣區邊界</span>');
      tooltip.style.left = (p.px + 12) + 'px';
      tooltip.style.top  = (p.py - 32) + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.classList.add('hidden');
      canvas.style.cursor = 'crosshair';
    }
  });
  canvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const p = findPointAt(mx, my);
    if (p && typeof opts.onTreeClick === 'function') opts.onTreeClick(p.id, p);
  });
}

// ===== 軸 + 標尺 =====
function drawAxes(ctx, size, originType, xMin, xMax, yMin, yMax, mxToPx, myToPy) {
  ctx.strokeStyle = '#d6d3d1';   // stone-300
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#78716c';     // stone-500

  // 計算合理的 tick step（讓 5-8 條 grid line）
  const span = xMax - xMin;
  const niceSteps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  let step = niceSteps[0];
  for (const s of niceSteps) {
    if (span / s <= 8) { step = s; break; }
  }

  // 垂直 grid + x 軸刻度（底部）
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) {
    if (Math.abs(v) < 1e-9) continue;   // 避開 0（用粗線畫）
    const px = mxToPx(v);
    ctx.strokeStyle = '#f5f5f4';   // stone-100
    ctx.beginPath();
    ctx.moveTo(px, PAD);
    ctx.lineTo(px, size - PAD);
    ctx.stroke();
    ctx.fillStyle = '#a8a29e';
    ctx.fillText(v.toFixed(0), px - 6, size - PAD + 14);
  }
  // 水平 grid + y 軸刻度（左側）
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    const py = myToPy(v);
    ctx.strokeStyle = '#f5f5f4';
    ctx.beginPath();
    ctx.moveTo(PAD, py);
    ctx.lineTo(size - PAD, py);
    ctx.stroke();
    ctx.fillStyle = '#a8a29e';
    ctx.fillText(v.toFixed(0), 4, py + 4);
  }

  // 0 軸（粗）— center 模式才特別畫
  if (originType === 'center') {
    const x0 = mxToPx(0), y0 = myToPy(0);
    ctx.strokeStyle = '#a8a29e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, PAD); ctx.lineTo(x0, size - PAD);
    ctx.moveTo(PAD, y0); ctx.lineTo(size - PAD, y0);
    ctx.stroke();
    // 4 象限標
    ctx.fillStyle = '#78716c';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('+X 東', size - PAD - 36, y0 - 4);
    ctx.fillText('+Y 北', x0 + 4, PAD + 12);
    ctx.fillText('−X 西', PAD + 4, y0 - 4);
    ctx.fillText('−Y 南', x0 + 4, size - PAD - 4);
  } else {
    // corner 模式：畫左下角的兩條粗軸
    ctx.strokeStyle = '#a8a29e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, size - PAD); ctx.lineTo(size - PAD, size - PAD);
    ctx.moveTo(PAD, size - PAD); ctx.lineTo(PAD, PAD);
    ctx.stroke();
    ctx.fillStyle = '#78716c';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('+X 東 →', size - PAD - 56, size - PAD - 6);
    ctx.fillText('+Y 北 ↑', PAD + 6, PAD + 12);
  }

  // 單位標題
  ctx.fillStyle = '#57534e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('單位：m', size - PAD - 40, PAD - 8);
}

// ===== 樣區邊界（虛線）=====
function drawPlotBoundary(ctx, shape, originType, side, radius, mxToPx, myToPy) {
  ctx.strokeStyle = '#10b981';   // emerald-500
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);

  if (shape === 'circle') {
    // center: 圓心 (0,0)；corner: 圓心 (radius, radius)
    const cx = originType === 'center' ? 0 : radius;
    const cy = originType === 'center' ? 0 : radius;
    const px = mxToPx(cx);
    const py = myToPy(cy);
    // 半徑用 X 方向的縮放（square aspect 已強制過 → x/y 縮放一致）
    const pr = Math.abs(mxToPx(radius) - mxToPx(0));
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // square
    let x0, y0, x1, y1;
    if (originType === 'center') {
      const half = side / 2;
      x0 = -half; y0 = -half; x1 = half; y1 = half;
    } else {
      x0 = 0; y0 = 0; x1 = side; y1 = side;
    }
    ctx.strokeRect(mxToPx(x0), myToPy(y1), mxToPx(x1) - mxToPx(x0), myToPy(y0) - myToPy(y1));
  }
  ctx.setLineDash([]);
}

// ===== 邊界判斷（決定點是否畫紅圈描邊）=====
function isInsideBoundary(x, y, shape, originType, side, radius) {
  if (shape === 'circle') {
    const cx = originType === 'center' ? 0 : radius;
    const cy = originType === 'center' ? 0 : radius;
    return Math.hypot(x - cx, y - cy) <= radius + 0.001;
  }
  // square
  if (originType === 'center') {
    const half = side / 2;
    return Math.abs(x) <= half + 0.001 && Math.abs(y) <= half + 0.001;
  }
  return x >= -0.001 && x <= side + 0.001 && y >= -0.001 && y <= side + 0.001;
}

// ===== 匯出 PNG =====
function downloadCanvasPng(canvas, plotCode) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `tree-distribution-${plotCode || 'plot'}-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== v2.7.13：匯出 SVG（vector，學術論文 / Adobe Illustrator 後製用） =====
// 與 PNG 範圍一致：背景 + grid + 軸 + 邊界 + 點。不含外部 info / legend / count（DOM 層）。
// SVG 內元素全部 inline style，不依賴外部 CSS（脫離 app 也能正確顯示）。
function buildPlotSVG({ size, points, xMin, xMax, yMin, yMax, shape, originType, side, radius, mxToPx, myToPy, plot }) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('font-family', 'system-ui, sans-serif');

  // 背景
  appendNS(svg, 'rect', { x: 0, y: 0, width: size, height: size, fill: '#fafaf9', rx: 6 });

  // grid + 軸刻度
  const span = xMax - xMin;
  const niceSteps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  let step = niceSteps[0];
  for (const s of niceSteps) { if (span / s <= 8) { step = s; break; } }
  // 垂直 grid + x 刻度
  for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    const px = mxToPx(v);
    appendNS(svg, 'line', { x1: px, y1: PAD, x2: px, y2: size - PAD, stroke: '#f5f5f4', 'stroke-width': 1 });
    appendNS(svg, 'text', { x: px - 6, y: size - PAD + 14, fill: '#a8a29e', 'font-size': 11 }, v.toFixed(0));
  }
  // 水平 grid + y 刻度
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    const py = myToPy(v);
    appendNS(svg, 'line', { x1: PAD, y1: py, x2: size - PAD, y2: py, stroke: '#f5f5f4', 'stroke-width': 1 });
    appendNS(svg, 'text', { x: 4, y: py + 4, fill: '#a8a29e', 'font-size': 11 }, v.toFixed(0));
  }

  // 0 軸（粗）+ 象限標
  if (originType === 'center') {
    const x0 = mxToPx(0), y0 = myToPy(0);
    appendNS(svg, 'line', { x1: x0, y1: PAD, x2: x0, y2: size - PAD, stroke: '#a8a29e', 'stroke-width': 1.5 });
    appendNS(svg, 'line', { x1: PAD, y1: y0, x2: size - PAD, y2: y0, stroke: '#a8a29e', 'stroke-width': 1.5 });
    appendNS(svg, 'text', { x: size - PAD - 36, y: y0 - 4, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '+X 東');
    appendNS(svg, 'text', { x: x0 + 4, y: PAD + 12, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '+Y 北');
    appendNS(svg, 'text', { x: PAD + 4, y: y0 - 4, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '−X 西');
    appendNS(svg, 'text', { x: x0 + 4, y: size - PAD - 4, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '−Y 南');
  } else {
    appendNS(svg, 'line', { x1: PAD, y1: size - PAD, x2: size - PAD, y2: size - PAD, stroke: '#a8a29e', 'stroke-width': 1.5 });
    appendNS(svg, 'line', { x1: PAD, y1: size - PAD, x2: PAD, y2: PAD, stroke: '#a8a29e', 'stroke-width': 1.5 });
    appendNS(svg, 'text', { x: size - PAD - 56, y: size - PAD - 6, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '+X 東 →');
    appendNS(svg, 'text', { x: PAD + 6, y: PAD + 12, fill: '#78716c', 'font-size': 12, 'font-weight': 'bold' }, '+Y 北 ↑');
  }
  appendNS(svg, 'text', { x: size - PAD - 40, y: PAD - 8, fill: '#57534e', 'font-size': 11 }, '單位：m');

  // 樣區邊界（虛線）
  if (shape === 'circle') {
    const cx = originType === 'center' ? 0 : radius;
    const cy = originType === 'center' ? 0 : radius;
    const px = mxToPx(cx), py = myToPy(cy);
    const pr = Math.abs(mxToPx(radius) - mxToPx(0));
    appendNS(svg, 'circle', { cx: px, cy: py, r: pr, fill: 'none', stroke: '#10b981', 'stroke-width': 1.5, 'stroke-dasharray': '5,4' });
  } else {
    let x0, y0, x1, y1;
    if (originType === 'center') { const half = side / 2; x0 = -half; y0 = -half; x1 = half; y1 = half; }
    else { x0 = 0; y0 = 0; x1 = side; y1 = side; }
    const rectX = mxToPx(x0), rectY = myToPy(y1);
    const rectW = mxToPx(x1) - mxToPx(x0), rectH = myToPy(y0) - myToPy(y1);
    appendNS(svg, 'rect', { x: rectX, y: rectY, width: rectW, height: rectH, fill: 'none', stroke: '#10b981', 'stroke-width': 1.5, 'stroke-dasharray': '5,4' });
  }

  // 點（先小後大、先死/弱後健 — sort 已在 caller 完成）
  points.forEach(p => {
    appendNS(svg, 'circle', {
      cx: p.px, cy: p.py, r: p.r,
      fill: VITALITY_COLOR[p.vitality] || '#78716c',
      'fill-opacity': 0.78,
      stroke: p.inside ? '#fff' : '#dc2626',
      'stroke-width': p.inside ? 1 : 2,
    });
  });

  // metadata 註解（plot code + 時間戳）— SVG 元素內當註解
  const titleNode = document.createElementNS(NS, 'title');
  titleNode.textContent = `tree-distribution / plot ${plot?.code || '?'} / ${new Date().toISOString()}`;
  svg.insertBefore(titleNode, svg.firstChild);

  return svg;
}

function appendNS(parent, tag, attrs, text) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function downloadSvg(svgEl, plotCode) {
  // 帶 xmlns + 標頭，獨立檔案開得起
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tree-distribution-${plotCode || 'plot'}-${Date.now()}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
