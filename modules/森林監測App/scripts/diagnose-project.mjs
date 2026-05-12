// diagnose-project.mjs — 診斷單一專案的 members / methodology / role 配置
//
// 用法：
//   node diagnose-project.mjs                          # 預設找「公園綠地碳匯調查」
//   node diagnose-project.mjs "其他專案名稱"           # 換別的名稱
//   node diagnose-project.mjs --pi-email a@b.c        # 同時定位特定 PI 在 members 中的位置
//
// 認證：沿用 `firebase login` 已 cache 的 OAuth refresh_token（從 ~/.config/configstore/firebase-tools.json）
//   不需要下載 serviceAccountKey.json。如果 401，請跑 `firebase login --reauth` 後重試。
//
// 純 read-only。不會寫入任何資料。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

// ---------- 參數 ----------
const args = process.argv.slice(2);
let PROJECT_NAME = '公園綠地碳匯調查';
let PI_EMAIL = '20407@gms.tcavs.tc.edu.tw';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pi-email') { PI_EMAIL = args[++i]; }
  else if (!args[i].startsWith('--')) { PROJECT_NAME = args[i]; }
}
const GCP_PROJECT = 'forestry-rs-monitor';

// ---------- firebase-tools 公開 OAuth client（installed application 類型，非機密） ----------
const FBT_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FBT_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ---------- 認證：refresh_token → access_token ----------
function loadConfigstore() {
  const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(p)) throw new Error(`找不到 firebase-tools configstore (${p})，請先跑 firebase login`);
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

async function exchangeRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: FBT_CLIENT_ID,
    client_secret: FBT_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }).toString();
  const r = await httpsRequest({
    method: 'POST',
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, body);
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`OAuth refresh 失敗: ${j.error} - ${j.error_description || ''}`);
  return j.access_token;
}

