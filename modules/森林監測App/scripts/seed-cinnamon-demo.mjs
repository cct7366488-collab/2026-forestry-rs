// seed-cinnamon-demo.mjs — 為 5/20 說明會在「土肉桂專區葉片收穫監測、會計系統」種入 demo 採收許可案
//
// 用法：
//   node seed-cinnamon-demo.mjs                  # 種入 / 覆寫 demo 案（idempotent，固定 doc id）
//   node seed-cinnamon-demo.mjs --clean --dry-run  # 預覽：列出將被刪除的 demo 案＋logs，不寫入
//   node seed-cinnamon-demo.mjs --clean          # 實際清除所有 demo-* 案與其 logs（5/20 說明會後用）
//
// 清除範圍（精確且安全）：
//   - 僅刪 projects/<土肉桂專區>/harvestPermits/demo-* 與其 logs 子集合
//   - 刪前先驗證目標專案名稱含「土肉桂專區葉片收穫」，不符即中止
//   - 不動 users/<PI>.systemRole（簡報帳號 admin 保留，避免把專案擁有者鎖在門外）
//   - idempotent：重跑找不到 demo-* 即 no-op
//   - 建議先 --clean --dry-run 看清單，確認後再 --clean 真刪
//
// 認證：沿用 firebase login 的 OAuth refresh_token（同 diagnose-project.mjs），走 Firestore REST。
//   owner token 繞過 client security rules → 可直接寫；故 createdBy 用真實 PI uid，避免孤兒。
//
// 安全設計：
//   - 固定 doc id（demo-01..demo-10 / 其 logs log-1..）→ 重跑覆寫、不重複、可清除
//   - 每筆帶 demoSeed:true、note 前綴「【DEMO】」→ 一眼可辨、--clean 可全清
//   - 已核准案文號用保留區「林保中-土肉桂採葉-115-9xx」→ 不碰真實 counters，
//     現場 live 核准未種子案仍從 001 起，可同時演示真實文號生成
//   - 同時確保簡報帳號 systemRole=admin（一個登入即可演示申請/審核/彙整三分頁）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const GCP_PROJECT = 'forestry-rs-monitor';
const TARGET_PROJECT_ID = 'yNpFW7BlLHSKsQ1P4N2F';            // 土肉桂專區葉片收穫監測、會計系統
const TARGET_NAME_HINT = '土肉桂專區葉片收穫';
const PI_UID = 'VNRjlGVXktNsRPGp8nmhS3RpPk42';               // cct7366488@gmail.com / 陳朝圳
const CLEAN = process.argv.includes('--clean');
const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');

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

function rest(token, method, urlPath, payload) {
  return httpsRequest({
    method, hostname: 'firestore.googleapis.com', path: urlPath,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }, payload ? JSON.stringify(payload) : null).then(r => {
    const j = r.body ? JSON.parse(r.body) : {};
    if (j.error) throw new Error(`Firestore ${j.error.code || r.statusCode}: ${j.error.message}`);
    return j;
  });
}

