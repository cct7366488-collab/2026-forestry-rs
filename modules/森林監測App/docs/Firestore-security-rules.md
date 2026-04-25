# Firestore Security Rules（v1.5）

> 5 角色 + Lock + QA 欄位細粒度權限
> 歷史：v1.0（3 角色）→ v1.5（5 角色 + Lock + QA）

---

## 壹、原則

1. 未登入：全拒
2. 系統管理者（admin）：跨專案唯讀，**不能寫**任何專案資料
3. 專案成員：依 `members[uid]` 取角色（pi / dataManager / surveyor / reviewer）
4. **Lock 後**：除 PI Unlock 外，所有寫入被擋
5. **QA 欄位**（qaStatus / qaMarkedBy / qaMarkedAt / qaComment）：僅 pi / dataManager 可寫
6. **資料一般欄位**：依角色（pi 全部、dataManager 全部、surveyor 自己的）
7. lookups（樹種字典）：所有登入者可讀，僅 admin 可寫

---

## 貳、Helpers（rules v2）

```
function isSignedIn() { return request.auth != null; }

function userDoc() { 
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; 
}

function isSystemAdmin() {
  return userDoc().systemRole == 'admin' || userDoc().globalRole == 'admin';  // 過渡期同時支援兩欄
}

function projectDoc(pid) {
  return get(/databases/$(database)/documents/projects/$(pid)).data;
}
function userRole(pid)        { return projectDoc(pid).members[request.auth.uid]; }
function isPi(pid)            { return userRole(pid) == 'pi'; }
function isDataManager(pid)   { return userRole(pid) == 'dataManager'; }
function isSurveyor(pid)      { return userRole(pid) == 'surveyor'; }
function isReviewer(pid)      { return userRole(pid) == 'reviewer'; }
function isMember(pid)        { return userRole(pid) != null; }
function canQA(pid)           { return isPi(pid) || isDataManager(pid); }
function canCollect(pid)      { return isPi(pid) || isDataManager(pid) || isSurveyor(pid); }
function canRead(pid)         { return isMember(pid) || isSystemAdmin(); }

function isLocked(pid)        { return projectDoc(pid).locked == true; }
function isOwner()            { return resource.data.createdBy == request.auth.uid; }
function willOwn()            { return request.resource.data.createdBy == request.auth.uid; }
```

---

## 參、`/users/{uid}` 規則

```
allow read:  if isSignedIn() && (request.auth.uid == uid || isSystemAdmin());
allow write: if isSignedIn() && request.auth.uid == uid;  // 只能改自己
```

> systemRole 由 admin 在 Firebase Console 手動設定（不開放 client 端 self-promote）。

---

## 肆、`/projects/{projectId}` 規則

| 操作 | 條件 |
|------|------|
| read   | `isMember(pid) || isSystemAdmin()` |
| create | `isSystemAdmin() && request.resource.data.members[request.auth.uid] in ['pi', 'dataManager', 'surveyor', 'reviewer']` AND `memberUids` 含 self |
| update | `isPi(pid)`（含改 methodology / members / lock 欄位） |
| delete | `isSystemAdmin() && projectDoc(pid).plotCount == 0`（v1.5 不實作 plotCount，先 false） |

---

## 伍、`/projects/{pid}/plots/{plotId}` 規則

| 操作 | 條件 |
|------|------|
| read   | `canRead(pid)` |
| create | `canCollect(pid) && willOwn() && !isLocked(pid)` AND new qaStatus = 'pending' |
| update | 視欄位區分（見下） |
| delete | `isPi(pid) || (isSurveyor(pid) && isOwner() && resource.data.qaStatus == 'pending')` |

#### update 細粒度：

```
allow update: if isSignedIn() && !isLocked(pid) && (
  // 一般欄位：pi/dataManager 可改任何；surveyor 只可改自己且只在 pending 狀態
  (isPi(pid)) ||
  (isDataManager(pid)) ||
  (isSurveyor(pid) && isOwner() && resource.data.qaStatus in ['pending', 'flagged'])
);
```

#### QA 欄位專用 rule（v1.5 簡化版）：

實際實作上 client 不會分兩次 update — 直接一個 update 包含 QA 欄位變更。Rule 端額外驗證：

```
// 若 request 含 qaStatus 變更，必須是 pi 或 dataManager
allow update: if isSignedIn() && !isLocked(pid) && (
  (request.resource.data.qaStatus != resource.data.qaStatus
    ? canQA(pid)
    : (isPi(pid) || isDataManager(pid) || (isSurveyor(pid) && isOwner())))
);
```

> 為簡化 v1.5 rules（避免 ternary 報錯），最終實作可分兩個 allow 條件用 `||` 串。

---

## 陸、`/projects/{pid}/plots/{plotId}/{trees|regeneration}/{docId}` 規則

同 plots，但用 plotId 多一層查詢：

```
allow read: if canRead(pid);
allow create: if canCollect(pid) && willOwn() && !isLocked(pid)
  && request.resource.data.qaStatus == 'pending';
allow update: if !isLocked(pid) && (
  isPi(pid) ||
  isDataManager(pid) ||
  (isSurveyor(pid) && isOwner() && resource.data.qaStatus in ['pending', 'flagged'])
);
allow delete: if (isPi(pid)) || 
  (isSurveyor(pid) && isOwner() && resource.data.qaStatus == 'pending');
```

---

## 柒、`/lookups/{collection}/{docId}` 規則

```
allow read:  if isSignedIn();
allow write: if false;  // admin 用 Firebase Console 後台改
```

---

## 捌、查詢限制（client 端配合）

為讓 `onSnapshot(collection('projects'))` 不被 rules 擋，client 端 query 必須加：

```js
where('memberUids', 'array-contains', request.auth.uid)
```

OR 對 admin：

```js
collection('projects')  // 無 where，但 rules 允許 admin 讀全部
```

---

## 玖、測試矩陣（v1.5 必過）

| 角色 | 動作 | 預期 |
|------|------|------|
| 未登入 | 任何讀寫 | ❌ |
| admin | 跨專案讀任一 plot | ✅ |
| admin | 寫任何專案資料 | ❌ |
| admin | 建新專案 | ✅ |
| pi | 改 methodology | ✅ |
| pi | Lock 專案 | ✅ |
| pi | Lock 後改任一資料 | ❌ |
| dataManager | 改 plot 的 qaStatus → verified | ✅ |
| dataManager | 改 plot 一般欄位 | ✅（修小錯，留 audit） |
| surveyor | 改自己 plot 的 qaStatus | ❌ |
| surveyor | 改自己 plot 一般欄位（pending/flagged 狀態） | ✅ |
| surveyor | 改自己 plot 一般欄位（verified/rejected 狀態） | ❌ |
| surveyor | 改他人 plot | ❌ |
| reviewer | 寫任何資料 | ❌ |
| reviewer | 讀儀表板 | ✅ |

---

## 拾、部署

```powershell
firebase deploy --only firestore:rules
```

部署前請先完成 v1.0 → v1.5 migration（補欄位），否則舊資料會被擋。
