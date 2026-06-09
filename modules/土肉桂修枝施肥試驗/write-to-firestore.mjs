// write-to-firestore.mjs — 消費 dry-run/payload.json，寫入 ForestMRV prod（forestry-rs-monitor）
// =====================================================================================
// 用法：
//   node write-to-firestore.mjs                      # DRY-RUN（預設，不寫；列出計畫）
//   node write-to-firestore.mjs --execute --limit 1  # 金絲雀：只寫 project + 前 1 個 plot
//   node write-to-firestore.mjs --execute --plot 115121-C0   # 只寫指定 plot
//   node write-to-firestore.mjs --execute            # 全寫（16 plots）
//   node write-to-firestore.mjs --undo --execute     # 回收：刪整個 CINNAMON-TRIAL 專案（建議直接用 firebase CLI 遞迴刪）
//   --gcp <projectId>                                # 覆寫 GCP 專案（預設 forestry-rs-monitor＝prod）
//
// 認證：沿用 firebase-tools configstore refresh_token → Firestore REST owner token（同 backfill-i1-measurements.mjs）。
//
// 安全 / 冪等：
//   - 固定 doc id：project=CINNAMON-TRIAL、plot=plot.code、tree=treeCode、measurement=periodId。
//     → 全部用 PATCH(upsert)，可重跑不產生重複。
//   - 純加性：只建立一個全新隔離專案，不碰任何既有專案。
//   - 回滾：firebase firestore:delete projects/CINNAMON-TRIAL --recursive --project forestry-rs-monitor
//   - DRY-RUN 為預設；--execute 才寫。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes('--execute');
const UNDO = ARGV.includes('--undo');
const argVal = (flag) => { const i = ARGV.indexOf(flag); return i >= 0 ? ARGV[i + 1] : null; };
const GCP_PROJECT = argVal('--gcp') || 'forestry-rs-monitor';
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const ONLY_PLOT = argVal('--plot') || null;
const PROJECT_ID = 'CINNAMON-TRIAL';

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
  return { token: j.access_token, email: cfg.user?.email || null };
}

// ---------- Firestore REST ----------
const BASE = `/v1/projects/${GCP_PROJECT}/databases/(default)/documents`;
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
async function getDocOrNull(token, relPath) {
  const r = await raw(token, 'GET', `${BASE}/${relPath}`);
  if (r.statusCode === 404) return null;
  const j = r.body ? JSON.parse(r.body) : {};
  if (j.error) { if (j.error.code === 404) return null; throw new Error(`Firestore ${j.error.code}: ${j.error.message}`); }
  return j;
}
async function queryUserUidByEmail(token, email) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
      limit: 1
    }
  };
  const r = await rest(token, 'POST', `${BASE}:runQuery`, body);
  const doc = (Array.isArray(r) ? r : []).find(x => x.document);
  if (!doc) return null;
  return doc.document.name.split('/').pop();
}

