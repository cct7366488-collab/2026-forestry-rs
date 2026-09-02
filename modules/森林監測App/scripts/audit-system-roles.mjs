// audit-system-roles.mjs — 稽核 /users 的系統層級角色（systemRole / globalRole）
//
// 為什麼需要：firestore.rules 的 /users/{uid} 寫入規則長期無欄位限制
//   （allow write: if isSignedIn() && request.auth.uid == uid），任何登入者都能把自己的
//   systemRole 改成 'admin'，而 isSystemAdmin() 正是讀這份文件 → 自封系統管理員。
//   收掉規則之前／之後，都必須實際盤點一次：有沒有人已經提權、名單是否只剩應有的人。
//
// 用法：
//   node audit-system-roles.mjs                 # 列出所有非 member 的帳號
//   node audit-system-roles.mjs --all           # 列出全部帳號
//
// 認證：沿用 `firebase login` 已 cache 的 OAuth refresh_token（同 diagnose-project.mjs）。
//   若 401，請跑 `firebase login --reauth` 後重試。
//
// 純 read-only。不寫入任何資料。
//
// ⚠ 注意：本腳本用 owner token 走 REST，會「繞過」Security Rules。
//   它能證明資料現況（誰是 admin），但證明不了規則本身擋不擋得住——後者請看規則本文與部署紀錄。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const GCP_PROJECT = 'forestry-rs-monitor';
const SHOW_ALL = process.argv.includes('--all');

// firebase-tools 公開 OAuth client（installed application 類型，非機密）
const FBT_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FBT_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

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
    grant_type: 'refresh_token',
  }).toString();
  const r = await httpsRequest({
    method: 'POST',
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`OAuth refresh 失敗: ${j.error} - ${j.error_description || ''}`);
  return j.access_token;
}

async function firestoreGet(token, urlPath) {
  const r = await httpsRequest({
    method: 'GET',
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${GCP_PROJECT}/databases/(default)/documents${urlPath}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`Firestore ${j.error.code || r.statusCode}: ${j.error.message}`);
  return j;
}

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
  return v;
}

function docToObj(doc) {
  const o = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = unwrap(v);
  o._id = doc.name.split('/').pop();
  return o;
}

(async () => {
  console.log(`\n🔍 稽核系統層級角色  (GCP project = ${GCP_PROJECT})\n`);
  const cs = loadConfigstore();
  const refreshToken = cs?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('configstore 內找不到 refresh_token，請先跑 firebase login');
  const token = await exchangeRefreshToken(refreshToken);

  // 分頁抓完整 /users
  const users = [];
  let pageToken = '';
  do {
    const qs = `?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreGet(token, `/users${qs}`);
    for (const d of (res.documents || [])) users.push(docToObj(d));
    pageToken = res.nextPageToken || '';
  } while (pageToken);

  console.log(`帳號總數：${users.length}\n`);

  const admins = users.filter(u => u.systemRole === 'admin' || u.globalRole === 'admin');
  const others = users.filter(u => !admins.includes(u) && (u.systemRole && u.systemRole !== 'member'));

  const fmt = (u) => `  ${(u.email || '(無 email)').padEnd(38)} systemRole=${String(u.systemRole)}`
    + (u.globalRole ? ` globalRole=${u.globalRole}` : '')
    + `  uid=${u._id}`;

  console.log(`🔴 系統管理員（admin）：${admins.length} 人`);
  admins.forEach(u => console.log(fmt(u)));

  if (others.length) {
    console.log(`\n🟡 其他非 member 的 systemRole：${others.length} 人`);
    others.forEach(u => console.log(fmt(u)));
  }

  if (SHOW_ALL) {
    console.log(`\n— 全部帳號 —`);
    users.forEach(u => console.log(fmt(u)));
  } else {
    const memberCount = users.length - admins.length - others.length;
    console.log(`\n（其餘 ${memberCount} 人為一般 member；加 --all 可列出全部）`);
  }

  console.log('\n✅ 請人工核對上列 admin 名單是否與實際授權相符。');
  console.log('   若出現不該有的人：先於 Firebase 主控台把該帳號 systemRole 改回 member，再追查來源。\n');
})().catch(e => {
  console.error('\n❌ 稽核失敗：', e.message);
  process.exit(1);
});
