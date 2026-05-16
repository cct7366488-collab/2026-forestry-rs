// 產生 5/20 說明會簡報 — 土肉桂葉片採收許可電子化系統
const path = require('path');
const PPTX = require('C:/Users/cct/AppData/Roaming/npm/node_modules/pptxgenjs');

const OUT = path.join(__dirname, '05-土肉桂採收許可-520說明會簡報.pptx');

const FOREST = '2C5F2D', MOSS = '97BC62', CREAM = 'F4F6F1', DARK = '1E3A1E',
      INK = '23311F', MUTE = '5F6B5A', WHITE = 'FFFFFF', GOLD = 'C9A227',
      RED = 'B3261E', AMBER = 'B26A00', LINE = 'CBD5C0';
const HF = 'Microsoft JhengHei', BF = 'Microsoft JhengHei';

const p = new PPTX();
p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
p.layout = 'W';
p.author = 'ForestMRV';
p.title = '土肉桂葉片採收許可電子化系統 — 5/20 說明會';
const W = 13.333, H = 7.5, MX = 0.7;

const notes = (s, t) => s.addNotes(t);

function titleBlock(s, kicker, title) {
  s.addText(kicker, { x: MX, y: 0.42, w: W - 2 * MX, h: 0.32, fontFace: HF, fontSize: 13, color: FOREST, bold: true, charSpacing: 2, margin: 0 });
  s.addText(title, { x: MX, y: 0.72, w: W - 2 * MX, h: 0.78, fontFace: HF, fontSize: 30, color: INK, bold: true, margin: 0 });
}
function pageNum(s, n) {
  s.addText(String(n).padStart(2, '0') + ' / 13', { x: W - 1.7, y: H - 0.5, w: 1.1, h: 0.3, fontFace: BF, fontSize: 10, color: MUTE, align: 'right', margin: 0 });
}
function bullets(items, opt) {
  return items.map((t, i) => ({ text: t, options: { bullet: { code: '2022', indent: 16 }, breakLine: true, color: INK, fontSize: opt?.fs || 15, paraSpaceAfter: opt?.sp ?? 8 } }));
}

/* ---------- 1 封面 ---------- */
let s = p.addSlide(); s.background = { color: DARK };
s.addShape(p.shapes.OVAL, { x: 10.4, y: -1.6, w: 4.6, h: 4.6, fill: { color: FOREST } });
s.addShape(p.shapes.OVAL, { x: 11.6, y: 4.6, w: 3.4, h: 3.4, fill: { color: '264A26' } });
s.addText('土肉桂專區 ▍林產物採取許可電子化', { x: MX, y: 1.7, w: 11, h: 0.4, fontFace: HF, fontSize: 15, color: MOSS, bold: true, charSpacing: 1, margin: 0 });
s.addText('土肉桂葉片採收許可\n電子化系統', { x: MX, y: 2.15, w: 11, h: 1.9, fontFace: HF, fontSize: 44, color: WHITE, bold: true, lineSpacingMultiple: 1.05, margin: 0 });
s.addText('林業及自然保育署臺中分署　×　林業合作社　×　林農', { x: MX, y: 4.25, w: 11.6, h: 0.5, fontFace: HF, fontSize: 18, color: CREAM, margin: 0 });
s.addText([
  { text: '電子化作業 ＋ 紙本正式發文　雙軌同步、全程留痕可查證', options: { color: MOSS, fontSize: 14, breakLine: true } },
  { text: '2026-05-20 說明會　｜　ForestMRV v2.11.37（已上線 prod）', options: { color: '9FB892', fontSize: 12 } }
], { x: MX, y: 5.7, w: 11.6, h: 0.9, fontFace: BF, margin: 0 });
notes(s, '開場：今天說明的是土肉桂葉片採收許可的電子化系統。重點是讓林農、臺中分署、合作社三方在同一套系統運作，且電子流程與紙本正式發文同步、不漂移。系統已實際上線，稍後現場操作示範。');

