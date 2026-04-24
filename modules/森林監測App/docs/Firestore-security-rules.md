# Firestore Security Rules

> v1 MVP 規則。**白名單原則**：預設拒絕，明列允許。

---

## 壹、原則

1. 未登入：全部拒絕
2. 登入後：依 `members[uid]` 取角色（pi / surveyor / reviewer）
3. 調查員：只能讀寫**自己 createdBy** 的樣區與其子集合
4. 主持人：讀寫該專案全部
5. 審查委員：只讀
6. lookups（樹種字典）：所有登入者可讀，僅 admin 可寫

---

## 貳、規則檔（部署用，存 `pwa/firestore.rules`）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ===== Helpers =====
    function isSignedIn() {
      return request.auth != null;
    }
    function userRole(projectId) {
      return get(/databases/$(database)/documents/projects/$(projectId)).data.members[request.auth.uid];
    }
    function isPi(projectId)       { return userRole(projectId) == 'pi'; }
    function isSurveyor(projectId) { return userRole(projectId) == 'surveyor'; }
    function isReviewer(projectId) { return userRole(projectId) == 'reviewer'; }
    function isMember(projectId)   { return userRole(projectId) != null; }
    function isOwner()             { return resource.data.createdBy == request.auth.uid; }
    function willOwn()             { return request.resource.data.createdBy == request.auth.uid; }

    // ===== Users =====
    match /users/{uid} {
      allow read:  if isSignedIn() && request.auth.uid == uid;
      allow write: if isSignedIn() && request.auth.uid == uid;
    }

    // ===== Projects =====
    match /projects/{projectId} {
      // 任何專案成員可讀
      allow read:   if isSignedIn() && isMember(projectId);
      // 只有 pi 可改
      allow update: if isSignedIn() && isPi(projectId);
      // 建專案：登入者皆可（自動把自己設為 pi 由前端負責）
      allow create: if isSignedIn() && request.resource.data.members[request.auth.uid] == 'pi';
      allow delete: if false;  // v1 不允許刪專案

      // ===== Plots =====
      match /plots/{plotId} {
        // pi/reviewer 看全部；surveyor 只看自己的
        allow read: if isSignedIn() && (
          isPi(projectId) ||
          isReviewer(projectId) ||
          (isSurveyor(projectId) && isOwner())
        );
        // surveyor/pi 可建（必須把 createdBy 設為自己）
        allow create: if isSignedIn() &&
          (isSurveyor(projectId) || isPi(projectId)) &&
          willOwn();
        // surveyor 只能改自己的；pi 可改全部
        allow update: if isSignedIn() && (
          isPi(projectId) ||
          (isSurveyor(projectId) && isOwner())
        );
        // 只有 pi 可刪
        allow delete: if isSignedIn() && isPi(projectId);

        // ===== Trees / Regeneration =====
        match /{subColl}/{docId} where subColl in ['trees', 'regeneration'] {
          // 跟所屬 plot 同權限
          allow read: if isSignedIn() && (
            isPi(projectId) ||
            isReviewer(projectId) ||
            (isSurveyor(projectId) &&
             get(/databases/$(database)/documents/projects/$(projectId)/plots/$(plotId)).data.createdBy == request.auth.uid)
          );
          allow create: if isSignedIn() &&
            (isSurveyor(projectId) || isPi(projectId)) &&
            willOwn();
          allow update: if isSignedIn() && (
            isPi(projectId) ||
            (isSurveyor(projectId) && isOwner())
          );
          allow delete: if isSignedIn() && (
            isPi(projectId) ||
            (isSurveyor(projectId) && isOwner())
          );
        }
      }
    }

    // ===== Lookups（樹種字典）=====
    match /lookups/{collection}/{docId} {
      allow read:  if isSignedIn();
      // 寫入由 Firebase Console 後台或 admin SDK 操作（不開前端）
      allow write: if false;
    }
  }
}
```

---

## 參、Storage Rules（照片）

存 `pwa/storage.rules`：

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // 路徑慣例：/projects/{pid}/plots/{plotid}/{filename}
    match /projects/{projectId}/plots/{plotId}/{filename} {
      allow read: if request.auth != null;  // 簡化版：登入即可讀
      allow write: if request.auth != null
        && request.resource.size < 5 * 1024 * 1024  // 單檔 5MB 上限
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

> v2 強化：寫入時驗證使用者是該 plot 的 owner 或 pi。

---

## 肆、部署指令

```bash
# 一次性安裝
npm install -g firebase-tools
firebase login
firebase init  # 選 Firestore + Storage + Hosting

# 部署規則
firebase deploy --only firestore:rules,storage:rules
```

---

## 伍、測試矩陣（v1 必過）

| 角色 | 動作 | 預期 |
|------|------|------|
| 未登入 | 讀任何資料 | ❌ 拒絕 |
| 調查員 A | 建自己的 plot | ✅ 通過 |
| 調查員 A | 讀自己的 plot | ✅ 通過 |
| 調查員 A | 讀調查員 B 的 plot | ❌ 拒絕 |
| 調查員 A | 改自己的 plot | ✅ 通過 |
| 主持人 | 讀全部 plot | ✅ 通過 |
| 主持人 | 改任何 plot | ✅ 通過 |
| 主持人 | 刪 plot | ✅ 通過 |
| 審查委員 | 讀全部 plot | ✅ 通過 |
| 審查委員 | 寫任何資料 | ❌ 拒絕 |
| 任何登入者 | 寫 lookups | ❌ 拒絕 |

> 建議用 Firebase Emulator + `@firebase/rules-unit-testing` 跑自動化測試，存 `pwa/__tests__/rules.test.js`（v1.5 加）。
