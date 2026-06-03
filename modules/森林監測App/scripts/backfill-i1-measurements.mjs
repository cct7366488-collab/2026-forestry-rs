// backfill-i1-measurements.mjs — I-1 永久樣區複查地基：為既有立木補建「第一期」measurement 歷史快照
//
// 用法：
//   node backfill-i1-measurements.mjs                       # DRY-RUN（預設，不寫；列出將補建筆數）
//   node backfill-i1-measurements.mjs --execute             # 實際寫入（全專案）
//   node backfill-i1-measurements.mjs --project <docId>     # 限定單一專案
//   node backfill-i1-measurements.mjs --execute --project X # 限定單一專案實寫
//   node backfill-i1-measurements.mjs --undo --execute      # 回收：刪所有 source=='backfill' 的 measurement
//   --gcp <projectId>                                       # 覆寫 GCP 專案（預設 forestry-rs-monitor＝prod）
//
// 認證：沿用 firebase login OAuth refresh_token（同 seed-cinnamon-demo.mjs / diagnose-project.mjs），
//   走 Firestore REST owner token → 繞 client security rules，故可處理 locked / verified 專案。
//
// 安全 / 冪等設計：
//   - measurement doc id = periodId（plot.currentPeriod ?? 1）。已存在則 SKIP（可重跑、不覆寫）。
//   - 純加性：只「建立」measurements 子集合 doc，絕不修改 / 刪除 tree 本體 → 可 --undo 完全回收。
//   - DRY-RUN 為預設；--execute 才寫。每筆帶 source:'backfill' / migratedFrom:'i1-backfill'。
//   - 啟動前請先 export 全 prod Firestore 備份（記憶 project_resurvey_workflow_gap 強制訓）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes('--execute');
const UNDO = ARGV.includes('--undo');
const argVal = (flag) => { const i = ARGV.indexOf(flag); return i >= 0 ? ARGV[i + 1] : null; };
const GCP_PROJECT = argVal('--gcp') || 'forestry-rs-monitor';
const ONLY_PROJECT = argVal('--project') || null;

