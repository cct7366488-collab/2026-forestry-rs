// ===== code-tables.js =====
// v1.7.1：專案代碼結構化清單（admin 建專案用）
// 格式：{TYPE}-{AGENCY}-{YEAR}-{NNN}  例：FMP-PTFB-2026-001
// 來源：陳朝圳教授實務常用業務 + 林業署改制（2023）後分署 + 國家公園 + 主要研究機構

// ===== 計畫類型 =====
export const TYPE_CODES = [
  { code: 'FMP',   label: '森林經營計畫',   en: 'Forest Management Plan' },
  { code: 'CARB',  label: '碳匯/碳會計',   en: 'Carbon Sink / Accounting' },
  { code: 'MNTR',  label: '森林監測',       en: 'Monitoring' },
  { code: 'INV',   label: '永久樣區清查',   en: 'Permanent Plot Inventory' },
  { code: 'FRA',   label: '森林資源調查',   en: 'Forest Resource Assessment' },
  { code: 'USR',   label: '大學社會責任',   en: 'University Social Responsibility' },
  { code: 'RES',   label: '研究計畫',       en: 'Research' },
  { code: 'RST',   label: '復育/造林',     en: 'Restoration / Reforestation' },
  { code: 'FIRE',  label: '林火管理',       en: 'Fire Management' },
  { code: 'BIO',   label: '生物多樣性',     en: 'Biodiversity' },
  { code: 'WSHD',  label: '集水區',         en: 'Watershed' },
  { code: 'EIA',   label: '環境影響評估',   en: 'Environmental Impact Assessment' },
  { code: 'POL',   label: '政策研究',       en: 'Policy Research' },
  { code: 'TRAIN', label: '教育訓練',       en: 'Training / Education' },
  { code: 'OTHER', label: '其他',           en: 'Other' },
];

// ===== 委託 / 執行單位 =====
// 分組：林業署系統 → 國家公園 → 中央機關 → 大學 → 其他
export const AGENCY_CODES = [
  // ----- 林業及自然保育署系統（2023 改制後） -----
  { group: '林業署', code: 'FB',     label: '林業及自然保育署（總署）' },
  { group: '林業署', code: 'YLFB',   label: '林業署 宜蘭分署' },
  { group: '林業署', code: 'HCFB',   label: '林業署 新竹分署' },
  { group: '林業署', code: 'TCFB',   label: '林業署 台中分署' },
  { group: '林業署', code: 'NTFB',   label: '林業署 南投分署' },
  { group: '林業署', code: 'CYFB',   label: '林業署 嘉義分署' },
  { group: '林業署', code: 'PTFB',   label: '林業署 屏東分署' },
  { group: '林業署', code: 'HLFB',   label: '林業署 花蓮分署' },
  { group: '林業署', code: 'TTFB',   label: '林業署 台東分署' },
  { group: '林業署', code: 'FRI',    label: '林業試驗所' },

  // ----- 國家公園 -----
  { group: '國家公園', code: 'KTNP',  label: '墾丁國家公園' },
  { group: '國家公園', code: 'YSNP',  label: '玉山國家公園' },
  { group: '國家公園', code: 'TLKNP', label: '太魯閣國家公園' },
  { group: '國家公園', code: 'SHNP',  label: '雪霸國家公園' },
  { group: '國家公園', code: 'YMSNP', label: '陽明山國家公園' },
  { group: '國家公園', code: 'KMNP',  label: '金門國家公園' },
  { group: '國家公園', code: 'TJNP',  label: '台江國家公園' },
  { group: '國家公園', code: 'MTNP',  label: '海洋國家公園' },
  { group: '國家公園', code: 'PHNP',  label: '澎湖南方四島國家公園' },

  // ----- 中央機關 -----
  { group: '中央機關', code: 'MOA',    label: '農業部' },
  { group: '中央機關', code: 'NSTC',   label: '國科會' },
  { group: '中央機關', code: 'MOENV',  label: '環境部' },
  { group: '中央機關', code: 'MOE',    label: '教育部' },
  { group: '中央機關', code: 'CIP',    label: '原住民族委員會' },
  { group: '中央機關', code: 'WRA',    label: '水利署' },

  // ----- 大學 -----
  { group: '大學', code: 'NPUST', label: '屏東科技大學' },
  { group: '大學', code: 'NCHU',  label: '中興大學' },
  { group: '大學', code: 'NTU',   label: '臺灣大學' },
  { group: '大學', code: 'NCYU',  label: '嘉義大學' },
  { group: '大學', code: 'PCCU',  label: '文化大學' },
  { group: '大學', code: 'NDHU',  label: '東華大學' },

  // ----- 其他 -----
  { group: '其他', code: 'PRIV',  label: '私人/合作社' },
  { group: '其他', code: 'OTHER', label: '其他' },
];

// 將代碼陣列轉成 group → list 對應
export function agenciesByGroup() {
  const m = {};
  for (const a of AGENCY_CODES) {
    if (!m[a.group]) m[a.group] = [];
    m[a.group].push(a);
  }
  return m;
}

// 從 prefix（"FMP-PTFB-2026-"）查 Firestore 找最大流水號 +1
// projectsSnapDocs：getDocs(collection('projects')) 的 docs 陣列
export function nextSequence(projectsSnapDocs, prefix) {
  let maxSeq = 0;
  for (const d of projectsSnapDocs) {
    const code = d.data().code || '';
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    const m = tail.match(/^(\d{3})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return String(maxSeq + 1).padStart(3, '0');
}

// 組合代碼
export function buildProjectCode(type, agency, year, seq) {
  return `${type}-${agency}-${year}-${seq}`;
}

// 驗證代碼格式（{TYPE}-{AGENCY}-{YEAR}-{NNN}）
export function validateProjectCode(code) {
  return /^[A-Z]{2,5}-[A-Z]{2,6}-\d{4}-\d{3}$/.test(code);
}