/* ---------- 2 痛點與目標 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '壹、為何要做', '行政痛點　→　電子化＋紙本雙軌');
const colY = 1.85, colH = 4.7, colW = 5.75;
s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: MX, y: colY, w: colW, h: colH, fill: { color: CREAM }, line: { color: LINE, width: 1 }, rectRadius: 0.08 });
s.addText('現行痛點', { x: MX + 0.35, y: colY + 0.28, w: colW - 0.7, h: 0.4, fontFace: HF, fontSize: 18, bold: true, color: RED, margin: 0 });
s.addText(bullets([
  '紙本申請、往返分署，流程冗長',
  '採收量事後申報，難即時勾稽核准量',
  '許可文號人工編列，易重號、難追溯',
  '合作社不易即時掌握各林農採收進度',
  '電子與紙本各做一套，資料易不一致'
], { fs: 15, sp: 10 }), { x: MX + 0.35, y: colY + 0.8, w: colW - 0.7, h: colH - 1.1, fontFace: BF, valign: 'top' });
const c2x = MX + colW + 0.45;
s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: c2x, y: colY, w: colW, h: colH, fill: { color: '2C5F2D' }, rectRadius: 0.08 });
s.addText('系統目標', { x: c2x + 0.35, y: colY + 0.28, w: colW - 0.7, h: 0.4, fontFace: HF, fontSize: 18, bold: true, color: WHITE, margin: 0 });
s.addText([
  '線上申請、線上核准、線上收穫登錄',
  '核准即時產生「不可重號」法定許可文號',
  '採收量分批登錄，累計即時對照核准量',
  '合作社唯讀掌握全專區、彙整供共同銷售',
  '同一筆資料即時產生公文／許可單，不漂移'
].map((t, i) => ({ text: t, options: { bullet: { code: '2022', indent: 16 }, breakLine: true, color: WHITE, fontSize: 15, paraSpaceAfter: 10 } })), { x: c2x + 0.35, y: colY + 0.8, w: colW - 0.7, h: colH - 1.1, fontFace: BF, valign: 'top' });
pageNum(s, 2);
notes(s, '左邊是現行紙本痛點，右邊是這套系統要解的目標。最關鍵的一句：電子化與紙本正式發文「同一資料來源」，所以兩邊不會對不起來。');

/* ---------- 3 三方角色 + 狀態機 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '貳、系統總覽', '三方角色與案件流程');
const rW = 3.78, rY = 1.9, rH = 2.5, gap = 0.32;
const roles = [
  { t: '林農', d: '提出申請、存草稿、送出；核准後登錄收穫量、結案；下載申請公文稿', c: FOREST },
  { t: '林業保育署臺中分署', d: '核准 / 駁回 / 要求補件；核准即發法定許可文號（唯一具核准權）', c: '3C6E47' },
  { t: '林業合作社', d: '唯讀掌握全專區申請與收穫；依林農彙整供共同銷售（無寫入權）', c: '6E8B3D' }
];
roles.forEach((r, i) => {
  const x = MX + i * (rW + gap);
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: rY, w: rW, h: rH, fill: { color: r.c }, rectRadius: 0.08 });
  s.addText(r.t, { x: x + 0.28, y: rY + 0.26, w: rW - 0.56, h: 0.7, fontFace: HF, fontSize: 19, bold: true, color: WHITE, margin: 0 });
  s.addText(r.d, { x: x + 0.28, y: rY + 0.95, w: rW - 0.56, h: rH - 1.15, fontFace: BF, fontSize: 13.5, color: 'EAF0E2', valign: 'top', margin: 0 });
});
const fY = 5.05;
s.addText('案件狀態流程', { x: MX, y: fY - 0.05, w: 4, h: 0.35, fontFace: HF, fontSize: 14, bold: true, color: MUTE, margin: 0 });
const steps = ['草稿', '送出待審', '分署審核', '核准（生文號）', '收穫量登錄', '結案'];
const sw = 1.92, sh = 0.66, sy = fY + 0.4;
steps.forEach((st, i) => {
  const x = MX + i * (sw + 0.14);
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: sy, w: sw, h: sh, fill: { color: i === 3 ? GOLD : CREAM }, line: { color: i === 3 ? GOLD : LINE, width: 1 }, rectRadius: 0.06 });
  s.addText(st, { x, y: sy, w: sw, h: sh, fontFace: HF, fontSize: 12.5, bold: true, color: i === 3 ? WHITE : INK, align: 'center', valign: 'middle', margin: 0 });
  if (i < steps.length - 1) s.addText('▶', { x: x + sw - 0.02, y: sy, w: 0.16, h: sh, fontSize: 10, color: MOSS, align: 'center', valign: 'middle', margin: 0 });
});
s.addText('另：駁回＝終結；要求補件＝退回林農補正後再送', { x: MX, y: sy + sh + 0.15, w: 9, h: 0.3, fontFace: BF, fontSize: 11.5, italic: true, color: MUTE, margin: 0 });
pageNum(s, 3);
notes(s, '三個角色、各司其職。特別強調：核准權只在分署；合作社是唯讀。下方是一件申請從草稿到結案的完整狀態流程，金色那格「核准」就是產生法定文號的關鍵節點。');

/* ---------- 4 申請表單的填寫 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '參、申請表單的填寫', '林農端：一張表完成採收申請');
const fields = [
  ['申請人 / 聯絡方式', '林農姓名、電話或 email'],
  ['林班 / 地號', '林地坐落（如：大甲溪事業區 12 林班 3 小班）'],
  ['採收面積 / 估計株數', '公頃；土肉桂母樹概估株數'],
  ['採收方式', '修枝採葉（預設）／截幹採葉／其他'],
  ['預計鮮葉量', '本次申請採收公斤數'],
  ['採收期間', '預計起迄日期'],
  ['用途', '精油萃取／乾燥食用／兩者皆有'],
  ['備註 / 操作', '可「儲存草稿」續填；「送出申請」後待審不可改']
];
s.addTable([[
  { text: '欄位', options: { fill: { color: FOREST }, color: WHITE, bold: true, fontFace: HF, fontSize: 15 } },
  { text: '說明 / 範例', options: { fill: { color: FOREST }, color: WHITE, bold: true, fontFace: HF, fontSize: 15 } }
], ...fields.map((r, i) => [
  { text: r[0], options: { fill: { color: i % 2 ? CREAM : WHITE }, color: INK, bold: true, fontFace: BF, fontSize: 14 } },
  { text: r[1], options: { fill: { color: i % 2 ? CREAM : WHITE }, color: INK, fontFace: BF, fontSize: 14 } }
])], { x: MX, y: 1.85, w: W - 2 * MX, colW: [3.6, 8.33], rowH: 0.5, border: { pt: 1, color: LINE }, valign: 'middle' });
pageNum(s, 4);
notes(s, '申請表單欄位完全對應現行林產物採取申請書，林農沒有額外負擔。重點操作：可先存草稿分次填，送出後就鎖定、進入分署審核。');

/* ---------- 5 申請公文的呈現 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '肆、申請公文的呈現', '一鍵產生「林產物採取申請函」');
const dx = MX, dy = 1.8, dw = 7.7, dh = 5.0;
s.addShape(p.shapes.RECTANGLE, { x: dx, y: dy, w: dw, h: dh, fill: { color: WHITE }, line: { color: '7C8B70', width: 1.25 }, shadow: { type: 'outer', color: '000000', blur: 5, offset: 2, angle: 135, opacity: 0.12 } });
s.addText('林產物採取申請函（土肉桂葉片）', { x: dx, y: dy + 0.22, w: dw, h: 0.4, fontFace: HF, fontSize: 16, bold: true, color: INK, align: 'center', margin: 0 });
s.addText([
  { text: '受文者：林業及自然保育署臺中分署', options: { breakLine: true, paraSpaceAfter: 4 } },
  { text: '發文日期：中華民國 115 年 5 月 16 日　發文字號：（自編／免填）', options: { breakLine: true, paraSpaceAfter: 6 } },
  { text: '主旨：申請於○○林班採取土肉桂葉片乙案，請　核准。', options: { bold: true, breakLine: true, paraSpaceAfter: 6 } },
  { text: '說明：', options: { bold: true, breakLine: true, paraSpaceAfter: 2 } },
  { text: '一、申請人、聯絡方式　二、林地坐落及權屬、面積', options: { breakLine: true, paraSpaceAfter: 2 } },
  { text: '三、採取標的與方式（修枝採葉）　四、預計採取數量', options: { breakLine: true, paraSpaceAfter: 2 } },
  { text: '五、採取期間　六、用途　七、檢附文件如附件', options: { breakLine: true, paraSpaceAfter: 6 } },
  { text: '申請人：____________（簽章）　申請日期：115.05.16', options: { breakLine: true, paraSpaceAfter: 4 } },
  { text: '（以下由臺中分署收件填用）收文日期____ 收文文號____ 承辦____', options: { color: MUTE } }
], { x: dx + 0.4, y: dy + 0.75, w: dw - 0.8, h: dh - 1.0, fontFace: BF, fontSize: 13, color: INK, valign: 'top', margin: 0 });
const nx = dx + dw + 0.4, nw = W - MX - nx;
s.addText('重點', { x: nx, y: dy + 0.05, w: nw, h: 0.35, fontFace: HF, fontSize: 15, bold: true, color: FOREST, margin: 0 });
s.addText(bullets([
  '草稿或送出後皆可下載',
  '標準公文「函」格式，可列印／另存 PDF',
  '供紙本正式發文送件',
  '「分署收文欄」＝電子與紙本交會點',
  '與線上同一資料來源，內容不漂移'
], { fs: 14, sp: 12 }), { x: nx, y: dy + 0.45, w: nw, h: dh - 0.5, fontFace: BF, valign: 'top' });
pageNum(s, 5);
notes(s, '這是申請端的紙本正式文件。林農填完線上表單，就能一鍵產生這份標準公文函稿、列印或存 PDF 送件。請特別介紹最下方「分署收文欄」——那是電子與紙本雙軌的交會點。重點是：這份公文是即時從線上資料算出來，不是另存一份會走樣的副本。');

/* ---------- 6 核准表單的文號呈現 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '伍、核准表單的文號呈現', '分署核准即「線上發證」');
s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: MX, y: 1.95, w: 6.4, h: 1.7, fill: { color: DARK }, rectRadius: 0.08 });
s.addText('核准許可文號', { x: MX + 0.4, y: 2.12, w: 5.6, h: 0.35, fontFace: HF, fontSize: 13, color: MOSS, bold: true, margin: 0 });
s.addText('林保中-土肉桂採葉-115-001', { x: MX + 0.4, y: 2.48, w: 5.6, h: 0.95, fontFace: HF, fontSize: 27, bold: true, color: WHITE, margin: 0 });
s.addText(bullets([
  '分署端僅可：核准 / 駁回 / 要求補件',
  '核准當下以資料庫「交易」原子產生文號',
  '同一專案保證連號、不可重號',
  '文號＝線上發證；紙本許可單含文號＋核章欄',
  '審核者不可竄改申請內容（規則層 affectedKeys 鎖定）'
], { fs: 15, sp: 11 }), { x: 7.45, y: 1.95, w: W - MX - 7.45, h: 4.7, fontFace: BF, valign: 'top' });
const flowY = 4.05;
const fbW = 1.3, fbGap = 0.3;
const fl = [['送審', CREAM, INK], ['分署核准', GOLD, WHITE], ['產生文號', FOREST, WHITE], ['列印許可單', CREAM, INK]];
fl.forEach((f, i) => {
  const x = MX + i * (fbW + fbGap);
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: flowY, w: fbW, h: 0.6, fill: { color: f[1] }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
  s.addText(f[0], { x, y: flowY, w: fbW, h: 0.6, fontFace: HF, fontSize: 11, bold: true, color: f[2], align: 'center', valign: 'middle', margin: 0 });
  if (i < 3) s.addText('▶', { x: x + fbW, y: flowY, w: fbGap, h: 0.6, fontSize: 10, color: MOSS, align: 'center', valign: 'middle', margin: 0 });
});
s.addText('Demo 已種子文號：林保中-土肉桂採葉-115-901 ~ 905\n（保留區，現場 live 核准仍從 001 起）', { x: MX, y: flowY + 0.8, w: 6.4, h: 0.7, fontFace: BF, fontSize: 11.5, italic: true, color: MUTE, valign: 'top', margin: 0 });
pageNum(s, 6);
notes(s, '核准是整個流程的法律關鍵。分署按下核准，系統立刻用資料庫交易機制原子產生這個許可文號，技術上保證不重號——等同線上發證。紙本許可單上會帶這個文號和核章欄。也要強調：審核者只能改狀態與審核欄位，動不了林農的申請內容，這是規則層鎖死的。');

/* ---------- 7 收穫量登錄 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '陸、收穫量登錄', '分批登錄、累計即時對照核准量');
s.addText(bullets([
  '採收常分批：每次登錄採收日、鮮葉重、乾葉重、含水率、批次',
  '系統即時加總，對照核准量顯示百分比',
  '達 90% 轉黃提醒、超過 100% 轉紅警示',
  '超量當場攔阻，林農與分署同步看得到'
], { fs: 15.5, sp: 12 }), { x: MX, y: 1.95, w: 6.5, h: 3.0, fontFace: BF, valign: 'top' });
const barX = 7.5, barW = 4.9, bY = 2.1;
function quota(y, label, pct, col) {
  s.addText(label, { x: barX, y, w: barW, h: 0.3, fontFace: BF, fontSize: 13, color: INK, margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: barX, y: y + 0.32, w: barW, h: 0.4, fill: { color: 'E7ECDF' }, rectRadius: 0.04 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: barX, y: y + 0.32, w: Math.min(barW, barW * pct), h: 0.4, fill: { color: col }, rectRadius: 0.04 });
}
quota(bY, '正常：已登錄 45 / 核准 60 kg（75%）', 0.75, FOREST);
quota(bY + 1.0, '接近：已登錄 56 / 核准 60 kg（93%）', 0.93, AMBER);
quota(bY + 2.0, '超量：已登錄 85 / 核准 80 kg（106%）', 1.0, RED);
s.addText('demo-08 吳國雄案即為超量紅燈示例', { x: barX, y: bY + 2.6, w: barW, h: 0.3, fontFace: BF, fontSize: 11.5, italic: true, color: MUTE, margin: 0 });
pageNum(s, 7);
notes(s, '收穫量可以分批登錄，系統自動累加並對照核准量。三段顏色：正常綠、接近黃、超量紅。種子資料裡吳國雄那案就是超量紅燈，現場可直接展示。');

/* ---------- 8 結案與許可單 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '柒、結案與採收許可單', '紀錄固定、可列印歸檔');
const k = [
  ['結案', '採收期結束後結案，案件紀錄固定，作為後續查核依據'],
  ['採收許可單', '含許可文號、核准量、效期、完整收穫紀錄與累計'],
  ['雙方檢視', '林農與分署皆可隨時調閱、列印（含分署核章欄）'],
  ['全程留痕', '申請→發證→收穫申報→結案，逐步可查證']
];
k.forEach((r, i) => {
  const y = 1.95 + i * 1.16;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: MX, y, w: 2.5, h: 1.0, fill: { color: FOREST }, rectRadius: 0.06 });
  s.addText(r[0], { x: MX, y, w: 2.5, h: 1.0, fontFace: HF, fontSize: 16, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
  s.addText(r[1], { x: MX + 2.8, y, w: W - MX - (MX + 2.8), h: 1.0, fontFace: BF, fontSize: 15, color: INK, valign: 'middle', margin: 0 });
});
pageNum(s, 8);
notes(s, '結案後紀錄就固定下來。許可單彙整了從發證到收穫的完整資訊，雙方都能隨時調閱列印。整條鏈路全程留痕、可查證，這對主管機關稽核很重要。');

/* ---------- 9 合作社彙整 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '捌、合作社可看到的彙整內容', '掌握全專區 ▍共同銷售規劃');
const stats = [['9 件', '申請案（已送出起）'], ['5 件', '已核准 / 採收 / 結案'], ['168 kg', '已實現可售鮮葉']];
stats.forEach((st, i) => {
  const x = MX + i * 4.0;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 1.8, w: 3.7, h: 1.18, fill: { color: i === 2 ? FOREST : CREAM }, line: { color: i === 2 ? FOREST : LINE, width: 1 }, rectRadius: 0.07 });
  s.addText(st[0], { x: x + 0.2, y: 1.92, w: 3.3, h: 0.6, fontFace: HF, fontSize: 24, bold: true, color: i === 2 ? WHITE : FOREST, margin: 0 });
  s.addText(st[1], { x: x + 0.2, y: 2.5, w: 3.3, h: 0.4, fontFace: BF, fontSize: 12.5, color: i === 2 ? 'E6EEDD' : MUTE, margin: 0 });
});
const td = [['林大山', '2', '45', '60', '精油萃取'], ['吳國雄', '1', '85', '0', '兩者皆有'], ['王美桂', '2', '38', '0', '乾燥食用'], ['張春生', '1', '0', '50', '精油萃取'], ['黃秋蘭', '1', '0', '60', '乾燥食用'], ['陳阿土', '1', '0', '45', '乾燥食用'], ['李文清', '1', '0', '0', '精油萃取（已駁回）']];
const head = ['林農', '案件數', '已實現鮮葉(kg)', 'Pipeline估(kg)', '用途'];
s.addTable([
  head.map(h => ({ text: h, options: { fill: { color: FOREST }, color: WHITE, bold: true, fontFace: HF, fontSize: 13.5 } })),
  ...td.map((r, i) => r.map((c, j) => ({ text: c, options: { fill: { color: i % 2 ? CREAM : WHITE }, color: INK, fontFace: BF, fontSize: 12.5, bold: j === 0, align: j === 0 || j === 4 ? 'left' : 'center' } })))
], { x: MX, y: 3.15, w: W - 2 * MX, colW: [2.4, 1.7, 3.0, 2.9, 1.93], rowH: 0.42, border: { pt: 1, color: LINE }, valign: 'middle' });
s.addText('「已實現」＝實際登錄收穫累計（採收中／已結案）即可投入共同銷售；Pipeline＝已送出／已核准但尚未採收之預估量', { x: MX, y: 6.55, w: W - 2 * MX, h: 0.4, fontFace: BF, fontSize: 11, italic: true, color: MUTE, margin: 0 });
pageNum(s, 9);
notes(s, '這是合作社最在意的一頁。上方三個數字一眼看懂規模；下方表格依林農拆解：已實現就是可以投入共同銷售的量，Pipeline 是還在流程中的預估量。合作社用這頁規劃共同銷售。數字都是現在系統裡的真實 demo 資料。');

/* ---------- 10 權限與資安 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '玖、權限與資安', '三方權責分立、最小權限');
const perm = [
  ['林農', '申請、收穫登錄、結案、下載公文', FOREST],
  ['臺中分署', '核准 / 駁回 / 補件、發文號', '3C6E47'],
  ['合作社', '唯讀彙整（無任何寫入）', '6E8B3D']
];
perm.forEach((r, i) => {
  const x = MX + i * 4.05;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 1.9, w: 3.78, h: 2.0, fill: { color: r[2] }, rectRadius: 0.08 });
  s.addText(r[0], { x: x + 0.25, y: 2.12, w: 3.3, h: 0.5, fontFace: HF, fontSize: 18, bold: true, color: WHITE, margin: 0 });
  s.addText(r[1], { x: x + 0.25, y: 2.62, w: 3.3, h: 1.15, fontFace: BF, fontSize: 13.5, color: 'EAF0E2', valign: 'top', margin: 0 });
});
s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: MX, y: 4.15, w: W - 2 * MX, h: 2.35, fill: { color: CREAM }, line: { color: LINE, width: 1 }, rectRadius: 0.07 });
s.addText('資安設計重點', { x: MX + 0.35, y: 4.35, w: 6, h: 0.35, fontFace: HF, fontSize: 15, bold: true, color: FOREST, margin: 0 });
s.addText(bullets([
  '合作社「唯讀」是資料庫規則「結構上」保證，不是靠介面藏按鈕',
  '分署只能改狀態／審核欄位／文號，動不了申請內容（affectedKeys 鎖定）',
  '林農看不到他人案件；越權寫入伺服器端直接拒絕',
  '電子與紙本同一資料來源，杜絕兩套對不起來'
], { fs: 13.5, sp: 8 }), { x: MX + 0.35, y: 4.72, w: W - 2 * MX - 0.7, h: 1.7, fontFace: BF, valign: 'top' });
pageNum(s, 10);
notes(s, '對主管機關，資安是審查重點。最有力的一句：合作社的唯讀不是介面藏按鈕，是資料庫規則結構上保證的，前端再怎麼改也寫不進去。分署也一樣，只能動審核相關欄位，碰不了林農申請內容。');

/* ---------- 11 Demo 環境現況 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '拾、Demo 環境現況', '系統已上線、資料已就緒');
const ds = [['v2.11.37', '已上線 prod'], ['10 筆', 'demo 採收案（含 1 草稿）'], ['5 個', '許可文號 115-901~905'], ['7 筆', '收穫量登錄紀錄'], ['168 kg', '合作社可見可售鮮葉'], ['1 帳號', '即可演示三分頁']];
ds.forEach((d, i) => {
  const x = MX + (i % 3) * 4.05, y = 1.95 + Math.floor(i / 3) * 1.7;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: 3.78, h: 1.45, fill: { color: i % 3 === 0 ? FOREST : CREAM }, line: { color: i % 3 === 0 ? FOREST : LINE, width: 1 }, rectRadius: 0.07 });
  s.addText(d[0], { x: x + 0.25, y: y + 0.18, w: 3.3, h: 0.6, fontFace: HF, fontSize: 22, bold: true, color: i % 3 === 0 ? WHITE : FOREST, margin: 0 });
  s.addText(d[1], { x: x + 0.25, y: y + 0.78, w: 3.3, h: 0.5, fontFace: BF, fontSize: 13, color: i % 3 === 0 ? 'E6EEDD' : MUTE, margin: 0 });
});
s.addText('系統網址：https://forestry-rs-monitor.web.app　（現場以簡報帳號登入，實機操作示範）', { x: MX, y: 5.55, w: W - 2 * MX, h: 0.4, fontFace: BF, fontSize: 13, color: INK, bold: true, margin: 0 });
pageNum(s, 11);
notes(s, '系統已實際上線，不是原型。已預先種入 10 筆橫跨各狀態的 demo 案、5 個許可文號、7 筆收穫紀錄，合作社頁可見 168 公斤可售量。一個簡報帳號就能演示申請、審核、彙整三個分頁。');

/* ---------- 12 後續 ---------- */
s = p.addSlide(); s.background = { color: WHITE };
titleBlock(s, '拾壹、後續規劃', '依現場回饋再修細部');
s.addText(bullets([
  '附件上傳：地籍圖、現場照片併附於申請',
  '收穫總表 Excel 匯出：供合作社共同銷售作業',
  '分署抽查 / 查核流程：實地勘查紀錄數位化',
  '正式公文 PDF 用印格式：與公文系統介接',
  '欄位與用語：依臺中分署實務需求調整'
], { fs: 16, sp: 14 }), { x: MX, y: 2.0, w: W - 2 * MX, h: 4.0, fontFace: BF, valign: 'top' });
s.addText('本日重點為蒐集三方意見，作為下一輪修改依據', { x: MX, y: 6.2, w: W - 2 * MX, h: 0.4, fontFace: HF, fontSize: 14, bold: true, color: FOREST, margin: 0 });
pageNum(s, 12);
notes(s, '這些是會後依各位回饋優先補強的項目，目前刻意不做，先把核心流程做穩、讓大家看到全貌。今天最重要的是蒐集三方的具體意見。');

