// ===== /users 規則測試（Firebase Security Rules projects.test API）=====
//
//   執行：node test-rules-users.mjs            （於 modules/森林監測App/tests/）
//
// 為什麼用這條路：本機沒有 Java，跑不了 Firestore emulator，
//   而 scripts/ 下的 owner-token 腳本走 REST 會「繞過」Security Rules，證明不了規則擋不擋得住。
//   Firebase 的 firebaserules projects.test API 是 Rules Playground 背後那支：把規則原始碼
//   連同模擬請求送上去、由 Google 端評估，回傳 ALLOW／DENY。不需 emulator、不寫入任何資料。
//
// 測的是 v2.11.96 修掉的自我提權漏洞：
//   修前 `/users/{uid}` 的 write 無欄位限制，任何登入者可把自己的 systemRole 改成 'admin'，
//   而 isSystemAdmin() 正是讀這份文件 → 自封系統管理員、取得跨專案 god view。
//
// 認證：沿用 `firebase login` 已 cache 的 OAuth refresh_token。401 請跑 firebase login --reauth。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 可用 --rules <path> 指向別的規則檔（例如拿修補前的舊規則回跑，確認這組測試真的抓得到漏洞）
const rulesArgIdx = process.argv.indexOf('--rules');
const RULES = rulesArgIdx > -1
  ? path.resolve(process.argv[rulesArgIdx + 1])
  : path.join(HERE, '..', 'pwa', 'firestore.rules');
const GCP_PROJECT = 'forestry-rs-monitor';
const DB = '/databases/(default)/documents';

const FBT_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FBT_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const UID_A = 'testUserA';      // 一般 member
const UID_B = 'testUserB';      // 另一位一般 member
const UID_ADMIN = 'testAdmin';  // 系統管理員
const NOW = '2026-09-02T00:00:00Z';

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