// ---------- Firestore REST API ----------
async function firestoreGet(token, urlPath) {
  const r = await httpsRequest({
    method: 'GET',
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${GCP_PROJECT}/databases/(default)/documents${urlPath}`,
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = JSON.parse(r.body);
  if (j.error) {
    const code = j.error.code || r.statusCode;
    throw new Error(`Firestore ${code}: ${j.error.message}`);
  }
  return j;
}

// 解開 Firestore type-wrapped 值
function unwrap(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = unwrap(val);
    return o;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrap);
  if ('geoPointValue' in v) return v.geoPointValue;
  return v;
}

function docToObj(doc) {
  const o = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = unwrap(v);
  o._id = doc.name.split('/').pop();
  return o;
}

// ---------- 主流程 ----------
(async () => {
  console.log(`\n🔍 診斷專案：「${PROJECT_NAME}」  (GCP project = ${GCP_PROJECT})`);
  console.log(`   定位 PI：${PI_EMAIL}\n`);

  const cfg = loadConfigstore();
  if (!cfg.tokens?.refresh_token) throw new Error('configstore 缺 refresh_token，請跑 firebase login');
  console.log(`   登入帳號：${cfg.user?.email || '(unknown)'}`);

  const token = await exchangeRefreshToken(cfg.tokens.refresh_token);

  // 列所有專案
  const list = await firestoreGet(token, '/projects?pageSize=300');
  const projects = (list.documents || []).map(docToObj);
  const matches = projects.filter(p => (p.name || '').includes(PROJECT_NAME));

  if (matches.length === 0) {
    console.error(`\n❌ 找不到名稱含「${PROJECT_NAME}」的專案`);
    console.error(`\n   現有專案（共 ${projects.length}）：`);
    for (const p of projects) console.error(`     - ${p.name}  (id=${p._id})`);
    process.exit(1);
  }
  if (matches.length > 1) console.warn(`⚠️ 找到 ${matches.length} 個匹配，將全部診斷`);

  // user 快取
  const userCache = new Map();
  async function fetchUser(uid) {
    if (userCache.has(uid)) return userCache.get(uid);
    try {
      const u = docToObj(await firestoreGet(token, `/users/${uid}`));
      userCache.set(uid, u);
      return u;
    } catch (e) {
      userCache.set(uid, null);
      return null;
    }
  }

  const validShapes = ['circle', 'square', 'rectangle', 'irregular'];
  const validDims = ['slope_distance', 'horizontal'];

  for (const proj of matches) {
    console.log('\n' + '━'.repeat(72));
    console.log(`📋 ${proj.name}  (id=${proj._id})`);
    console.log(`   專案層欄位：pi=${proj.pi}  status=${proj.status || '(無)'}  locked=${proj.locked}`);
    console.log(`   migratedV1_5=${proj.migratedV1_5}  migratedV2_3=${proj.migratedV2_3}`);

    // members
    const members = proj.members || {};
    const memberUids = proj.memberUids || [];
    console.log(`\n🧑‍🤝‍🧑 成員清單（members map，共 ${Object.keys(members).length}；memberUids 陣列共 ${memberUids.length}）：`);
    for (const [uid, role] of Object.entries(members)) {
      const u = await fetchUser(uid);
      const label = u ? `${u.email || '(no email)'} / ${u.displayName || '(no name)'}` : `(uid: ${uid}, /users 撈不到)`;
      const flag = role === 'pi' ? '👑' : role === 'surveyor' ? '🌳' : role === 'reviewer' ? '🔍' : '❓';
      const notInArr = !memberUids.includes(uid) ? '  ⚠️ 不在 memberUids' : '';
      console.log(`   ${flag} ${String(role).padEnd(10)} ${label}${notInArr}`);
    }
    // memberUids 中有但 members map 沒有的
    const orphanUids = memberUids.filter(uid => !(uid in members));
    if (orphanUids.length) {
      console.log(`   ⚠️ memberUids 含 ${orphanUids.length} 個 uid 不在 members map：${orphanUids.join(', ')}`);
    }

    // methodology 檢查（v2.7.15 rules 防線）
    console.log(`\n🧪 methodology 欄位檢查（v2.7.15 起 rules 強制 enum）：`);
    const m = proj.methodology || {};
    function check(key, val, whitelist) {
      if (!(key in m)) { console.log(`   ${key}: (未設) ✅ rules 寬鬆允許未設`); return true; }
      const ok = whitelist.includes(val);
      console.log(`   ${key}: ${JSON.stringify(val)} ${ok ? '✅' : `🚨 不在白名單 [${whitelist.join(', ')}]`}`);
      return ok;
    }
    const psOK = check('plotShape', m.plotShape, validShapes);
    const dtOK = check('dimensionType', m.dimensionType, validDims);

    // PI 定位
    console.log(`\n🎯 PI（${PI_EMAIL}）在這個專案的角色：`);
    let foundPiUid = null;
    for (const [uid] of Object.entries(members)) {
      const u = await fetchUser(uid);
      if (u && u.email === PI_EMAIL) { foundPiUid = uid; break; }
    }
    if (!foundPiUid) {
      // 也許 email 在 /users 但沒被加進這個 project members
      console.log(`   ⛔ 在這個專案的 members 中找不到此 email`);
    } else {
      const role = members[foundPiUid];
      console.log(`   uid = ${foundPiUid}`);
      console.log(`   members[uid] = ${JSON.stringify(role)}  ${role === 'pi' ? '✅' : '🚨 不是 \'pi\''}`);
      console.log(`   memberUids 含此 uid = ${memberUids.includes(foundPiUid) ? '✅' : '🚨 missing'}`);
      const u = await fetchUser(foundPiUid);
      if (u) console.log(`   /users 資料：systemRole=${u.systemRole}  globalRole=${u.globalRole}  displayName=${u.displayName}`);
    }

    // 結論
    console.log(`\n💡 診斷結論：`);
    const issues = [];
    if (!psOK) issues.push(`methodology.plotShape="${m.plotShape}" 不在 rules 白名單 → 所有 project update 會被擋（包含加成員、改方法學）`);
    if (!dtOK) issues.push(`methodology.dimensionType="${m.dimensionType}" 不在 rules 白名單 → 所有 project update 會被擋`);
    if (foundPiUid && members[foundPiUid] !== 'pi') issues.push(`${PI_EMAIL} 的 role="${members[foundPiUid]}" 不是 'pi' → rules isPi() 拒絕`);
    if (foundPiUid && !memberUids.includes(foundPiUid)) issues.push(`${PI_EMAIL} 的 uid 不在 memberUids 陣列 → read 也會被擋`);
    if (!foundPiUid) issues.push(`${PI_EMAIL} 完全不在 members 裡 → 老師可能用了不同 Google 帳號登入，或 admin 沒加他`);
    if (issues.length === 0) {
      console.log(`   ✅ 沒看到明顯阻擋。`);
      console.log(`      建議下一步：請老師在 prod 重現一次，DevTools Console 看 'FirebaseError: ...' 完整錯誤碼`);
    } else {
      issues.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    }
  }

  console.log('\n' + '━'.repeat(72));
  console.log('🏁 完成\n');
})().catch(e => {
  console.error(`\n❌ 失敗：${e.message}`);
  if (e.message.includes('401') || e.message.includes('UNAUTHENTICATED') || e.message.includes('refresh')) {
    console.error(`   → 請跑：firebase login --reauth`);
  }
  process.exit(1);
});
