// ===== module-registry.js =====
// 每專案模組開關（軸 A）+ 模組運作方式（軸 B）的單一事實來源。
// 設計精神：Admin/PI 依計畫類型/調查需求自由組合模組。
//
// 重要：沿用既有 `project.methodology.modules` 布林 map 為唯一儲存（v2.0 起即存在），
// 不另開 survey.modules 平行欄位 → 避免兩套真相來源 drift、且不破壞既有專案資料。
//   軸 A：methodology.modules[<id>] = true/false
//   軸 B：methodology.surveyMethod = 'sampling'|'census'；methodology.monitoring = 'single'|'repeat'
// 向後相容：缺 key → 取該模組 defaultEnabled（與既有 code 的 !==false / ===true 語意一致）。

export const FAMILIES = {
  core: '系統核心',
  plot: '樣區調查',
  qaqc: '取樣審查',
  admin: '行政',
};

// 模組清單。
//   id        = methodology.modules 的 key（既有 7 個沿用原名：tree/regeneration/understory/soilCons/wildlife/harvest/plot）
//   default   = 缺 key 時的啟用值（既有子調查維持原預設；新增頂層模組預設 ON 以保既有專案行為不變）
//   tabs      = 此模組控制的頂層分頁 data-tab
//   subtab    = 此模組控制的樣區詳情子分頁 data-subtab（plot 家族）
//   implemented:false = 預留、UI 標「未實作」
export const MODULES = [
  // 樣區調查（既有子調查；default 與 app.js/forms.js 現行語意一致）
  { id: 'tree',         family: 'plot', label: '立木調查',     default: true,  subtab: 'trees' },
  { id: 'regeneration', family: 'plot', label: '自然更新調查', default: true,  subtab: 'regen' },
  { id: 'understory',   family: 'plot', label: '下層植被調查', default: false, subtab: 'understory' },
  { id: 'soilCons',     family: 'plot', label: '水土保持觀測', default: false, subtab: 'soilcons' },
  // soil 與 soilCons 不同：soilCons 觀測沖蝕/植生覆蓋等水保指標；soil 為土壤理化性質採樣（預留）。
  { id: 'soil',         family: 'plot', label: '土壤調查',     default: false, subtab: 'soil', implemented: false },
  { id: 'wildlife',     family: 'plot', label: '野生動物調查', default: false, subtab: 'wildlife' },
  { id: 'harvest',      family: 'plot', label: '經濟收穫（樣區內）', default: false, subtab: 'harvest' },

  // 頂層分頁模組（新增 key；default ON = 保既有專案目前行為，新專案由套餐決定）
  // 註：design（方法學/設計分頁）刻意「不」設為可關模組——它是模組開關本身的編輯入口，
  //     關掉會讓 PI 鎖死無法再開；維持僅角色 gating。
  { id: 'qaqc',          family: 'qaqc',  label: '取樣審查（QAQC）', default: true, tabs: ['qaqc', 'pending', 'myflagged'] },
  { id: 'export',        family: 'qaqc',  label: '匯出',         default: true,  tabs: ['export'] },
  // 行政（修枝申請/審核/葉片採收回報/合作社彙整 綁一起；角色仍細分申請/審核/彙整）
  { id: 'admin_harvest', family: 'admin', label: '修枝採收行政', default: true,
    tabs: ['harvestapply', 'harvestreview', 'harvestreport', 'coop'] },
];

const moduleById = Object.fromEntries(MODULES.map(m => [m.id, m]));
export const GATEABLE_IDS = MODULES.map(m => m.id);
// 頂層核心分頁：永不被模組關閉（樣區/儀表板/地圖/設定）。
const CORE_TABS = ['plots', 'dashboard', 'map', 'settings'];

// ---- 軸 B 預設 ----
export const DEFAULT_SURVEY_METHOD = 'sampling';  // sampling=山區取樣；census=都市林/平地全區每木
export const DEFAULT_MONITORING = 'single';        // single=單次；repeat=重複監測（複查路 I）

// ---- 模組是否啟用（軸 A）----
export function moduleEnabled(project, moduleId) {
  const mod = moduleById[moduleId];
  const v = project?.methodology?.modules?.[moduleId];
  if (v === undefined || v === null) return mod ? mod.default !== false : true;
  return v === true;
}