// ---------- typed value 編碼 ----------
function encVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encVal) } };
  if (typeof v === 'object') {
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
async function patchDoc(token, relPath, obj) {
  // PATCH(upsert)：updateMask 列出所有欄位 → 整份覆寫該 doc
  const mask = Object.keys(obj).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  await rest(token, 'PATCH', `${BASE}/${relPath}?${mask}`, { fields: toFields(obj) });
}

// ---------- ISO date → Firestore Date ----------
const D = (iso) => new Date(iso + 'T00:00:00Z');

// ---------- 建構各層 doc（對齊 app schema）----------
function buildProjectDoc(p, piUid) {
  return {
    code: p.code, name: p.name, description: p.design || '',
    coordinateSystem: 'TWD97_TM2',
    pi: piUid, pis: [piUid], members: { [piUid]: 'pi' }, memberUids: [piUid],
    methodology: {
      targetPlotCount: 16, plotShape: 'rectangle', dimensionType: 'horizontal',
      plotOriginType: 'center',
      modules: { plot: true, tree: true, regeneration: false, understory: false,
                 soilCons: false, wildlife: false, harvest: false, disturbance: false },
      surveyMethod: 'census', monitoring: 'repeat',
      carbonComputed: false,
    },
    locked: false, status: 'active', archived: false,
    statusChangedBy: piUid, autoLockReason: null,
    reviews: [], verifiedBy: null, verifiedAt: null,
    // 試驗 meta
    experiment: { design: p.design, species: p.species, dataProvenance: p.dataProvenance, notes: p.notes },
    createdBy: piUid,
    importedBy: 'etl-cinnamon', importSource: 'etl-long-format',
  };
}
function buildPlotDoc(plot, piUid) {
  const periods = plot.periods.map(pe => ({
    seq: pe.seq, label: pe.label, season: pe.season,
    openedAt: { __ts: D(pe.openedAt).toISOString() },
    closedAt: pe.closedAt ? { __ts: D(pe.closedAt).toISOString() } : null,
    dateProvisional: true, note: null, openedBy: piUid,
  }));
  return {
    code: plot.code, forestUnit: plot.compartment || null,
    location: null, locationTWD97: null,           // 無座標研究樣區
    positionMode: 'offset',
    area_m2: Math.round(plot.area_ha * 10000),
    area_ha: plot.area_ha,
    insideBoundary: true,
    // 試驗設計欄位
    treatment: plot.treatment, treatmentZh: plot.treatmentZh,
    pruning: plot.pruning, fertilizer_g: plot.fertilizer_g,
    standAge: plot.standAge, diameterType: plot.diameterType,
    species: plot.species,
    // 複查期別
    periods, currentPeriod: plot.currentPeriod,
    qaStatus: 'imported',
    notes: `${plot.standAge}；處理=${plot.treatmentZh}；量測部位=${plot.diameterType === 'breast' ? '胸徑' : '地徑'}`,
    establishedAt: { __ts: D(plot.periods[0].openedAt).toISOString() },
    createdAt: { __ts: new Date().toISOString() },   // ★ 必填：app.js 樣區清單 orderBy('createdAt') 缺此欄位會被濾掉
    createdBy: piUid,
    importedBy: 'etl-cinnamon',
  };
}
function buildTreeDoc(tree, piUid) {
  // priorSnapshot：取最新期之前一期（供複查野外清單）
  const seqs = Object.keys(tree.measurements).map(Number).sort((a, b) => a - b);
  const latestSeq = seqs[seqs.length - 1];
  const prevSeq = seqs.length > 1 ? seqs[seqs.length - 2] : null;
  const prev = prevSeq != null ? tree.measurements[String(prevSeq)] : null;
  return {
    treeNum: tree.treeNum, treeCode: tree.treeCode,
    speciesZh: tree.speciesZh, speciesSci: tree.speciesSci,
    diameterType: tree.diameterType,
    dbh_cm: tree.dbh_cm, height_m: tree.height_m,
    vitality: tree.vitality, resurveyFate: tree.resurveyFate,
    recruitedPeriod: null, nstem: tree.nstem,
    localX_m: null, localY_m: null, locationTWD97: null,
    basalArea_m2: tree.basalArea_m2 ?? null, volume_m3: tree.volume_m3 ?? null,
    biomass_kg: tree.biomass_kg ?? null, carbon_kg: tree.carbon_kg ?? null, co2_kg: tree.co2_kg ?? null,
    carbonSkipped: tree.carbonSkipped ?? null,
    priorSnapshot: prev ? {
      fromPeriod: prevSeq, dbh_cm: prev.dbh_cm, height_m: prev.height_m,
      vitality: prev.vitality, stampedAt: { __ts: new Date().toISOString() },
    } : null,
    qaStatus: 'imported',
    createdAt: { __ts: new Date().toISOString() },   // 一致性：部分子集合 query 以 createdAt 排序
    createdBy: piUid, importedBy: 'etl-cinnamon', source: 'etl-long-format',
  };
}
function buildMeasurementDoc(tree, m, piUid) {
  return {
    periodId: m.periodId, season: m.season,
    treeCode: tree.treeCode, treeNum: tree.treeNum,
    speciesZh: tree.speciesZh, speciesSci: tree.speciesSci,
    dbh_cm: m.dbh_cm, height_m: m.height_m, nstem: m.nstem,
    vitality: m.vitality, resurveyFate: m.resurveyFate,
    diameterType: m.diameterType,
    branchHeight_m: null, pestSymptoms: [], marking: null, notes: null,
    localX_m: null, localY_m: null, locationTWD97: null,
    basalArea_m2: m.basalArea_m2 ?? null, volume_m3: m.volume_m3 ?? null,
    biomass_kg: m.biomass_kg ?? null, carbon_kg: m.carbon_kg ?? null, co2_kg: m.co2_kg ?? null,
    carbonSkipped: m.carbonSkipped ?? null, equationSource: m.equationSource ?? null,
    recordedDate: m.recordedDate, dateProvisional: true,
    source: 'etl-long-format', recordedBy: piUid, createdBy: piUid,
    recordedAt: { __ts: D(m.recordedDate).toISOString() },
  };
}

// ---------- main ----------
(async () => {
  console.log(`\n🌿 土肉桂 ETL → Firestore writer（GCP=${GCP_PROJECT}）`);
  console.log(`   模式：${EXECUTE ? '★ EXECUTE（實寫）' : 'DRY-RUN（不寫）'}`
    + `${LIMIT ? ` / --limit ${LIMIT}` : ''}${ONLY_PLOT ? ` / --plot ${ONLY_PLOT}` : ''}`);

  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, 'dry-run', 'payload.json'), 'utf8'));
  const { token, email } = await getToken();
  console.log(`   登入帳號：${email}`);

  if (UNDO) {
    console.log('   ⚠ UNDO：請直接執行  firebase firestore:delete projects/CINNAMON-TRIAL --recursive --project ' + GCP_PROJECT);
    return;
  }

  const piUid = await queryUserUidByEmail(token, email);
  if (!piUid) throw new Error(`找不到 email=${email} 的 users doc（請先用此帳號登入過 App 一次）`);
  console.log(`   PI uid：${piUid}`);

  // 防覆蓋既有專案（若已存在且非預期 → 警告）
  const existing = await getDocOrNull(token, `projects/${PROJECT_ID}`);
  if (existing) console.log(`   ⚠ projects/${PROJECT_ID} 已存在 — 將以 upsert 覆寫（冪等）`);

  // 選 plots
  let plots = payload.plots;
  if (ONLY_PLOT) plots = plots.filter(p => p.code === ONLY_PLOT);
  else if (LIMIT) plots = plots.slice(0, LIMIT);

  const nTrees = plots.reduce((s, p) => s + p.trees.length, 0);
  const nMeas = plots.reduce((s, p) => s + p.trees.reduce((t, x) => t + Object.keys(x.measurements).length, 0), 0);
  console.log(`   計畫寫入：project ×1 + plots ×${plots.length} + trees ×${nTrees} + measurements ×${nMeas}`);

  // species seed
  console.log(`   species seed：土肉桂 (Cinnamomum osmophloeum) verified=false`);

  if (!EXECUTE) {
    console.log('\n   （DRY-RUN：以上為計畫，未寫入。加 --execute 才寫。）');
    return;
  }

  // 1) project
  await patchDoc(token, `projects/${PROJECT_ID}`, buildProjectDoc(payload.project, piUid));
  console.log(`   ✓ project ${PROJECT_ID}`);

  // 2) species（top-level 共享字典；id = 中文名）
  //    ⚠ 既有 species/土肉桂 可能已驗證且參數齊全（woodDensity/equation 等）→ 存在則「絕不覆寫」，只在缺漏時 seed。
  const spExisting = await getDocOrNull(token, `species/${encodeURIComponent('土肉桂')}`);
  if (spExisting) {
    console.log('   ⏭ species 土肉桂 已存在（保留既有 verified 資料，不覆寫）');
  } else {
    await patchDoc(token, `species/${encodeURIComponent('土肉桂')}`, {
      zh: '土肉桂', sci: 'Cinnamomum osmophloeum', verified: false,
      addedFrom: 'etl-cinnamon', addedBy: piUid,
    });
    console.log('   ✓ species 土肉桂（新 seed verified=false）');
  }

  // 3) plots + trees + measurements
  for (const plot of plots) {
    await patchDoc(token, `projects/${PROJECT_ID}/plots/${encodeURIComponent(plot.code)}`, buildPlotDoc(plot, piUid));
    let tCount = 0, mCount = 0;
    for (const tree of plot.trees) {
      const treeRel = `projects/${PROJECT_ID}/plots/${encodeURIComponent(plot.code)}/trees/${encodeURIComponent(tree.treeCode)}`;
      await patchDoc(token, treeRel, buildTreeDoc(tree, piUid));
      tCount++;
      for (const [seq, m] of Object.entries(tree.measurements)) {
        await patchDoc(token, `${treeRel}/measurements/${seq}`, buildMeasurementDoc(tree, m, piUid));
        mCount++;
      }
    }
    console.log(`   ✓ plot ${plot.code}: trees ${tCount}, measurements ${mCount}`);
  }
  console.log('\n✅ 寫入完成。');
  console.log('   回滾指令：firebase firestore:delete projects/CINNAMON-TRIAL --recursive --project ' + GCP_PROJECT);
})().catch(e => { console.error('\n❌ 失敗：', e.message); process.exit(1); });