/* ---------- 13 結語 / Q&A ---------- */
s = p.addSlide(); s.background = { color: DARK };
s.addShape(p.shapes.OVAL, { x: -1.4, y: 5.0, w: 4.2, h: 4.2, fill: { color: '264A26' } });
s.addShape(p.shapes.OVAL, { x: 11.4, y: -1.5, w: 3.6, h: 3.6, fill: { color: FOREST } });
s.addText('結語', { x: MX, y: 2.0, w: 11, h: 0.5, fontFace: HF, fontSize: 16, color: MOSS, bold: true, charSpacing: 2, margin: 0 });
s.addText('電子化 ＋ 紙本正式發文，雙軌同步\n全程留痕、可查證', { x: MX, y: 2.5, w: 11.6, h: 1.8, fontFace: HF, fontSize: 30, bold: true, color: WHITE, lineSpacingMultiple: 1.1, margin: 0 });
s.addText('現場將進行系統實機操作示範　—　歡迎提問與指教', { x: MX, y: 4.7, w: 11.6, h: 0.5, fontFace: BF, fontSize: 16, color: CREAM, margin: 0 });
s.addText('Q & A', { x: MX, y: 5.5, w: 4, h: 0.7, fontFace: HF, fontSize: 26, bold: true, color: GOLD, margin: 0 });
notes(s, '收尾一句話：電子與紙本雙軌同步、全程可查證。接下來直接進系統實機操作示範，照 demo 腳本走，邊操作邊回答問題。');

p.writeFile({ fileName: OUT }).then(() => console.log('WROTE ' + OUT)).catch(e => { console.error(e); process.exit(1); });
