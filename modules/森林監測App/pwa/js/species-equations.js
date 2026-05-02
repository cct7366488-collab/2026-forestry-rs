// ===== species-equations.js =====
// v1.6.21：移植自 Anthropic skill `carbon-volume-calculator` 的 volume_equations.json
// 來源：林務局 / 林試所實證研究（陳朝圳、羅紹麟、馮豐隆、楊寶霖、劉慎孝、林子玉、黃崑崗 等）
//
// 計算鏈：V (幹材積 m³) = species_equation(D, H)
//        Biomass (全株生物量 kg) = V × WD × BEF      ← 注意 BEF 已是「全株擴展係數」(0.5–0.64)
//        實際 skill 寫法：Biomass (tonnes) = V × BEF（將 V 直接乘 BEF 得 tonnes，BEF 內隱含密度）
//        Carbon (kg) = Biomass × CF
//        CO2 (kg) = Carbon × 44/12
//
// 單位：D = cm, H = m, V = m³, biomass / carbon / CO2 = kg（skill 用 tonnes，本 app 用 kg 與既有 schema 一致）

// ===== Equation evaluators（D in cm, H in m, return V in m³）=====
const ev = {
  power: ({ a, b, c }, D, H) => a * Math.pow(D, b) * Math.pow(H, c),
  log_d2h: ({ a, b }, D, H) => Math.pow(10, a + b * Math.log10(D * D * H)),
  log_dh: ({ a, b, c }, D, H) => Math.pow(10, a + b * Math.log10(D) + c * Math.log10(H)),
  log_d: ({ a, b }, D) => Math.pow(10, a + b * Math.log10(D)),
  // 二次式（只用 D）：紅冷杉、雲杉、香杉
  poly_d: ({ a, b, c }, D) => a + b * D + c * D * D,
  // 大葉桃花心木：V = a + b×D + c×D² + d×D×H
  poly_swietenia: ({ a, b, c, d }, D, H) => a + b * D + c * D * D + d * D * H,
  // 泡桐類：V = a + b×H + c×D + d×H×D + e×H×D²
  poly_paulownia: ({ a, b, c, d, e }, D, H) => a + b * H + c * D + d * H * D + e * H * D * D,
  // 銀合歡：lnV = a + b×lnD + c×lnH + d×D²
  ln_power: ({ a, b, c, d }, D, H) => Math.exp(a + b * Math.log(D) + c * Math.log(H) + d * D * D),
  // 其它針：log(V×10) = a + b×logD + c×logH + d×F  → V = 10^(...) / 10
  log_dhf: ({ a, b, c, d }, D, H, F = 0.5) =>
    Math.pow(10, a + b * Math.log10(D) + c * Math.log10(H) + d * F) / 10,
};

