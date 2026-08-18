// ===== 測試共用工具 =====
// 路徑一律相對本檔解析 — 不可寫死絕對路徑（worktree / 換電腦 / 換碟號都會壞）。
// 第三方 UMD（shpjs、proj4）執行時下載到 .cache/（已 gitignore），
// 不 vendor 進 repo：版本與 pwa/index.html 對齊，改版只要改這裡的常數。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PWA_JS = path.join(TESTS_DIR, '..', 'pwa', 'js');
export const FIXTURES = path.join(TESTS_DIR, 'fixtures');
const CACHE = path.join(TESTS_DIR, '.cache');

// 版本與 pwa/index.html 的 CDN 標籤對齊
const VENDOR = {
  'shp.min.js': 'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js',
  'proj4.js': 'https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js',
};

async function ensureVendor(name) {
  const p = path.join(CACHE, name);
  if (fs.existsSync(p)) return p;
  fs.mkdirSync(CACHE, { recursive: true });
  process.stdout.write(`  ↓ 下載 ${name} …`);
  const r = await fetch(VENDOR[name]);
  if (!r.ok) throw new Error(`${name} 下載失敗：HTTP ${r.status}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  console.log(' 完成');
  return p;
}

// 載入 pwa 端的模組（用 file URL，避開 Windows 路徑與中文目錄問題）
export function importPwa(file) {
  return import(pathToFileURL(path.join(PWA_JS, file)).href);
}

// shpjs 掛上 globalThis.shp，讓 shapefile-loader 的 lazy loader 直接 resolve、不碰 document
export async function loadShpGlobal() {
  if (globalThis.shp) return globalThis.shp;
  globalThis.self = globalThis;          // shpjs 初始化會摸 self（瀏覽器一定有，Node 沒有）
  const require = createRequire(import.meta.url);
  globalThis.shp = require(await ensureVendor('shp.min.js'));
  return globalThis.shp;
}

// 比照 app.js 的 TWD97（EPSG:3826）↔ WGS84
export async function loadProj() {
  const require = createRequire(import.meta.url);
  const proj4 = require(await ensureVendor('proj4.js'));
  const TWD97 = '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs';
  return {
    twd97ToWgs84: (x, y) => { const [lng, lat] = proj4(TWD97, 'WGS84', [x, y]); return { lng, lat }; },
    wgs84ToTwd97: (lng, lat) => { const [x, y] = proj4('WGS84', TWD97, [lng, lat]); return { x, y }; },
  };
}

// 把 fixtures 底下的檔案讀成 File[]（模擬使用者在檔案選取視窗選檔）
export function filesFromDir(dir) {
  return fs.readdirSync(dir).map(n => new File([fs.readFileSync(path.join(dir, n))], n));
}
export function fileAt(p) {
  return [new File([fs.readFileSync(p)], path.basename(p))];
}

export function requireFixtures() {
  if (!fs.existsSync(FIXTURES)) {
    console.error('❌ 找不到 fixtures/ — 請先執行：python make_fixtures.py（需要 geopandas）');
    process.exit(2);
  }
}

// ===== 迷你斷言 =====
export const results = { pass: 0, fail: 0 };
export function check(label, cond, detail = '') {
  const tail = detail ? ` — ${detail}` : '';
  if (cond) { results.pass++; console.log(`   ✅ ${label}${tail}`); }
  else { results.fail++; console.log(`   ❌ ${label}${tail}`); }
  return !!cond;
}
export function section(name) { console.log(`\n=== ${name} ===`); }
export function report() {
  console.log(`\n===== 通過 ${results.pass} / 失敗 ${results.fail} =====`);
  return results.fail === 0;
}
