// 複製本檔成 firebase-config.js 並填入你的 Firebase 專案 config
// firebase-config.js 已列入 .gitignore，不會上 GitHub
//
// 從 Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定取得

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};

// 預設專案代碼（用於 seed 與 demo）
export const DEMO_PROJECT_CODE = 'DEMO';