// ===== Primary species DB =====
// 每筆：{ sci, category, calcV(D,H), bef, cf, source }
// bef 為「全株生物量擴展係數」（含根，從 V 直接乘出全株 biomass tonnes）
// cf  為「碳含量比例」（碳/全株 biomass）
const SP = {
  // ===== 針葉樹 =====
  '紅檜': { sci: 'Chamaecyparis formosensis', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 0.00010092, b: 1.541061, c: 1.155141 }, D, H),
    bef: 0.58, cf: 0.49, source: '陳朝圳 1985 大雪山 power V=aD^bH^c' },
  '香杉': { sci: 'Calocedrus formosana', category: 'conifer',
    calcV: (D) => ev.poly_d({ a: -0.02278, b: 0.000746, c: 0 }, D),
    bef: 0.52, cf: 0.49, source: '劉宣誠 鄭宗元 陳麗琴 1974 蓮華池 V=a+bD²' },
  '松類': { sci: 'Pinus spp.', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 6.25e-05, b: 1.77924, c: 1.05866 }, D, H),
    bef: 0.52, cf: 0.49, source: '黃崑崗 1970 全省 power' },
  '琉球松': { sci: 'Pinus luchuensis', category: 'conifer',
    calcV: (D, H) => ev.log_dh({ a: -4.29959, b: 1.66283, c: 1.45112 }, D, H),
    bef: 0.52, cf: 0.49, source: '劉慎孝 林子玉 1970 北部 log_dh' },
  '二葉松': { sci: 'Pinus taiwanensis', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 0.0001547675, b: 1.700988, c: 0.721114 }, D, H),
    bef: 0.52, cf: 0.49, source: '羅紹麟 馮豐隆 1986 全省 power' },
  '鐵杉': { sci: 'Tsuga chinensis var. formosana', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 7.28e-05, b: 1.944924, c: 0.800221 }, D, H),
    bef: 0.52, cf: 0.49, source: '林務局 1973 全省 power' },
  '冷杉': { sci: 'Abies kawakamii', category: 'conifer',
    calcV: (D) => ev.poly_d({ a: -0.5066, b: 0.005367, c: 0.000696 }, D),
    bef: 0.52, cf: 0.49, source: '楊寶霖 石子材 1963 北部 V=a+bD+cD²' },
  '雲杉': { sci: 'Picea morrisonicola', category: 'conifer',
    calcV: (D) => ev.poly_d({ a: -1.0731, b: 0.021053, c: 0.000797 }, D),
    bef: 0.52, cf: 0.49, source: '楊寶霖 石子材 1963 中部 V=a+bD+cD²' },
  // v2.3.2 修正：原 calcV: ev.log_d({a:0.713, b:1.34335}, D) 對 D=6cm 算出 57 m³ 嚴重爆量
  // 推測原始文獻 V 單位為 dm³（劉慎孝 1969 logV=a+blogD），但程式當 m³ 用，量級差 ~1000 倍
  // 安全做法：proxy 到台灣杉式（power D+H 雙變量、同為 Cupressaceae/Taxodioideae 親緣）
  '杉木': { sci: 'Cunninghamia lanceolata', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 9.44e-05, b: 1.994741, c: 0.656961 }, D, H),
    bef: 0.52, cf: 0.49, source: 'v2.3.2 借用台灣杉式（劉慎孝 1969 原參數疑單位錯，待覆核）' },
  '柳杉': { sci: 'Cryptomeria japonica', category: 'conifer',
    calcV: (D, H) => ev.log_d2h({ a: -4.193148, b: 0.933828 }, D, H),
    bef: 0.519, cf: 0.4903, source: '楊榮啟 1972 臺大實驗林 logV=a+blogD²H' },
  '台灣杉': { sci: 'Taiwania cryptomerioides', category: 'conifer',
    calcV: (D, H) => ev.power({ a: 9.44e-05, b: 1.994741, c: 0.656961 }, D, H),
    bef: 0.52, cf: 0.49, source: '林務局 1973 全省 power' },
  // ===== 闊葉樹 =====
  '樟樹': { sci: 'Cinnamomum camphora', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 4.89823e-05, b: 1.6045, c: 1.25502 }, D, H),
    bef: 0.637, cf: 0.4691, source: '羅紹麟 馮豐隆 1986 全省 power' },
  '楠木類': { sci: 'Lauraceae spp.', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 4.89823e-05, b: 1.6045, c: 1.25502 }, D, H),
    bef: 0.637, cf: 0.4691, source: '同樟樹式（Lauraceae 共用）' },
  '櫧櫟類': { sci: 'Fagaceae spp.', category: 'broadleaf',
    calcV: (D, H) => ev.log_dh({ a: -4.0038576, b: 1.8751297, c: 0.745544 }, D, H),
    bef: 0.58, cf: 0.47, source: '林子玉 1975 全省 log_dh (n=928)' },
  '相思樹': { sci: 'Acacia confusa', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 0.0002045, b: 1.4366684, c: 0.8480426 }, D, H),
    bef: 0.58, cf: 0.47, source: '羅紹麟 馮豐隆 1986 全省 power' },
  '大葉桃花心木': { sci: 'Swietenia macrophylla', category: 'broadleaf',
    calcV: (D, H) => ev.poly_swietenia({ a: 0.01, b: -0.00871296, c: 0.00060626, d: 0.00047815 }, D, H),
    bef: 0.58, cf: 0.47, source: '劉宣誠 林銘輝 曲俊麒 1981 中埔造林地' },
  '光腊樹': { sci: 'Fraxinus griffithii', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 7.72e-05, b: 1.8780277, c: 0.8124601 }, D, H),
    bef: 0.58, cf: 0.47, source: '羅紹麟 馮豐隆 1986 東部南部 power' },
  '銀合歡': { sci: 'Leucaena leucocephala', category: 'broadleaf',
    calcV: (D, H) => ev.ln_power({ a: -9.8, b: 1.65041, c: 1.26416, d: -0.00245828 }, D, H),
    bef: 0.58, cf: 0.47, source: '陳朝圳 范貴珠 1989 恆春潮州 ln_power' },
  '泡桐': { sci: 'Paulownia spp.', category: 'broadleaf',
    calcV: (D, H) => ev.poly_paulownia({ a: 0.095701, b: -0.015306, c: -0.006139, d: 0.001436, e: 1.3e-05 }, D, H),
    bef: 0.58, cf: 0.47, source: '劉宣誠 1974 全省 5 項多項式' },
  '楓香': { sci: 'Liquidambar formosana', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 8.34e-05, b: 1.8761885, c: 0.8058127 }, D, H),
    bef: 0.58, cf: 0.47, source: '羅紹麟 馮豐隆 1986 闊葉(借用)' },
  '台灣赤楊': { sci: 'Alnus formosana', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 8.34e-05, b: 1.8761885, c: 0.8058127 }, D, H),
    bef: 0.58, cf: 0.47, source: '羅紹麟 馮豐隆 1986 闊葉(借用)' },
  // ===== 竹類 =====
  '桂竹': { sci: 'Phyllostachys makinoi', category: 'bamboo',
    calcV: (D, H) => ev.power({ a: 26.032, b: 1.5777, c: 1.1237 }, D, H),
    bef: 0.5, cf: 0.47, source: '黃崑崗 1972 中南部 power（單位特殊）' },
  // ===== Fallback（v2.10.7 擴 5 大樹型）=====
  // 沒對應 species-specific / 屬群代理時，依 treeType 路由到下列 5 個之一
  '其它針': { sci: 'Other conifers', category: 'conifer',
    calcV: (D, H) => ev.log_dhf({ a: -3.4692, b: 2.0052, c: 0.5598, d: 0.0077 }, D, H, 0.5),
    bef: 0.52, cf: 0.49, source: '農林航空測量隊 1959 全省 log_dhf (F=0.5)' },
  '其他闊': { sci: 'Other broadleaf', category: 'broadleaf',
    calcV: (D, H) => ev.power({ a: 8.62e-05, b: 1.8742, c: 0.8671 }, D, H),
    bef: 0.58, cf: 0.47, source: '羅紹麟 馮豐隆 1986 全省 power' },
  // v2.10.7：竹類 fallback（桂竹 SP 公式單位特殊不直接 clone；改用簡化中空竹稈圓柱）
  // V = π/4 × (D/100)² × H × 0.20（0.20 = 約 0.4 中空率 × 0.5 漸縮係數）
  // bef = WD 0.60 × BCEF 1.0（竹幾乎全為竹稈，無分支重量）
  '其他竹': { sci: 'Other bamboo', category: 'bamboo',
    calcV: (D, H) => Math.PI / 4 * Math.pow(D / 100, 2) * H * 0.20,
    bef: 0.60, cf: 0.47, source: 'IPCC 2006 + 簡化竹稈圓柱（V = π/4 × D² × H × 0.20；中空+漸縮；WD 0.60 × BCEF 1.0）' },
  // v2.10.7：棕櫚 fallback（棕櫚 stem 近圓柱，少漸縮）
  // V = π/4 × (D/100)² × H × 0.50（form factor 0.5）
  // bef = WD 0.30 × BCEF 1.05（棕櫚主要 biomass 在 stem，葉片較輕）
  '其他棕櫚': { sci: 'Other palm', category: 'palm',
    calcV: (D, H) => Math.PI / 4 * Math.pow(D / 100, 2) * H * 0.50,
    bef: 0.315, cf: 0.47, source: 'IPCC 2006 + 棕櫚圓柱（V = π/4 × D² × H × 0.50；form factor 0.5；WD 0.30 × BCEF 1.05）' },
  // v2.10.7：紅樹林 fallback（用闊葉式 V，BEF 上修反映高密度）
  // V = 闊葉羅紹麟 馮豐隆 1986
  // bef = 0.87（闊葉 0.58 × WD 比率 0.75/0.50；IPCC mangrove WD 0.75）
  '其他紅樹林': { sci: 'Other mangrove', category: 'mangrove',
    calcV: (D, H) => ev.power({ a: 8.62e-05, b: 1.8742, c: 0.8671 }, D, H),
    bef: 0.87, cf: 0.47, source: '其他闊式 V (羅紹麟 馮豐隆 1986)；BEF 0.87 反映紅樹林高密度（IPCC mangrove WD 0.75）' },
};