// JS → Firestore typed value
function tv(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(tv) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = tv(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = tv(v);
  return fields;
}
async function commit(token, writes) {
  // 分批（保險，雖 Firestore 上限 500）
  for (let i = 0; i < writes.length; i += 100) {
    await rest(token, 'POST', `${BASE}:commit`, { writes: writes.slice(i, i + 100) });
  }
}
const docPath = (rel) => `${DOC_PREFIX}/${rel}`;
const upd = (rel, obj) => ({ update: { name: docPath(rel), fields: toFields(obj) } });
const del = (rel) => ({ delete: docPath(rel) });

// ---------- demo 資料 ----------
const D = (daysAgo) => new Date(Date.now() - daysAgo * 86400000);
const HP = `projects/${TARGET_PROJECT_ID}/harvestPermits`;

// 每案：id, status, applicantName, uses, est, approved?, permitSeq?(→9xx), reviewComment?, logs[]
const CASES = [
  { id: 'demo-01', status: 'submitted', applicantName: '林大山', contact: '0912-345-678', land: '大甲溪事業區 12 林班 3 小班', area: 0.8, trees: 320, uses: '精油萃取', est: 60, from: '2026-06-01', to: '2026-08-31' },
  { id: 'demo-02', status: 'submitted', applicantName: '陳阿土', contact: '0922-111-222', land: '大甲溪事業區 12 林班 5 小班', area: 0.5, trees: 180, uses: '乾燥食用', est: 45, from: '2026-06-15', to: '2026-09-15' },
  { id: 'demo-03', status: 'revision', applicantName: '王美桂', contact: '0933-444-555', land: '大甲溪事業區 13 林班 2 小班', area: 1.2, trees: 460, uses: '兩者皆有', est: 80, from: '2026-06-01', to: '2026-10-31',
    reviewComment: '林地地號需檢附土地登記謄本影本，請補正後重新送出。' },
  { id: 'demo-04', status: 'rejected', applicantName: '李文清', contact: '0955-666-777', land: '大甲溪事業區 14 林班 1 小班', area: 2.0, trees: 700, uses: '精油萃取', est: 120, from: '2026-06-01', to: '2026-12-31',
    reviewComment: '申請採收面積與現地勘查不符，且部分區域逾越土肉桂專區範圍，本案駁回。' },
  { id: 'demo-05', status: 'approved', applicantName: '張春生', contact: '0911-000-111', land: '大甲溪事業區 12 林班 8 小班', area: 0.6, trees: 240, uses: '精油萃取', est: 50, approved: 50, permitSeq: 901, from: '2026-06-01', to: '2026-09-30' },
  { id: 'demo-06', status: 'approved', applicantName: '黃秋蘭', contact: '0966-222-333', land: '大甲溪事業區 13 林班 6 小班', area: 0.9, trees: 350, uses: '乾燥食用', est: 70, approved: 60, permitSeq: 902, from: '2026-06-10', to: '2026-10-10' },
  { id: 'demo-07', status: 'harvesting', applicantName: '林大山', contact: '0912-345-678', land: '大甲溪事業區 12 林班 3 小班', area: 0.8, trees: 320, uses: '精油萃取', est: 60, approved: 60, permitSeq: 903, from: '2026-05-01', to: '2026-08-31',
    logs: [{ d: '2026-05-08', fresh: 20, dry: 8, moist: 60, batch: 'A-01' }, { d: '2026-05-13', fresh: 25, dry: 10, moist: 58, batch: 'A-02' }] },
  { id: 'demo-08', status: 'harvesting', applicantName: '吳國雄', contact: '0977-888-999', land: '大甲溪事業區 14 林班 4 小班', area: 1.5, trees: 560, uses: '兩者皆有', est: 100, approved: 80, permitSeq: 904, from: '2026-05-01', to: '2026-09-30',
    logs: [{ d: '2026-05-05', fresh: 30, dry: 12, moist: 60, batch: 'B-01' }, { d: '2026-05-10', fresh: 30, dry: 12, moist: 59, batch: 'B-02' }, { d: '2026-05-14', fresh: 25, dry: 10, moist: 61, batch: 'B-03' }] },
  { id: 'demo-09', status: 'completed', applicantName: '王美桂', contact: '0933-444-555', land: '大甲溪事業區 13 林班 2 小班', area: 1.2, trees: 460, uses: '乾燥食用', est: 40, approved: 40, permitSeq: 905, from: '2026-04-01', to: '2026-05-10',
    logs: [{ d: '2026-04-20', fresh: 18, dry: 7, moist: 60, batch: 'C-01' }, { d: '2026-05-02', fresh: 20, dry: 8, moist: 58, batch: 'C-02' }], completed: true },
  { id: 'demo-10', status: 'draft', applicantName: '陳阿土', contact: '0922-111-222', land: '大甲溪事業區 12 林班 5 小班', area: 0.5, trees: 180, uses: '精油萃取', est: 30, from: '2026-07-01', to: '2026-09-30' }
];

function buildPermitNo(seq) { return `林保中-土肉桂採葉-115-${String(seq).padStart(3, '0')}`; }

(async () => {
  console.log(`\n🌿 土肉桂專區 demo 種子（GCP=${GCP_PROJECT}, project=${TARGET_PROJECT_ID}）`);
  const token = await getToken();

  // 驗證目標專案存在且名稱相符
  const proj = await rest(token, 'GET', `${BASE}/projects/${TARGET_PROJECT_ID}`);
  const pname = proj.fields?.name?.stringValue || '';
  if (!pname.includes(TARGET_NAME_HINT)) throw new Error(`專案名稱不符：「${pname}」（預期含「${TARGET_NAME_HINT}」），中止以策安全`);
  console.log(`   目標專案：${pname}`);

  // 收集既有 demo doc id（供 --clean / 重跑前清 logs）
  let existing = [];
  try {
    const lst = await rest(token, 'GET', `${BASE}/${HP}?pageSize=300`);
    existing = (lst.documents || []).map(d => d.name.split('/').pop()).filter(id => id.startsWith('demo-'));
  } catch { /* collection 不存在 = 空 */ }

  if (CLEAN) {
    const writes = [];
    let logTotal = 0;
    for (const id of existing) {
      // 刪 logs（已知 batch 命名 log-1..；保險起見列舉子集合）
      let logIds = [];
      try {
        const ls = await rest(token, 'GET', `${BASE}/${HP}/${id}/logs?pageSize=300`);
        logIds = (ls.documents || []).map(l => l.name.split('/').pop());
      } catch {}
      for (const lid of logIds) writes.push(del(`${HP}/${id}/logs/${lid}`));
      writes.push(del(`${HP}/${id}`));
      logTotal += logIds.length;
      console.log(`   ${DRY ? '[預覽] 將刪' : '刪除'} ${HP}/${id}` + (logIds.length ? `（含 logs：${logIds.join(', ')}）` : ''));
    }
    if (!existing.length) {
      console.log(`\n✅ 無 demo-* 案可清（已乾淨 / idempotent no-op）。`);
      return;
    }
    if (DRY) {
      console.log(`\n🔍 [DRY-RUN] 將刪除 ${existing.length} 個 demo 案 ＋ ${logTotal} 筆 logs，未寫入。`);
      console.log(`   確認無誤後實際清除：node seed-cinnamon-demo.mjs --clean`);
      console.log(`   範圍僅限 projects/${TARGET_PROJECT_ID}/harvestPermits/demo-*；不動 systemRole / 其他資料。`);
      return;
    }
    await commit(token, writes);
    console.log(`\n🧹 已清除 ${existing.length} 個 demo 案（含 ${logTotal} 筆收穫紀錄）。`);
    console.log(`   未變動：簡報帳號 systemRole（仍為 admin）、真實文號 counters、其他專案資料。`);
    console.log(`   如需重建 demo：node seed-cinnamon-demo.mjs\n`);
    return;
  }

  // 先清掉既有 demo 案的 logs（避免重跑殘留舊 logs）
  const pre = [];
  for (const id of existing) {
    try {
      const ls = await rest(token, 'GET', `${BASE}/${HP}/${id}/logs?pageSize=300`);
      for (const l of (ls.documents || [])) pre.push(del(`${HP}/${id}/logs/${l.name.split('/').pop()}`));
    } catch {}
  }
  if (pre.length) await commit(token, pre);

  // 種入
  const writes = [];
  let approvedN = 0, harvestingN = 0, completedN = 0, logN = 0;
  for (const c of CASES) {
    const base = {
      demoSeed: true,
      applicantUid: PI_UID,
      createdBy: PI_UID,
      applicantName: c.applicantName,
      contact: c.contact,
      landParcel: c.land,
      forestArea_ha: c.area,
      estTrees: c.trees,
      harvestMethod: '修枝採葉',
      estAmount_kg: c.est,
      periodFrom: c.from,
      periodTo: c.to,
      uses: c.uses,
      note: '【DEMO】5/20 說明會種子資料',
      status: c.status,
      createdAt: D(20),
      updatedAt: D(1)
    };
    if (['submitted', 'revision', 'rejected', 'approved', 'harvesting', 'completed'].includes(c.status)) {
      base.submittedAt = D(15);
    }
    if (['revision', 'rejected', 'approved', 'harvesting', 'completed'].includes(c.status)) {
      base.reviewedBy = PI_UID;
      base.reviewedAt = D(10);
      base.reviewComment = c.reviewComment || (c.status === 'approved' || c.status === 'harvesting' || c.status === 'completed' ? '經審查符合規定，准予採取。' : '');
    }
    if (['approved', 'harvesting', 'completed'].includes(c.status)) {
      base.approvedAmount_kg = c.approved;
      base.permitNo = buildPermitNo(c.permitSeq);
      base.permitSeq = c.permitSeq;
      base.validFrom = c.from;
      base.validUntil = c.to;
      approvedN++;
    }
    if (c.logs && c.logs.length) {
      let total = 0;
      c.logs.forEach((g, i) => {
        total += g.fresh;
        writes.push(upd(`${HP}/${c.id}/logs/log-${i + 1}`, {
          logDate: g.d, amount_kg_fresh: g.fresh, amount_kg_dry: g.dry,
          moisture_pct: g.moist, batch: g.batch, note: '【DEMO】',
          createdBy: PI_UID, loggedBy: PI_UID, loggedAt: D(8 - i), createdAt: D(8 - i)
        }));
        logN++;
      });
      base.totalLogged_kg = Math.round(total * 100) / 100;
      base.harvestingStartedAt = D(9);
      if (c.status === 'harvesting') harvestingN++;
    }
    if (c.status === 'completed') { base.completedAt = D(3); completedN++; }
    writes.push(upd(`${HP}/${c.id}`, base));
  }
  await commit(token, writes);

  // 確保簡報帳號 systemRole=admin（一個登入演示三分頁）
  let adminMsg = '';
  try {
    const u = await rest(token, 'GET', `${BASE}/users/${PI_UID}`);
    const sr = u.fields?.systemRole?.stringValue || null;
    if (sr === 'admin') {
      adminMsg = `簡報帳號 systemRole 已是 admin（${u.fields?.email?.stringValue || ''}）`;
    } else {
      await rest(token, 'PATCH',
        `${BASE}/users/${PI_UID}?updateMask.fieldPaths=systemRole`,
        { fields: { systemRole: { stringValue: 'admin' } } });
      adminMsg = `已設 簡報帳號 systemRole=admin（原為 ${sr || '(無)'}）→ 一個登入可見申請/審核/彙整三分頁`;
    }
  } catch (e) {
    adminMsg = `⚠ 無法檢查/設定 systemRole：${e.message}（可手動於 /users/${PI_UID} 設 systemRole=admin）`;
  }

  console.log(`\n✅ 種子完成：`);
  console.log(`   案件 ${CASES.length} 筆（submitted 2 / revision 1 / rejected 1 / approved 2 / harvesting 2 / completed 1 / draft 1）`);
  console.log(`   已核准/採收/結案文號：${approvedN} 個（保留區 115-901..905）；收穫紀錄 ${logN} 筆`);
  console.log(`   合作社可見已實現可售鮮葉合計：demo-07(45) + demo-08(85) + demo-09(38) = 168 kg`);
  console.log(`   ${adminMsg}`);
  console.log(`\n   清除指令：node seed-cinnamon-demo.mjs --clean\n`);
})().catch(e => {
  console.error(`\n❌ 失敗：${e.message}`);
  if (/401|UNAUTHENT|refresh/i.test(e.message)) console.error('   → 請跑：firebase login --reauth');
  process.exit(1);
});