// 某頂層分頁是否屬於已啟用模組（核心分頁 + 未被任何模組宣告的分頁 → 全開）。
export function tabEnabled(project, tabName) {
  if (CORE_TABS.includes(tabName)) return true;
  const owners = MODULES.filter(m => (m.tabs || []).includes(tabName));
  if (owners.length === 0) return true;
  return owners.some(m => moduleEnabled(project, m.id));
}

// 某樣區子分頁是否啟用。
export function subtabEnabled(project, subtabName) {
  const owner = MODULES.find(m => m.subtab === subtabName);
  if (!owner) return true;
  return moduleEnabled(project, owner.id);
}

export function getSurveyMethod(project) { return project?.methodology?.surveyMethod || DEFAULT_SURVEY_METHOD; }
export function getMonitoring(project) { return project?.methodology?.monitoring || DEFAULT_MONITORING; }
export function getModule(id) { return moduleById[id]; }

// ---- 套餐（UI 預設模板）：on=要開的模組 id；外加軸 B 覆寫 ----
// v2.11.64：BASE_ON 從 ['tree','regeneration','export'] 縮為 ['export']
//   原因：純行政專案（RES/OTHER + admin_harvest）不需樣區調查，但 tree/regeneration 從 BASE_ON 強制開
//        導致樣區/設計/儀表板分頁無法隱藏。改為由各套餐自行帶入 tree/regeneration（樣區調查型套餐）。
//   既有專案（Firestore 已存 methodology.modules）不受影響；僅影響新建專案的預設值。
const BASE_ON = ['export'];
export const PRESETS = {
  basic_sampling: { label: '基本樣區調查（取樣）', on: ['tree', 'regeneration'], surveyMethod: 'sampling' },
  census_urban:   { label: '全區每木調查（都市林/平地）', on: ['tree', 'regeneration'], surveyMethod: 'census' },
  full_ecology:   { label: '完整生態調查', on: ['tree', 'regeneration', 'understory', 'soilCons', 'soil', 'wildlife'] },
  qaqc:           { label: '取樣審查', on: ['qaqc'] },
  admin_harvest:  { label: '修枝採收行政', on: ['admin_harvest', 'harvest'] },
  repeat:         { label: '重複監測', on: [], monitoring: 'repeat' },
};

// ---- 計畫類型 → 預設套餐（未列 → 全開，向後相容）----
export const TYPE_PRESETS = {
  FMP:  ['full_ecology', 'qaqc'],
  CARB: ['basic_sampling', 'qaqc', 'repeat'],
  MNTR: ['basic_sampling', 'repeat'],
  INV:  ['basic_sampling', 'qaqc'],
  FRA:  ['basic_sampling'],
  RES:  ['admin_harvest'],
  OTHER:['admin_harvest'],
};

// 把一組套餐展開成完整的 methodology 片段 {modules, surveyMethod, monitoring}。
export function expandPresets(presetIds = []) {
  const modules = {};
  GATEABLE_IDS.forEach(id => { modules[id] = false; });
  BASE_ON.forEach(id => { modules[id] = true; });
  let surveyMethod = DEFAULT_SURVEY_METHOD, monitoring = DEFAULT_MONITORING;
  for (const pid of presetIds) {
    const p = PRESETS[pid];
    if (!p) continue;
    p.on.forEach(id => { modules[id] = true; });
    if (p.surveyMethod) surveyMethod = p.surveyMethod;
    if (p.monitoring) monitoring = p.monitoring;
  }
  return { modules, surveyMethod, monitoring };
}

// 計畫類型 → 新專案的 methodology 模組片段；類型未對照 → 全開（向後相容）。
export function defaultModulesForType(typeCode) {
  const presets = TYPE_PRESETS[typeCode];
  if (!presets) {
    const modules = {};
    GATEABLE_IDS.forEach(id => { modules[id] = moduleById[id].implemented === false ? false : true; });
    return { modules, surveyMethod: DEFAULT_SURVEY_METHOD, monitoring: DEFAULT_MONITORING };
  }
  return expandPresets(presets);
}
