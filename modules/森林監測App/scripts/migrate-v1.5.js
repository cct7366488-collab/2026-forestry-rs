// migrate-v1.5.js — 把 v1.0 既有資料補齊 v1.5 必要欄位
// 用法：
//   1. 從 Firebase Console → 專案設定 → 服務帳戶 → 產生新私密金鑰 → 存成 ./serviceAccountKey.json
//   2. cd 到本資料夾，跑：npm install firebase-admin
//   3. 跑：node migrate-v1.5.js
//
// 本腳本會：
//   - /users/{uid} 補 systemRole='member'（若沒設）；email=cct7366488@gmail.com 設為 'admin'
//   - /projects/{pid} 補 memberUids、pi、methodology、locked
//   - 所有 plots / trees / regeneration 補 qaStatus='pending'

const admin = require('firebase-admin');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const ADMIN_EMAIL = 'cct7366488@gmail.com';  // 改成你的 admin email

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH))
});
const db = admin.firestore();

const DEFAULT_METHODOLOGY = {
  targetPlotCount: 50,
  plotShape: 'circle',
  plotAreaOptions: [400, 500, 1000],
  required: { photos: false, branchHeight: false, pestSymptoms: false },
  modules: { plot: true, tree: true, regeneration: true, understory: false, soil: false, disturbance: false },
  description: '（從 v1.0 自動套用預設方法學，PI 可在「設計」分頁修改）'
};

async function migrateUsers() {
  console.log('\n=== Migrate /users ===');
  const snap = await db.collection('users').get();
  for (const d of snap.docs) {
    const data = d.data();
    const updates = {};
    if (!data.systemRole) {
      updates.systemRole = data.email === ADMIN_EMAIL ? 'admin' : 'member';
    }
    if (Object.keys(updates).length > 0) {
      await d.ref.update(updates);
      console.log(`  ✓ ${data.email}: ${JSON.stringify(updates)}`);
    } else {
      console.log(`  - ${data.email}: skip (already migrated)`);
    }
  }
}

async function migrateProjects() {
  console.log('\n=== Migrate /projects ===');
  const snap = await db.collection('projects').get();
  for (const d of snap.docs) {
    const data = d.data();
    const updates = {};

    // memberUids 從 members 取
    if (!data.memberUids && data.members) {
      updates.memberUids = Object.keys(data.members);
    }
    // pi：取 members 中第一個 role=='pi' 的 uid
    if (!data.pi && data.members) {
      const piUid = Object.entries(data.members).find(([uid, r]) => r === 'pi')?.[0];
      if (piUid) updates.pi = piUid;
    }
    if (!data.methodology) updates.methodology = DEFAULT_METHODOLOGY;
    if (data.locked === undefined) updates.locked = false;

    if (Object.keys(updates).length > 0) {
      await d.ref.update(updates);
      console.log(`  ✓ ${data.name} (${d.id}): added ${Object.keys(updates).join(', ')}`);
    } else {
      console.log(`  - ${data.name}: skip (already migrated)`);
    }

    // 補子集合的 qaStatus
    await migrateSubcollection(d.ref, 'plots');
  }
}

async function migrateSubcollection(parentRef, subName) {
  const subSnap = await parentRef.collection(subName).get();
  let count = 0;
  for (const sd of subSnap.docs) {
    const sdata = sd.data();
    if (!sdata.qaStatus) {
      await sd.ref.update({ qaStatus: 'pending' });
      count++;
    }
    // plots 下還有 trees / regeneration
    if (subName === 'plots') {
      await migrateSubcollection(sd.ref, 'trees');
      await migrateSubcollection(sd.ref, 'regeneration');
    }
  }
  if (count > 0) {
    console.log(`    ↳ ${parentRef.path}/${subName}: ${count} docs added qaStatus='pending'`);
  }
}

(async () => {
  try {
    await migrateUsers();
    await migrateProjects();
    console.log('\n✅ Migration complete!');
    console.log('現在可以部署 v1.5：firebase deploy --only firestore:rules,hosting');
  } catch (e) {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  }
})();
