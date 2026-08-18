// ===== shapefile-loader 回歸測試（Node）=====
//   執行：node test-shapefile-loader.mjs      （先跑過 python make_fixtures.py）
//   涵蓋兩條下游路徑：
//     專案邊界 → parseProjectBoundaryGeoJson()（絕對座標、CRS 自動偵測）
//     樣區邊界 → parseGeoJsonPolygon()（local m 換算、VERTEX_MAX、面積）
//
// 為什麼要有這支：Shapefile 是二進位多檔格式，光看程式碼看不出「Big5 有沒有解對」
// 「zip 有沒有解開」「投影對不對」。這裡一律用 geopandas 產的真檔驗，不用 mock。

import path from 'node:path';
import {
  FIXTURES, importPwa, loadShpGlobal, loadProj, filesFromDir, fileAt,
  requireFixtures, check, section, report,
} from './_harness.mjs';

requireFixtures();
await loadShpGlobal();
const { twd97ToWgs84, wgs84ToTwd97 } = await loadProj();

const { shapefileFilesToGeoJson, looksLikeShapefile } = await importPwa('shapefile-loader.js');
const { parseProjectBoundaryGeoJson, parseGeoJsonPolygon, validatePolygon, VERTEX_MAX } =
  await importPwa('plot-polygon.js');

const fx = n => path.join(FIXTURES, n);

// ---------- 專案邊界 ----------
async function runBoundary(name, files, expect) {
  section(name);
  check('looksLikeShapefile 認得', looksLikeShapefile(files));
  let r;
  try {
    r = await shapefileFilesToGeoJson(files);
  } catch (e) {
    if (expect.throws) check(`如預期擋下`, e.message.includes(expect.throws), e.message);
    else check('不該拋例外', false, e.message);
    return;
  }
  if (expect.throws) { check('應該要擋下卻通過了', false); return; }

  r.meta.notes.forEach(n => console.log(`   note: ${n}`));
  check('feature 數', r.meta.featureCount === expect.count, `得 ${r.meta.featureCount} / 期望 ${expect.count}`);
  check('編碼偵測', r.meta.encoding === expect.encoding, `得 ${r.meta.encoding} / 期望 ${expect.encoding}`);

  const flat = JSON.stringify(r.geojson.features[0].properties);
  if (expect.noProps) check('無 .dbf → 屬性為空', flat === '{}', flat);
  else check('中文屬性正確（含 Big5 欄位名）', flat.includes('陳') && flat.includes('橫流溪'), flat);
  check('無 U+FFFD 亂碼', !flat.includes('�'));

  const parsed = parseProjectBoundaryGeoJson(r.geojson, twd97ToWgs84);
  const [w, s, e, n] = parsed.bbox;
  check('下游 srcSystem', parsed.srcSystem === expect.srcSystem, `得 ${parsed.srcSystem} / 期望 ${expect.srcSystem}`);
  // 不論走 .prj 投影或無 .prj 自動偵測，最終都要落在橫流溪一帶 → 兩條路互為交叉驗證
  check('最終座標落在台灣中部（約 120.70E / 24.17N）',
    w > 120.68 && e < 120.73 && s > 24.16 && n < 24.19,
    `bbox=[${w.toFixed(4)}, ${s.toFixed(4)}, ${e.toFixed(4)}, ${n.toFixed(4)}]`);
}

await runBoundary('專案邊界｜WGS84 + .prj + UTF-8(.cpg) 散檔',
  filesFromDir(fx('case1_wgs84_utf8')), { count: 2, encoding: 'utf-8', srcSystem: 'WGS84' });

await runBoundary('專案邊界｜TWD97 + .prj + Big5 無 .cpg 散檔（政府圖資常見）',
  filesFromDir(fx('case2_twd97_big5_nocpg')), { count: 2, encoding: 'big5', srcSystem: 'WGS84' });

await runBoundary('專案邊界｜TWD97 無 .prj（靠座標範圍自動判斷）',
  filesFromDir(fx('case3_twd97_noprj')), { count: 2, encoding: 'utf-8', srcSystem: 'TWD97' });

await runBoundary('專案邊界｜線圖層（應擋下）',
  filesFromDir(fx('case4_line')), { throws: '專案邊界需要面' });

await runBoundary('專案邊界｜ZIP deflate（TWD97 + Big5）',
  fileAt(fx('case5_zip_deflate.zip')), { count: 2, encoding: 'big5', srcSystem: 'WGS84' });

await runBoundary('專案邊界｜ZIP stored 未壓縮（WGS84 + UTF-8）',
  fileAt(fx('case6_zip_stored.zip')), { count: 2, encoding: 'utf-8', srcSystem: 'WGS84' });

await runBoundary('專案邊界｜只有 .shp（無 dbf / prj）',
  fileAt(path.join(fx('case3_twd97_noprj'), 'case3_twd97_noprj.shp')),
  { count: 2, encoding: null, srcSystem: 'TWD97', noProps: true });

// ---------- 樣區邊界（local m）----------
section('樣區邊界｜20×25 m TWD97 + .prj → local 座標 / 面積');
{
  const { geojson, meta } = await shapefileFilesToGeoJson(filesFromDir(fx('case7_plot_20x25')));
  meta.notes.forEach(n => console.log(`   note: ${n}`));

  // 樣區 GPS 設在多邊形中心附近（模擬使用者已定位）
  const c = twd97ToWgs84(219910, 2674062);
  const center = wgs84ToTwd97(c.lng, c.lat);
  const result = parseGeoJsonPolygon(geojson, center, twd97ToWgs84, wgs84ToTwd97);
  const v = validatePolygon(result.vertices.map(p => ({ x: p.x, y: p.y })));

  console.log('   local(m): ' + result.vertices.map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(' '));
  // 有 .prj → shpjs 已依 WKT 投影到 WGS84（無 .prj 才會是 TWD97）
  check('srcSystem = WGS84（有 .prj 已投影）', result.srcSystem === 'WGS84', result.srcSystem);
  check(`頂點數 ≤ VERTEX_MAX(${VERTEX_MAX})`, result.vertices.length <= VERTEX_MAX, `${result.vertices.length} 點`);
  check('多邊形有效（簡單、CCW 已校正）', v.ok, v.ok ? '' : v.error);
  check('Shoelace 面積 ≈ 500 m²（20×25 理論值）', v.ok && Math.abs(v.area - 500) < 1, `得 ${v.area?.toFixed(1)} m²`);
  const cx = v.ok ? v.vertices.reduce((s, p) => s + p.x, 0) / v.vertices.length : NaN;
  const cy = v.ok ? v.vertices.reduce((s, p) => s + p.y, 0) / v.vertices.length : NaN;
  check('重心離 GPS 中心 < 200 m（不觸發警示）', Math.hypot(cx, cy) < 200, `${Math.hypot(cx, cy).toFixed(1)} m`);
}

process.exit(report() ? 0 : 1);