// v2.10.7：treeType → fallback species key 對照
//   tree form 從 species-picker 取得 picker.getMatched().treeType 傳入 calcTreeMetrics
//   匹配不到 SP/ALIAS 時用此 map 路由（取代 v2.10.6 之前的單一 sci-regex 二分）
const CATEGORY_FALLBACK = {
  conifer:   '其它針',
  broadleaf: '其他闊',
  bamboo:    '其他竹',
  palm:      '其他棕櫚',
  mangrove:  '其他紅樹林',
};

// ===== Aliases (中文別名 → primary species key) =====
const ALIAS = {
  // 紅檜
  '扁柏': '紅檜', '檜木': '紅檜', '臺灣紅檜': '紅檜',
  // 松類
  '其他松類': '松類', '濕地松': '松類',
  // 二葉松
  '台灣二葉松': '二葉松', '臺灣二葉松': '二葉松',
  // 鐵杉
  '臺灣鐵杉': '鐵杉',
  // 冷杉
  '台灣冷杉': '冷杉',
  // 雲杉
  '台灣雲杉': '雲杉', '臺灣雲杉': '雲杉',
  // 台灣杉
  '臺灣杉': '台灣杉', '巒大杉': '台灣杉',
  // 樟樹
  '臺灣肉桂': '樟樹', '台灣肉桂': '樟樹', '土肉桂': '樟樹',
  // 楠木類（Lauraceae）
  '楠木': '楠木類', '雅楠': '楠木類', '紅楠': '楠木類', '香楠': '楠木類', '大葉楠': '楠木類',
  '小葉楠': '楠木類', '瓊楠': '楠木類', '五掌楠': '楠木類', '長葉木薑子': '楠木類',
  '小梗木薑子': '楠木類', '屏東木薑子': '楠木類', '玉山木薑子': '楠木類', '李氏木薑子': '楠木類',
  '銳脈木薑子': '楠木類', '豬腳楠': '楠木類', '菲律賓楠': '楠木類', '假長葉楠': '楠木類',
  '青葉楠': '楠木類', '高山新木薑子': '楠木類', '變葉新木薑子': '楠木類', '牛樟': '楠木類', '烏心石': '楠木類',
  // 櫧櫟類（Fagaceae）
  '殼斗科': '櫧櫟類', '青剛櫟': '櫧櫟類', '赤皮': '櫧櫟類', '森氏櫟': '櫧櫟類',
  '長尾尖葉櫧': '櫧櫟類', '狹葉櫟': '櫧櫟類', '短尾葉石櫟': '櫧櫟類', '台灣栲': '櫧櫟類',
  '臺灣栲': '櫧櫟類', '星刺栲': '櫧櫟類', '長尾栲': '櫧櫟類', '卡氏櫧': '櫧櫟類',
  '大葉石櫟': '櫧櫟類', '小西氏石櫟': '櫧櫟類', '鬼石櫟': '櫧櫟類', '赤柯': '櫧櫟類',
  '錐果櫟': '櫧櫟類', '三斗石櫟': '櫧櫟類',
  // 相思樹
  '台灣相思': '相思樹',
  // 大葉桃花心木
  '桃花心木': '大葉桃花心木',
  // 光腊樹
  '光蠟樹': '光腊樹', '白雞油': '光腊樹',
  // 其它針 fallback
  '肖楠': '其它針', '臺灣五葉松': '其它針', '台灣五葉松': '其它針',
  '台灣肖楠': '其它針', '玉山圓柏': '其它針', '台灣扁柏': '其它針',
  '台灣油杉': '其它針', '台灣穗花杉': '其它針', '台灣紅豆杉': '其它針',
  // 其他闊 fallback（常見台灣闊葉樹）
  '其他闊葉樹': '其他闊', '九芎': '其他闊', '無患子': '其他闊', '茄苳': '其他闊',
  '苦楝': '其他闊', '楝樹': '其他闊', '楝': '其他闊', '木荷': '其他闊', '黃連木': '其他闊',
  '欖仁': '其他闊', '水黃皮': '其他闊', '刺桐': '其他闊', '杜英': '其他闊',
  '青楓': '其他闊', '楓樹': '其他闊', '台灣櫸': '其他闊', '臺灣櫸': '其他闊',
  '烏桕': '其他闊', '山櫻花': '其他闊', '構樹': '其他闊', '山黃麻': '其他闊',
  '木油桐': '其他闊', '山漆': '其他闊', '江某': '其他闊', '鵝掌柴': '其他闊',
};