const FBT_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FBT_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ---------- 認證 ----------
function loadConfigstore() {
  const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(p)) throw new Error(`找不到 firebase-tools configstore (${p})，請先 firebase login`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function getToken() {
  const cfg = loadConfigstore();
  if (!cfg.tokens?.refresh_token) throw new Error('configstore 缺 refresh_token，請 firebase login');
  const body = new URLSearchParams({
    client_id: FBT_CLIENT_ID, client_secret: FBT_CLIENT_SECRET,
    refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token'
  }).toString();
  const r = await httpsRequest({
    method: 'POST', hostname: 'oauth2.googleapis.com', path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, body);
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`OAuth refresh 失敗: ${j.error}`);
  console.log(`   登入帳號：${cfg.user?.email || '(unknown)'}`);
  return j.access_token;
}

// ---------- Firestore REST ----------
const BASE = `/v1/projects/${GCP_PROJECT}/databases/(default)/documents`;
const DOC_PREFIX = `projects/${GCP_PROJECT}/databases/(default)/documents`;

function raw(token, method, urlPath, payload) {
  return httpsRequest({
    method, hostname: 'firestore.googleapis.com', path: urlPath,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }, payload ? JSON.stringify(payload) : null);
}
async function rest(token, method, urlPath, payload) {
  const r = await raw(token, method, urlPath, payload);
  const j = r.body ? JSON.parse(r.body) : {};
  if (j.error) throw new Error(`Firestore ${j.error.code || r.statusCode}: ${j.error.message}`);
  return j;
}
// 存在性檢查：404 回 null（不 throw）
async function getDocOrNull(token, relPath) {
  const r = await raw(token, 'GET', `${BASE}/${relPath}`);
  if (r.statusCode === 404) return null;
  const j = r.body ? JSON.parse(r.body) : {};
  if (j.error) {
    if (j.error.code === 404) return null;
    throw new Error(`Firestore ${j.error.code}: ${j.error.message}`);
  }
  return j;
}
// 分頁列出 collection（回 documents[]）
async function listAll(token, collRelPath) {
  const out = [];
  let pageToken = null;
  do {
    const qs = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const j = await rest(token, 'GET', `${BASE}/${collRelPath}?${qs}`);
    for (const d of (j.documents || [])) out.push(d);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return out;
}

// ---------- typed value 編 / 解 ----------
function decVal(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('geoPointValue' in v) return { __geo: { lat: v.geoPointValue.latitude, lng: v.geoPointValue.longitude } };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decVal);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = decVal(val);
    return o;
  }
  return null;
}
function decFields(doc) {
  const o = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = decVal(v);
  return o;
}
function encVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encVal) } };
  if (typeof v === 'object') {
    if (v.__geo) return { geoPointValue: { latitude: v.__geo.lat, longitude: v.__geo.lng } };
    if (v.__ts) return { timestampValue: v.__ts };
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encVal(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = encVal(v);
  return fields;
}
const docPath = (rel) => `${DOC_PREFIX}/${rel}`;
async function commitWrites(token, writes) {
  for (let i = 0; i < writes.length; i += 100) {
    await rest(token, 'POST', `${BASE}:commit`, { writes: writes.slice(i, i + 100) });
  }
}

// tree 欄位 → measurement 快照（與 forms.js#buildMeasurementSnapshot 對齊）
function buildSnapshot(t, periodId) {
  return {
    periodId,
    treeCode: t.treeCode ?? null,
    treeNum: t.treeNum ?? null,
    speciesZh: t.speciesZh ?? null,
    speciesSci: t.speciesSci ?? null,
    dbh_cm: t.dbh_cm ?? null,
    height_m: t.height_m ?? null,
    branchHeight_m: t.branchHeight_m ?? null,
    vitality: t.vitality ?? null,
    pestSymptoms: Array.isArray(t.pestSymptoms) ? t.pestSymptoms : [],
    marking: t.marking ?? null,
    notes: t.notes ?? null,
    localX_m: t.localX_m ?? null,
    localY_m: t.localY_m ?? null,
    locationTWD97: t.locationTWD97 ?? null,
    location: t.location ?? null,                  // {__geo} 標記 → encVal 轉回 geoPointValue
    positionSource: t.positionSource ?? null,
    gpsAccuracy_m: t.gpsAccuracy_m ?? null,
    manuallyAdjusted: t.manuallyAdjusted ?? false,
    basalArea_m2: t.basalArea_m2 ?? null,
    volume_m3: t.volume_m3 ?? null,
    biomass_kg: t.biomass_kg ?? null,
    carbon_kg: t.carbon_kg ?? null,
    co2_kg: t.co2_kg ?? null,
    source: 'backfill',
    migratedFrom: 'i1-backfill',
    recordedBy: 'i1-backfill-script',
    createdBy: t.createdBy ?? 'i1-backfill-script',
    recordedAt: new Date()
  };
}

(async () => {
  console.log(`\n🌲 I-1 measurement backfill（GCP=${GCP_PROJECT}）`);
  console.log(`   模式：${UNDO ? 'UNDO（回收 backfill）' : 'BACKFILL'} / ${EXECUTE ? '★ EXECUTE（實寫）' : 'DRY-RUN（不寫）'}`);
  if (ONLY_PROJECT) console.log(`   限定專案：${ONLY_PROJECT}`);
  const token = await getToken();

  const projects = ONLY_PROJECT
    ? [{ name: `x/${ONLY_PROJECT}` }]
    : await listAll(token, 'projects');
  console.log(`   專案數：${projects.length}`);

  let scanned = 0, would = 0, skipped = 0, undone = 0;
  const writes = [];

  for (const pj of projects) {
    const pid = pj.name.split('/').pop();
    let plots;
    try { plots = await listAll(token, `projects/${pid}/plots`); }
    catch (e) { console.warn(`   ⚠ 專案 ${pid} 讀 plots 失敗：${e.message}`); continue; }

    for (const pl of plots) {
      const plotId = pl.name.split('/').pop();
      const plotData = decFields(pl);
      const periodId = Number(plotData.currentPeriod) || 1;
      let trees;
      try { trees = await listAll(token, `projects/${pid}/plots/${plotId}/trees`); }
      catch (e) { console.warn(`   ⚠ ${pid}/${plotId} 讀 trees 失敗：${e.message}`); continue; }

      for (const tr of trees) {
        const treeId = tr.name.split('/').pop();
        const mRel = `projects/${pid}/plots/${plotId}/trees/${treeId}/measurements`;

        if (UNDO) {
          let ms;
          try { ms = await listAll(token, mRel); } catch { ms = []; }
          for (const md of ms) {
            if (decFields(md).source === 'backfill') {
              writes.push({ delete: docPath(`${mRel}/${md.name.split('/').pop()}`) });
              undone++;
            }
          }
          continue;
        }

        scanned++;
        const existing = await getDocOrNull(token, `${mRel}/${periodId}`);
        if (existing) { skipped++; continue; }
        would++;
        const t = decFields(tr);
        if (would <= 5) {
          console.log(`   + ${pid}/${plotId}/${treeId} → measurements/${periodId}` +
            ` (${t.treeCode || '?'} DBH=${t.dbh_cm ?? '?'} H=${t.height_m ?? '?'})`);
        }
        writes.push({
          update: { name: docPath(`${mRel}/${periodId}`), fields: toFields(buildSnapshot(t, periodId)) }
        });
      }
    }
  }

  if (UNDO) {
    console.log(`\n🧹 將回收 backfill measurement：${undone} 筆`);
    if (EXECUTE && writes.length) { await commitWrites(token, writes); console.log('   ✅ 已刪除。'); }
    else console.log('   （DRY-RUN：未刪除。加 --execute 實際回收。）');
    return;
  }

  console.log(`\n📊 掃描立木 ${scanned}｜已存在 SKIP ${skipped}｜將補建 ${would}`);
  if (!EXECUTE) {
    console.log('   （DRY-RUN：未寫入。確認無誤後加 --execute 實際 backfill。）');
    console.log('   ⚠ 執行前務必已 export 全 prod Firestore 備份。');
    return;
  }
  if (writes.length) {
    await commitWrites(token, writes);
    console.log(`   ✅ 已補建 ${would} 筆 measurement（idempotent — 可重跑）。`);
  } else {
    console.log('   ✅ 無需補建（全部已存在）。');
  }
})().catch(e => { console.error('\n❌ 失敗：', e.message); process.exit(1); });
