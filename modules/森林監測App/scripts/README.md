# scripts/

## migrate-v1.5.js

把 v1.0 既有資料補齊 v1.5 schema 必要欄位（memberUids、methodology、locked、qaStatus 等）。

### 跑前準備

#### 一、產生 Firebase 服務帳戶金鑰

1. 開 https://console.firebase.google.com/project/forestry-rs-monitor/settings/serviceaccounts/adminsdk
2. 確認語言/SDK 選 **Node.js**
3. 點 **「產生新的私密金鑰」**（Generate new private key）
4. 下載一個 JSON 檔（例：`forestry-rs-monitor-firebase-adminsdk-xxxxx.json`）
5. **改名為 `serviceAccountKey.json`** 並放到本資料夾

⚠️ **`serviceAccountKey.json` 不要 commit**（已在 `.gitignore` 排除）— 這檔有 admin 權限可繞過所有 Security Rules。

#### 二、安裝 firebase-admin SDK

```powershell
cd "H:\我的雲端硬碟\2026 forestry_RS\modules\森林監測App\scripts"
npm init -y
npm install firebase-admin
```

#### 三、確認 admin email

打開 `migrate-v1.5.js`，第 8 行：
```js
const ADMIN_EMAIL = 'cct7366488@gmail.com';
```
若不是這個帳號，改成你的。

### 執行

```powershell
node migrate-v1.5.js
```

### 預期輸出

```
=== Migrate /users ===
  ✓ cct7366488@gmail.com: {"systemRole":"admin"}
  ✓ otheruser@xxx.com: {"systemRole":"member"}

=== Migrate /projects ===
  ✓ 示範林班 (CeVBdsfTgIRMjF9WRPQf): added memberUids, pi, methodology, locked
    ↳ projects/CeVBdsfTgIRMjF9WRPQf/plots: 4 docs added qaStatus='pending'
    ↳ projects/CeVBdsfTgIRMjF9WRPQf/plots/xxx/trees: 8 docs added qaStatus='pending'
    ↳ projects/CeVBdsfTgIRMjF9WRPQf/plots/xxx/regeneration: 5 docs added qaStatus='pending'
  ✓ 大雪山林業合作社 (xxx): added memberUids, pi, methodology, locked

✅ Migration complete!
現在可以部署 v1.5：firebase deploy --only firestore:rules,hosting
```

### 跑完之後

回上層 pwa 目錄部署：

```powershell
cd ..\pwa
firebase deploy --only firestore:rules,hosting
```

### 安全提醒

- **跑完之後就把 `serviceAccountKey.json` 刪掉**（避免外洩）
- 之後若要再跑 migration，重新生新 key 即可