const CONIFER_GENUS_RE = /Pinus|Cunninghamia|Cryptomeria|Cedrus|Picea|Abies|Tsuga|Taiwania|Chamaecyparis|Calocedrus|Keteleeria|Amentotaxus|Taxus|Podocarpus|Juniperus/;

// 從中文名 / 學名 / 樹型 解析到對應 species 條目
// v2.10.7：優先序 SP 完全 → ALIAS → CATEGORY_FALLBACK[treeType] → CONIFER_GENUS_RE (legacy) → 其他闊
//   treeType 由 caller 從 species-picker.getMatched().treeType 傳入（Firestore 224 種有此欄位）
//   自由輸入新物種無 treeType 時，仍走 sci-regex legacy path 保證不破
export function resolveSpecies(speciesZh, speciesSci, treeType) {
  if (speciesZh) {
    if (SP[speciesZh]) return { key: speciesZh, sp: SP[speciesZh], matched: 'exact' };
    const aliasKey = ALIAS[speciesZh];
    if (aliasKey && SP[aliasKey]) return { key: aliasKey, sp: SP[aliasKey], matched: 'alias' };
  }
  // v2.10.7：treeType 優先（picker 傳入）→ 落 5 大樹型 fallback
  if (treeType && CATEGORY_FALLBACK[treeType] && SP[CATEGORY_FALLBACK[treeType]]) {
    const key = CATEGORY_FALLBACK[treeType];
    return { key, sp: SP[key], matched: 'fallback-treeType' };
  }
  // 沒 treeType → 用 sci 屬名 regex 推測（legacy；自由輸入物種）
  const isConifer = speciesSci && CONIFER_GENUS_RE.test(speciesSci);
  const fbKey = isConifer ? '其它針' : '其他闊';
  return { key: fbKey, sp: SP[fbKey], matched: 'fallback-sci' };
}

