// merge-cinnamon-zones.mjs
// 合併橫流溪、烏石坑作業單元 GeoJSON → 一個 FeatureCollection
// 給 ForestMRV「編輯專案 → 📐 專案邊界」上傳用
//
// 修補：
//   - 烏石坑檔欄位名 UTF-8 截斷還原（契約樹�→契約樹種 等）
//   - 加 專區 標籤（橫流溪 / 烏石坑）
//   - 移除 QGIS auxiliary_storage_labeling_* 暫存欄位
//   - UTF-8 no BOM 輸出
//
// 跑法：node merge-cinnamon-zones.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const fieldFix = {
  '契約樹�': '契約樹種',
  '伐木作�': '伐木作業',
  '造林作�': '造林作業',
  '撫育作�': '撫育作業',
  '契約面�': '契約面積',
};

function repairProps(props, zoneName) {
  const out = { '專區': zoneName };
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('auxiliary_storage_labeling_')) continue;
    const name = fieldFix[k] ?? k;
    out[name] = v;
  }
  return out;
}

const inputs = [
  { file: '橫流溪土肉桂作業單元.geojson', zone: '橫流溪' },
  { file: '烏石坑土肉桂作業單元.geojson', zone: '烏石坑' },
];

const out = {
  type: 'FeatureCollection',
  name: '土肉桂專區作業單元（橫流溪+烏石坑）',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3826' } },
  features: [],
};

const stats = {};

for (const { file, zone } of inputs) {
  const path = join(ROOT, file);
  const raw = readFileSync(path, 'utf8');
  const fc = JSON.parse(raw);
  if (fc.type !== 'FeatureCollection') {
    throw new Error(`${file}: not a FeatureCollection`);
  }
  let kept = 0, skipped = 0;
  for (const f of fc.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
      skipped++;
      continue;
    }
    out.features.push({
      type: 'Feature',
      properties: repairProps(f.properties || {}, zone),
      geometry: f.geometry,
    });
    kept++;
  }
  stats[zone] = { kept, skipped, source: file };
  console.log(`  ${zone.padEnd(6)} → ${kept} features (skipped ${skipped})`);
}

const outPath = join(ROOT, 'cinnamon-zones-merged.geojson');
// 壓縮輸出（節省 size，等同 prod 上傳格式）
const json = JSON.stringify(out);
writeFileSync(outPath, json, { encoding: 'utf8' });

const sizeKB = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
console.log('');
console.log('✅ 合併完成');
console.log(`  輸出：${outPath}`);
console.log(`  總 features：${out.features.length}`);
console.log(`  檔案大小：${sizeKB} KB（< 1024 KB Firestore 限制 OK）`);
console.log('');
console.log('  接下來：開 ForestMRV → 進入「土肉桂專區葉片收穫監測會計系統」專案');
console.log('  →「編輯專案」按鈕 → 📐 專案邊界（GeoJSON，選填）');
console.log('  → 上傳上面這個 cinnamon-zones-merged.geojson → 儲存');
console.log('  → 切到「地圖」分頁勾選「📐 專案邊界」應可看到兩個專區所有作業單元疊圖');
