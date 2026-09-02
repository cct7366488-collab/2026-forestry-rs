// ===== 專案邊界點面套疊回歸測試（Node）=====
//   執行：node test-boundary-containment.mjs      （不需 fixtures，純函式）
//
// 測的是 pwa/js/plot-polygon.js 的 isPointInBoundaryGeoJson()，
// 即地圖上「樣區點位要不要標紅（界外）」的判定依據（v2.11.93）。
//
// 為什麼要有這支：這個判定會直接改變調查員在野外看到的顏色 —— 誤判成紅色會讓人白跑一趟現場，
// 漏判成綠色則等於警訊失效。ray casting 的三個典型破口（凹多邊形、孔洞環、MultiPolygon
// 只中其中一塊）光讀程式碼看不出來，一律用明確的幾何案例釘死。

import { check, section, report } from './_harness.mjs';

const { isPointInBoundaryGeoJson } = await import(
  new URL('../pwa/js/plot-polygon.js', import.meta.url).href
);

// 以西關刀山一帶（約 120.80E / 24.40N）為基準造測試多邊形，數量級貼近真實專案邊界
const B = { lng: 120.80, lat: 24.40 };
const d = 0.01;   // ~1 km 量級

const square = [[
  [B.lng, B.lat], [B.lng + d, B.lat], [B.lng + d, B.lat + d], [B.lng, B.lat + d], [B.lng, B.lat],
]];

// ---------- 一、基本 Polygon ----------
section('Polygon：內 / 外');
check('中心點判為界內', isPointInBoundaryGeoJson(B.lng + d / 2, B.lat + d / 2, { type: 'Polygon', coordinates: square }) === true);
check('西側外部判為界外', isPointInBoundaryGeoJson(B.lng - d, B.lat + d / 2, { type: 'Polygon', coordinates: square }) === false);
check('北側外部判為界外', isPointInBoundaryGeoJson(B.lng + d / 2, B.lat + 2 * d, { type: 'Polygon', coordinates: square }) === false);
check('經緯度不可對調（把 lat 當 lng 傳一定落在界外）',
  isPointInBoundaryGeoJson(B.lat, B.lng, { type: 'Polygon', coordinates: square }) === false);

// ---------- 二、凹多邊形 ----------
// C 形：右側中段被挖開。凹口內的點在 bbox 內但不在多邊形內 —— 用 bbox 判定會誤判為界內。
section('凹多邊形：凹口內不算界內');
const cShape = [[
  [0, 0], [10, 0], [10, 3], [4, 3], [4, 7], [10, 7], [10, 10], [0, 10], [0, 0],
]];
const cPoly = { type: 'Polygon', coordinates: cShape };
check('左側實體部分判為界內', isPointInBoundaryGeoJson(2, 5, cPoly) === true);
check('凹口內（bbox 內但多邊形外）判為界外', isPointInBoundaryGeoJson(7, 5, cPoly) === false);
check('上臂實體部分判為界內', isPointInBoundaryGeoJson(7, 8.5, cPoly) === true);

// ---------- 三、孔洞環 ----------
section('孔洞環（外環內、洞內不算界內）');
const donut = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],       // 外環
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],           // 洞
  ],
};
check('環帶上判為界內', isPointInBoundaryGeoJson(2, 2, donut) === true);
check('洞內判為界外', isPointInBoundaryGeoJson(5, 5, donut) === false);
check('洞外且圖外判為界外', isPointInBoundaryGeoJson(20, 20, donut) === false);

// ---------- 四、MultiPolygon（FMP 常見多個分離林班）----------
section('MultiPolygon：任一塊命中即界內');
const multi = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
  ],
};
check('第一塊內判為界內', isPointInBoundaryGeoJson(1, 1, multi) === true);
check('第二塊內判為界內', isPointInBoundaryGeoJson(11, 11, multi) === true);
check('兩塊之間的空隙判為界外', isPointInBoundaryGeoJson(6, 6, multi) === false);

// ---------- 五、包裝格式 ----------
// 上傳端 parseProjectBoundaryGeoJson 目前輸出 FeatureCollection，舊資料可能是裸 geometry
section('包裝格式：FeatureCollection / Feature / 裸 geometry 都要吃');
const fc = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { 作業區: 'A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
    { type: 'Feature', properties: { 作業區: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]]] } },
  ],
};
check('FeatureCollection 第一 feature 命中', isPointInBoundaryGeoJson(1, 1, fc) === true);
check('FeatureCollection 第二 feature（MultiPolygon）命中', isPointInBoundaryGeoJson(11, 11, fc) === true);
check('FeatureCollection 皆不中', isPointInBoundaryGeoJson(50, 50, fc) === false);
check('單一 Feature 包裝', isPointInBoundaryGeoJson(1, 1, fc.features[0]) === true);

// ---------- 六、無從判斷一律回 null（呼叫端據此「不標示」）----------
// 這是最重要的一條：判不出來時絕不能回 false，否則整批樣區會被誤標成紅點。
section('無從判斷 → null（不可退化成 false）');
check('boundary 為 null', isPointInBoundaryGeoJson(1, 1, null) === null);
check('boundary 為 undefined', isPointInBoundaryGeoJson(1, 1, undefined) === null);
check('FeatureCollection 無 features', isPointInBoundaryGeoJson(1, 1, { type: 'FeatureCollection', features: [] }) === null);
check('只有點圖層（無面）', isPointInBoundaryGeoJson(1, 1, {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } }],
}) === null);
check('樣區座標缺漏（lng 為 undefined）', isPointInBoundaryGeoJson(undefined, 1, fc) === null);
check('樣區座標為 NaN', isPointInBoundaryGeoJson(NaN, NaN, fc) === null);

// ---------- 七、爛資料不可 throw ----------
// 地圖 render 在 onSnapshot 迴圈裡，這裡一 throw 整張圖就空白。
section('爛資料：回傳值可疑但不得 throw');
const bad = [
  { type: 'Polygon', coordinates: [] },
  { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] },              // 環只有 2 點
  { type: 'MultiPolygon', coordinates: [null, undefined] },
  { type: 'FeatureCollection', features: [{ type: 'Feature' }] },     // feature 無 geometry
  { type: 'GeometryCollection', geometries: [] },                     // 不支援的 type
];
let threw = null;
for (const g of bad) {
  try { isPointInBoundaryGeoJson(1, 1, g); }
  catch (e) { threw = `${g.type}: ${e.message}`; break; }
}
check('全部爛資料都沒 throw', threw === null, threw || '');

process.exit(report() ? 0 : 1);