// 主計算函式：取代 v1.6.20 自編的 calcTreeMetrics
// 注意：skill 的 V × BEF 直出 tonnes（biomass），這裡轉成 kg（× 1000）對齊既有 schema
// v2.10.7：加 treeType 參數（optional），讓 picker 選的物種能命中 5 大樹型 fallback
export function calcTreeMetrics({ dbh_cm, height_m, speciesZh, speciesSci, treeType }) {
  if (!dbh_cm || !height_m) {
    return { basalArea_m2: 0, volume_m3: 0, biomass_kg: 0, carbon_kg: 0, co2_kg: 0 };
  }
  const { sp } = resolveSpecies(speciesZh, speciesSci, treeType);
  const D = dbh_cm, H = height_m;
  const basalArea_m2 = Math.PI * Math.pow(D / 200, 2);
  let volume_m3 = sp.calcV(D, H);
  if (!isFinite(volume_m3) || volume_m3 < 0) volume_m3 = 0;  // 保護：極端值或公式溢位
  // v2.3.2 sanity check：單株 V 上限 100 m³（台灣巨木紅檜 Aboriginal 級也不超過 80 m³）
  // 超過視為公式異常 → 歸零並 warn，避免類似杉木 bug 滲入碳匯統計
  if (volume_m3 > 100) {
    console.warn(`[species-equations] 異常材積 ${volume_m3.toFixed(1)} m³ — D=${D}cm H=${H}m 物種=${speciesZh}（疑似公式異常，已歸零）`);
    volume_m3 = 0;
  }
  const biomass_t = volume_m3 * sp.bef;       // tonnes
  const carbon_t = biomass_t * sp.cf;         // tonnes
  const co2_t = carbon_t * 44 / 12;           // tonnes
  return {
    basalArea_m2: +basalArea_m2.toFixed(4),
    volume_m3:    +volume_m3.toFixed(3),
    biomass_kg:   +(biomass_t * 1000).toFixed(1),
    carbon_kg:    +(carbon_t * 1000).toFixed(1),
    co2_kg:       +(co2_t * 1000).toFixed(1)
  };
}

// v2.10.7：加 treeType param + 區分 fallback-treeType / fallback-sci 標籤（reviewer 透明度）
export function speciesParamsLabel(speciesZh, speciesSci, treeType) {
  const { key, sp, matched } = resolveSpecies(speciesZh, speciesSci, treeType);
  const tag = matched === 'exact'              ? `[${key}]`
            : matched === 'alias'              ? `[${key}←${speciesZh}]`
            : matched === 'fallback-treeType'  ? `[fallback ${key} (treeType=${treeType})]`
            : matched === 'fallback-sci'       ? `[fallback ${key} (sci-regex)]`
            : `[fallback ${key}]`;
  return `${tag} BEF ${sp.bef} / CF ${sp.cf} ｜ ${sp.source}`;
}

// 給 forms.js / app.js 用的方便 export
export const SPECIES_DB = SP;