async function accessToken() {
  const p = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}，請先跑 firebase login`);
  const rt = JSON.parse(fs.readFileSync(p, 'utf8'))?.tokens?.refresh_token;
  if (!rt) throw new Error('configstore 內無 refresh_token，請先跑 firebase login');
  const body = new URLSearchParams({
    client_id: FBT_CLIENT_ID, client_secret: FBT_CLIENT_SECRET,
    refresh_token: rt, grant_type: 'refresh_token',
  }).toString();
  const r = await httpsRequest({
    method: 'POST', hostname: 'oauth2.googleapis.com', path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`OAuth refresh 失敗: ${j.error}`);
  return j.access_token;
}

// get(/users/{uid}) 一律以 mock 回應，讓測試不依賴線上實際資料（hermetic）
function mockUser(uid, data) {
  return {
    function: 'get',
    args: [{ exactValue: `${DB}/users/${uid}` }],
    result: { value: { data } },
  };
}
const MOCKS = [
  mockUser(UID_ADMIN, { email: 'admin@x.test', systemRole: 'admin' }),
  mockUser(UID_A, { email: 'a@x.test', displayName: 'A', systemRole: 'member' }),
  mockUser(UID_B, { email: 'b@x.test', displayName: 'B', systemRole: 'member' }),
];

const docA = { email: 'a@x.test', displayName: 'A', systemRole: 'member' };
const docB = { email: 'b@x.test', displayName: 'B', systemRole: 'member' };

function tc(name, expectation, { uid, method, target, before, after }) {
  const req = {
    auth: { uid, token: { email: `${uid}@x.test` } },
    method,
    path: `${DB}/users/${target}`,
    time: NOW,
  };
  if (after) req.resource = { data: after };
  const t = { expectation, request: req, functionMocks: MOCKS };
  if (before) t.resource = { data: before };
  return { name, testCase: t };
}

const CASES = [
  // ── 核心：自我提權必須被擋 ──
  tc('一般使用者把自己的 systemRole 改成 admin', 'DENY', {
    uid: UID_A, method: 'update', target: UID_A,
    before: docA, after: { ...docA, systemRole: 'admin' },
  }),
  tc('一般使用者夾帶 globalRole=admin（舊欄位後門）', 'DENY', {
    uid: UID_A, method: 'update', target: UID_A,
    before: docA, after: { ...docA, globalRole: 'admin' },
  }),
  tc('一般使用者首次建檔就自稱 admin', 'DENY', {
    uid: UID_A, method: 'create', target: UID_A,
    after: { email: 'a@x.test', displayName: 'A', systemRole: 'admin' },
  }),

  // ── 正常流程不可被誤擋 ──
  tc('首次登入自建帳號（systemRole=member）', 'ALLOW', {
    uid: UID_A, method: 'create', target: UID_A,
    after: { email: 'a@x.test', displayName: 'A', systemRole: 'member' },
  }),
  tc('本人修改自己的 displayName（角色不變）', 'ALLOW', {
    uid: UID_A, method: 'update', target: UID_A,
    before: docA, after: { ...docA, displayName: 'A 改過的名字' },
  }),
  tc('登入者可讀他人帳號（PI 以 email 查成員需要）', 'ALLOW', {
    uid: UID_A, method: 'get', target: UID_B, before: docB,
  }),

  // ── 改別人、刪除 ──
  tc('一般使用者改別人的帳號文件', 'DENY', {
    uid: UID_A, method: 'update', target: UID_B,
    before: docB, after: { ...docB, displayName: '被亂改' },
  }),
  tc('一般使用者把別人升成 admin', 'DENY', {
    uid: UID_A, method: 'update', target: UID_B,
    before: docB, after: { ...docB, systemRole: 'admin' },
  }),
  tc('一般使用者刪除自己的帳號文件', 'DENY', {
    uid: UID_A, method: 'delete', target: UID_A, before: docA,
  }),

  // ── 系統管理員仍可管理角色 ──
  tc('系統管理員把他人升成 admin', 'ALLOW', {
    uid: UID_ADMIN, method: 'update', target: UID_B,
    before: docB, after: { ...docB, systemRole: 'admin' },
  }),
  tc('系統管理員刪除帳號文件', 'ALLOW', {
    uid: UID_ADMIN, method: 'delete', target: UID_B, before: docB,
  }),

  // ── 未登入 ──
  tc('未登入者讀取帳號', 'DENY', {
    uid: null, method: 'get', target: UID_A, before: docA,
  }),
];

(async () => {
  console.log(`\n🔐 /users 規則測試（Security Rules projects.test API）`);
  console.log(`   規則檔：${path.relative(process.cwd(), RULES)}\n`);
  const token = await accessToken();
  const source = { files: [{ name: 'firestore.rules', content: fs.readFileSync(RULES, 'utf8') }] };

  // 未登入案例的 auth 需為 null
  const testCases = CASES.map(c => {
    const t = JSON.parse(JSON.stringify(c.testCase));
    if (t.request.auth?.uid == null) delete t.request.auth;
    return t;
  });

  const r = await httpsRequest({
    method: 'POST',
    hostname: 'firebaserules.googleapis.com',
    path: `/v1/projects/${GCP_PROJECT}:test`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, JSON.stringify({ source, testSuite: { testCases } }));

  const j = JSON.parse(r.body);
  if (j.error) {
    console.error('❌ API 錯誤：', JSON.stringify(j.error, null, 2));
    process.exit(1);
  }
  if (j.issues?.length) {
    console.error('❌ 規則編譯問題：');
    for (const i of j.issues) console.error(`   ${i.severity} ${i.sourcePosition?.line}: ${i.description}`);
    process.exit(1);
  }

  const results = j.testResults || [];
  let pass = 0, fail = 0;
  results.forEach((res, i) => {
    const c = CASES[i];
    const want = c.testCase.expectation;
    const ok = res.state === 'SUCCESS';
    if (ok) { pass++; console.log(`   ✅ [${want}] ${c.name}`); }
    else {
      fail++;
      console.log(`   ❌ [預期 ${want}] ${c.name}`);
      for (const e of (res.errorPosition ? [res.errorPosition] : [])) {
        console.log(`      規則第 ${e.line} 行`);
      }
      if (res.debugMessages?.length) console.log('      ' + res.debugMessages.join('\n      '));
    }
  });

  console.log(`\n===== 通過 ${pass} / 失敗 ${fail} =====\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('\n❌ 測試執行失敗：', e.message);
  process.exit(1);
});
