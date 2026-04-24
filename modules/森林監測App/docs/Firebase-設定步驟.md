# Firebase 設定步驟（你必須先跑完才能讓 App 動起來）

> 這是**手動操作清單**，跟著做一次（10–15 分鐘）。完成後 App 就能本機跑起來。

---

## 壹、建立 Firebase 專案（5 分鐘）

### 一、開 Firebase Console
- 連到 https://console.firebase.google.com
- 用你的 Google 帳號登入（建議用 `cct7366488-collab` 對應的帳號，跟 GitHub/GDrive 一致）

### 二、新增專案
- 點「新增專案」
- 專案名稱：`forestry-rs-monitor`（或你想用的名字）
- 是否啟用 Google Analytics：**否**（v1 不需要）
- 等專案建好（約 30 秒）

### 三、加入 Web App
- 在專案首頁點 `</>`（Web 平台）圖示
- 應用程式暱稱：`Forest Monitor PWA`
- ✅ 勾選「同時為這個應用程式設定 Firebase Hosting」
- 註冊應用程式 → 會跳出 SDK 設定碼，**先複製起來**（後面要貼到 `firebase-config.js`），格式如：

```js
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "forestry-rs-monitor.firebaseapp.com",
  projectId: "forestry-rs-monitor",
  storageBucket: "forestry-rs-monitor.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc..."
};
```

> 🔥 **這份 config 即使公開到 GitHub 也安全**——權限由 Security Rules 控制，不靠 apiKey 機密性。

---

## 貳、啟用 Firebase 服務（3 分鐘）

在 Firebase Console 左側選單依序開：

### 一、Authentication
- 點「開始使用」
- 「Sign-in method」分頁，啟用：
   1. **電子郵件/密碼**（必要）
   2. **Google**（必要，方便登入）

### 二、Firestore Database
- 點「建立資料庫」
- 模式：**正式版（Production mode）**（先全擋，之後我們部署 rules）
- 位置：`asia-east1`（彰化機房，台灣最近）

### 三、Storage
- 點「開始使用」
- 模式：**正式版**
- 位置：跟 Firestore 同（`asia-east1`）

---

## 參、安裝 Firebase CLI 並部署規則（5 分鐘）

### 一、安裝
在 PowerShell 跑：

```powershell
npm install -g firebase-tools
firebase login
# 會開瀏覽器，用同一個 Google 帳號登入
```

### 二、初始化專案
```powershell
cd "H:\我的雲端硬碟\2026 forestry_RS\modules\森林監測App\pwa"
firebase init
```

選項：
- ☑ Firestore
- ☑ Storage
- ☑ Hosting
- 選現有專案 → `forestry-rs-monitor`
- Firestore rules file: **firestore.rules**（已存在，不要覆寫）
- Firestore indexes file: `firestore.indexes.json`（讓它建預設）
- Storage rules file: **storage.rules**（已存在）
- Hosting public directory: `.`（當前資料夾就是 PWA root）
- Single-page app: **Yes**
- 不要覆寫現有 `index.html`

### 三、部署規則
```powershell
firebase deploy --only firestore:rules,storage:rules
```

---

## 肆、貼 config 進 PWA

```powershell
cd "H:\我的雲端硬碟\2026 forestry_RS\modules\森林監測App\pwa"
copy firebase-config.example.js firebase-config.js
notepad firebase-config.js
# 把第二步驟複製的 config 貼進 firebaseConfig = {...}，存檔
```

> ⚠️ `firebase-config.js` **不會** commit 到 GitHub（已列入 `.gitignore`）。即使列入也安全（權限靠 rules），但保持 example 與實際分離是好習慣。

---

## 伍、本機跑起來

### 一、純靜態（最快）
```powershell
cd "H:\我的雲端硬碟\2026 forestry_RS\modules\森林監測App\pwa"
python -m http.server 8000
# 開 http://localhost:8000
```

### 二、用 Firebase Emulator（推薦開發用，不會打到正式 Firestore）
```powershell
firebase emulators:start
# Emulator UI: http://localhost:4000
# Hosting:    http://localhost:5000
```

### 三、部署到網路（給調查員用）
```powershell
firebase deploy --only hosting
# 會給你網址，例：https://forestry-rs-monitor.web.app
```

---

## 陸、建第一個帳號 + 灌示範資料

1. 開上面那個網址，點「Google 登入」
2. 第一個登入的人需手動到 Firebase Console → Firestore → 找到 `/users/{你的uid}` → 加 `globalRole: "admin"`
3. 在 App 內按「建專案」→ 名稱：「示範林班」→ 你會自動成為 pi
4. 在 App 設定頁按「灌入示範資料」→ 會把 `seed-data/示範林班-假資料.json` 寫進 Firestore
5. 開始玩！

---

## 柒、檢核清單

- [ ] Firebase 專案建好
- [ ] Auth（Email + Google）啟用
- [ ] Firestore（正式模式，`asia-east1`）
- [ ] Storage（正式模式，`asia-east1`）
- [ ] firebase-tools CLI 登入
- [ ] `firebase init` 跑完，`firebase.json` 產生
- [ ] `firebase deploy --only firestore:rules,storage:rules` 成功
- [ ] `firebase-config.js` 已建並貼好 config
- [ ] 本機 `python -m http.server` 或 emulator 跑起來
- [ ] 第一個帳號登入成功
- [ ] 灌入示範資料成功

跑完打勾 → 跟我說「Firebase 好了」，我會帶你做第一輪實際操作驗證。
