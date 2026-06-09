// 土肉桂修枝矮化及施肥對生長影響之研究 — 下一期樣區調查作業程序手冊
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, ShadingType, PageBreak, Header, Footer, PageNumber
} = require('docx');

const OUT = 'H:\\我的雲端硬碟\\2026 forestry_RS\\reports\\2026-cinnamon-resurvey-sop\\土肉桂試驗-下一期樣區調查作業程序手冊.docx';
const CJK = { ascii: 'DFKai-SB', eastAsia: 'DFKai-SB', hAnsi: 'DFKai-SB' };
const CW = 9026; // A4 內容寬（1 吋邊界）

// ---------- helpers ----------
function seg(parts) {
  // parts: string 或 [{t, i?, b?}]
  if (typeof parts === 'string') return [new TextRun({ text: parts })];
  return parts.map(p => new TextRun({ text: p.t, italics: !!p.i, bold: !!p.b }));
}
function body(parts, extra = {}) {
  return new Paragraph({
    children: seg(parts),
    alignment: AlignmentType.BOTH,
    indent: { firstLine: 480 },              // 首行縮排 2 字
    spacing: { after: 100, line: 360, lineRule: 'auto' },
    ...extra,
  });
}
function plain(parts, extra = {}) { // 無首行縮排（清單項、表題等）
  return new Paragraph({ children: seg(parts), spacing: { after: 80, line: 340, lineRule: 'auto' }, ...extra });
}
function h1(t) {
  return new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 30 })],
    spacing: { before: 260, after: 140 }, keepNext: true });
}
function h2(t) {
  return new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 26 })],
    spacing: { before: 160, after: 100 }, keepNext: true });
}
function h3(t) {
  return new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 24 })],
    spacing: { before: 100, after: 70 }, keepNext: true });
}
function li(num, parts, lvl = 0) { // 編號清單項：lvl0 -> "1." 縮排 480；lvl1 -> "(1)" 縮排 840
  const left = lvl === 0 ? 480 : 960;
  const hang = lvl === 0 ? 300 : 360;
  return new Paragraph({
    children: [new TextRun({ text: num + ' ' }), ...seg(parts)],
    indent: { left, hanging: hang },
    alignment: AlignmentType.BOTH,
    spacing: { after: 70, line: 340, lineRule: 'auto' },
  });
}
function center(parts, extra = {}) {
  return new Paragraph({ children: seg(parts), alignment: AlignmentType.CENTER, ...extra });
}
// 直接吃 TextRun 陣列的置中段（封面用，可帶自訂字級）
function centerRuns(runs, extra = {}) {
  return new Paragraph({ children: runs, alignment: AlignmentType.CENTER, ...extra });
}
function rule(extra = {}) { // 置中裝飾橫線
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '2E6B3E', space: 1 } },
    spacing: { after: 60 }, ...extra,
  });
}
function cr(text, size, bold) { return new TextRun({ text, size, bold: !!bold, font: CJK }); }
// 表格
const BD = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
const BORDERS = { top: BD, bottom: BD, left: BD, right: BD, insideHorizontal: BD, insideVertical: BD };
function cell(parts, w, opts = {}) {
  const runs = (typeof parts === 'string' || Array.isArray(parts)) ? seg(parts) : [new TextRun({ text: String(parts) })];
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    shading: opts.head ? { fill: 'D9E8DC', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    verticalAlign: 'center',
    children: [new Paragraph({ children: runs, alignment: opts.align || AlignmentType.LEFT,
      spacing: { after: 0, line: 300, lineRule: 'auto' } })],
  });
}
function table(widths, rows) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: BORDERS,
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: r.map((c, ci) => cell(c, widths[ci], { head: ri === 0, align: ci === 0 ? AlignmentType.LEFT : AlignmentType.LEFT })),
    })),
  });
}
function tcap(t) { return new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 22 })], spacing: { before: 120, after: 60 } }); }
function gap() { return new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 60 } }); }

const SCI = { t: 'Cinnamomum osmophloeum', i: true };

// ---------- 封面 ----------
const cover = [
  new Paragraph({ children: [new TextRun({ text: '', size: 24 })], spacing: { before: 1600 } }),
  center([{ t: '土肉桂修枝矮化及施肥對生長影響之研究', b: true }], { spacing: { after: 200 } }),
  new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
  center([{ t: '下一期（第四期）樣區調查', b: true }]),
  center([{ t: '作業程序手冊', b: true }], { spacing: { after: 400 } }),
  center('（永久樣區複查標準作業程序 SOP）', { spacing: { after: 1200 } }),
  center('１１４—１１５年林業及自然保育署臺中分署轄區'),
  center('林業永續多元輔導計畫'),
  new Paragraph({ children: [new TextRun({ text: '', size: 24 })], spacing: { before: 800 } }),
  center('版本：第 1.0 版'),
  center('編製日期：中華民國 115 年 6 月'),
  center('適用期別：第四期複查（115Q2，推定調查日 2026-06-30，實際依現場排定）'),
];
// 封面標題放大
cover[1].rootKey; // no-op
const coverTitleSize = (p, s) => { p.options.children = p.options.children; };

// ---------- 內文 ----------
const content = [];
function push(...xs) { xs.forEach(x => content.push(x)); }

// 目次
push(h1('目　次'.replace('　', ' ')));
[
  '壹、目的與適用範圍',
  '貳、試驗設計與樣區概況',
  '參、調查時程與期別',
  '肆、調查前準備',
  '伍、現場調查作業程序',
  '陸、量測規範與精度',
  '柒、系統登錄程序（ForestMRV）',
  '捌、品質管制（QAQC）',
  '玖、資料彙整、報表與備份',
  '拾、安全與注意事項',
  '附錄一　樣區基本資料表',
  '附錄二　處理代碼與析因因子',
  '附錄三　立木狀態碼對照表',
  '附錄四　器材檢核清單',
  '附錄五　野外記錄表（紙本備援）',
].forEach(t => push(plain(t.replace(/　/g, ' '), { indent: { left: 240 } })));
push(new Paragraph({ children: [new PageBreak()] }));

// 壹
push(h1('壹、目的與適用範圍'));
push(h2('一、目的'));
push(body('本手冊規範「土肉桂修枝矮化及施肥對生長影響之研究」永久樣區之下一期（第四期）複查作業，目的在確保各期調查之量測部位、量測方法、資料登錄與品質管制具一致性與可重複性，使跨期生長量（直徑、樹高增量）、枯死率、進界木與碳貯存變化之推估符合測量、報告、查證（MRV）與透明、一致、可比、完整、準確（TACCC）原則。'));
push(h2('二、適用範圍'));
push(li('1.', '適用對象：本研究全部 4 處樣區、共 16 個樣區—處理單元之每木複查。'));
push(li('2.', '適用人員：現場調查人員（含協助調查之學生）、資料登錄人員、品管複核人員。'));
push(li('3.', '適用系統：森林監測平臺 ForestMRV（網址 forestry-rs-monitor.web.app）之永久樣區複查（路 I）功能。'));
push(body([{ t: '本研究樹種為土肉桂（' }, SCI, { t: '），全區單一樹種。' }]));

// 貳
push(h1('貳、試驗設計與樣區概況'));
push(h2('一、試驗設計'));
push(body('本研究採二因子析因配置加對照，二因子為「修剪矮化」與「施肥」，共 4 種處理：對照（C0）、修剪矮化（P1）、施肥 150 公克（F150）、修剪加施肥（P1F150）。4 處樣區各完整配置上述 4 種處理，形成 16 個樣區—處理單元，每單元定期監測同一批永久標記之樣木。'));
push(h2('二、樣區概況'));
push(body('本研究樣區分為兩類立地：成熟林 1 處（樣區 115121，15—20 年生）與幼齡林 3 處（樣區 117218、811、8110，1—2 年生）。兩類立地之徑級量測部位不同，詳見第陸章。各樣區基本資料見附錄一。'));
push(h2('三、量測部位規定'));
push(li('1.', '成熟林（樣區 115121）：量測胸高直徑（DBH），量測高度為樹幹基部往上 1.3 公尺處。'));
push(li('2.', '幼齡林（樣區 117218、811、8110）：因苗木未達胸高，量測地際直徑（地徑），量測位置為根頸（地際）。'));
push(li('3.', '不同量測部位之徑值不得相互併算生物量；幼齡地徑於系統內標記為地徑（basal），本期暫不換算材積與碳量，僅累計斷面積與生長量。'));
push(h2('四、多莖（萌蘗）處理原則'));
push(li('1.', '土肉桂常見萌蘗多莖，同一樣木之各莖均須逐莖量測直徑與樹高。'));
push(li('2.', '系統以二次平均徑彙整同株各莖為單一代表徑，計算式為 Dq 等於各莖直徑平方和除以莖數後取平方根；代表樹高採各莖樹高之算術平均。'));
push(li('3.', '材積、斷面積與碳量採「逐莖計算後加總」為整株值，避免以代表徑低估多莖整株量。'));

// 參
push(h1('參、調查時程與期別'));
push(body('本研究已完成前三期複查：第一期（114Q3）、第二期（114Q4）、第三期（115Q1）。本手冊適用之下一期為第四期（115Q2）。各期調查宜維持約一季之間隔，以利年均生長量推估；實際調查日期以現場排定並回填系統為準。'));
push(tcap('表 3-1 各期別對照'));
push(table([1600, 2200, 2600, 2626], [
  ['期別', '季別代碼', '推定/實際調查日', '狀態'],
  ['第一期', '114Q3', '2025-09-30', '已完成'],
  ['第二期', '114Q4', '2025-12-31', '已完成'],
  ['第三期', '115Q1', '2026-03-31', '已完成'],
  ['第四期', '115Q2', '2026-06-30（推定，待現場排定）', '本期辦理'],
]));

// 肆
push(h1('肆、調查前準備'));
push(h2('一、人員編組與分工'));
push(li('1.', '每組以 2 至 3 人為原則：1 人量測、1 人讀數與紙本記錄、1 人系統登錄或照相。'));
push(li('2.', '指派 1 名品管複核人員，負責當日抽樣複測與資料核對。'));
push(h2('二、器材清單'));
push(body('出發前依附錄四逐項檢核。基本器材包含：徑帶或輪尺、雷射測高儀或測高桿、捲尺、噴漆或樹牌補釘、行動裝置（已安裝瀏覽器並可連線 ForestMRV）、紙本野外記錄表（附錄五）、相機、定位輔助工具及個人防護裝備。'));
push(h2('三、系統端準備'));
push(li('1.', '由主持人或系統管理員於 ForestMRV 進入本專案，於各樣區詳情頁之「期別」區點選「開啟新一期複查」，建立第四期；系統將凍結前一期測值並以該期為當期採集。', 0));
push(li('2.', '於期別區點選「列印複查野外清單」，印出帶有上期值（上期直徑、樹高、活力、期距）之逐棵核對清單，作為現場底稿。', 0));
push(li('3.', '確認各樣區之量測部位設定（成熟林為胸徑、幼齡林為地徑）無誤。', 0));

// 伍
push(h1('伍、現場調查作業程序'));
push(body('以樣區—處理單元為單位，依列印之複查野外清單逐棵進行，程序如下。'));
push(h2('一、立木定位與身分核對'));
push(li('1.', '依清單之樣木編號（格式為樣區代碼—處理—流水號，例如 115121-C0-001）找到對應樹牌。'));
push(li('2.', '核對樹種與位置；樹牌脫落或字跡不清者，依原編號補釘新牌，並於系統標記為樹牌脫落以利後續查核。'));
push(h2('二、直徑量測'));
push(li('1.', '成熟林於 1.3 公尺胸高處、幼齡林於地際，以徑帶或輪尺量測，讀數至 0.1 公分。'));
push(li('2.', '量測位置應與上期一致；遇分叉、瘤節或傾斜木，依標準作法於規定高度上方平整處量測，並於備註說明。'));
push(li('3.', '多莖樣木逐莖量測，記錄各莖直徑。'));
push(h2('三、樹高量測'));
push(li('1.', '以雷射測高儀或測高桿量測全高，讀數至 0.1 公尺。'));
push(li('2.', '多莖樣木逐莖量測樹高；系統代表樹高採各莖算術平均。'));
push(h2('四、活力與狀態判定'));
push(li('1.', '存活木：依健康、衰弱判定活力等級。'));
push(li('2.', '枯死木：判定為枯立或倒伏，系統狀態記為枯死；該期直徑與樹高留空。'));
push(li('3.', '進界木：本期新達標或新出現之個體，記為進界，並記錄其進界期別。'));
push(li('4.', '失蹤木：經清單比對仍無法尋獲者，記為失蹤，不可逕以枯死或新木替代。'));
push(body('附註：第三期（115Q1）幼齡樣區已出現枯死個體，第四期應特別留意苗木存活情形，確實判別枯死、失蹤與進界，避免污染枯死率與進界木統計。'));
push(h2('五、影像紀錄'));
push(li('1.', '每樣區—處理單元至少拍攝整體景觀照 1 張；異常或枯死個體須個別拍照存證。'));
push(li('2.', '照片宜含可辨識之樣木編號或樹牌。'));

// 陸
push(h1('陸、量測規範與精度'));
push(tcap('表 6-1 量測項目與精度規範'));
push(table([2200, 2400, 2200, 2226], [
  ['量測項目', '部位/方法', '單位/精度', '備註'],
  ['直徑（成熟林）', '胸高 1.3 m，徑帶/輪尺', '公分，至 0.1', '與上期同位量測'],
  ['直徑（幼齡林）', '地際（根頸）', '公分，至 0.1', '地徑，勿與胸徑併算'],
  ['樹高', '雷射測高儀/測高桿', '公尺，至 0.1', '全高'],
  ['多莖', '逐莖量測', '同上', '系統以 Dq 與平均樹高彙整'],
  ['活力/狀態', '目視判定', '等級/狀態碼', '見附錄三'],
]));
push(body('量測誤差容許值（供品管參考）：直徑容許差以 ±0.3 公分為原則，樹高容許差以 ±5% 為原則；逾容許者應重新量測。'));

// 柒
push(h1('柒、系統登錄程序（ForestMRV）'));
push(h2('一、登入與進入樣區'));
push(li('1.', '以授權帳號登入 ForestMRV，進入本專案後選取目標樣區，確認當期為第四期。'));
push(h2('二、立木表單登錄與上期值核對'));
push(li('1.', '於「立木調查」分頁，點選目標樣木開啟表單；系統於表單頂端顯示「上期面板」（上期直徑、樹高、活力、期距）供現場核對。'));
push(li('2.', '輸入本期直徑、樹高、活力與狀態。系統即時顯示與上期之直徑、樹高變化量並於異常增減時給予軟提示（不阻擋存檔，僅供核對）。'));
push(li('3.', '多莖樣木逐莖輸入；枯死木將直徑、樹高留空並選取枯死狀態。'));
push(h2('三、重號與座標防呆'));
push(li('1.', '新增立木時，若與同樣區既有樣木編號重複，系統於複查期將導向「重測既有立木」，第一期則直接擋下，避免同株重複計數。'));
push(li('2.', '本研究樣木無逐株座標，毋須輸入定位座標；如誤填超出合理範圍之座標，系統將於儲存時攔截。'));
push(h2('四、即時計算與歷期檢視'));
push(li('1.', '存檔時系統依樹種材積式即時計算斷面積、材積與碳量並凍結為當期歷史測值（幼齡地徑僅計斷面積）。'));
push(li('2.', '於立木清單點選各樣木之「歷期」按鈕，可檢視該樹歷次（第一期至本期）之直徑、樹高、活力與碳量逐期值，供現場合理性研判。'));

// 捌
push(h1('捌、品質管制（QAQC）'));
push(li('1.', '抽樣複測：每樣區—處理單元由品管人員隨機抽取至少 10% 樣木重新量測，與原值比對。'));
push(li('2.', '誤差判定：超出第陸章容許值者，會同原量測人員確認後更正。'));
push(li('3.', '完整性檢核：對照複查野外清單，確認上期所有樣木均有本期結果（存活、枯死、失蹤或進界其一），無遺漏。'));
push(li('4.', '一致性檢核：確認量測部位、單位與多莖處理符合本手冊規定。'));
push(li('5.', '簽核：當日調查與複核完成後，由品管人員簽署紙本記錄表，並於系統確認登錄完成。'));

// 玖
push(h1('玖、資料彙整、報表與備份'));
push(li('1.', '全部樣區登錄完成後，於專案「儀表板」分頁之「複查成長報表（I-6）」點選「產生複查報表」，檢視期別摘要（活立木數、平均直徑、總斷面積、總材積、活碳）與期間轉換（年均直徑與樹高增量、枯死率、進界木、淨碳變化）。'));
push(li('2.', '經研判數據合理後，匯出複查報表 CSV 留存。'));
push(li('3.', '紙本記錄表掃描歸檔；影像依樣區與期別分類保存。'));
push(li('4.', '資料正本以雲端資料庫為準，本機僅作工作副本，避免單點遺失。'));

// 拾
push(h1('拾、安全與注意事項'));
push(li('1.', '山區作業注意地形、落石與天候，避免單獨行動，並告知行程與預計返回時間。'));
push(li('2.', '注意虎頭蜂、蛇類及有毒植物；攜帶基本急救用品。'));
push(li('3.', '量測器材（輪尺、測高儀）使用後檢查歸位，避免遺落於樣區。'));
push(li('4.', '尊重林地與承租人權益，作業後恢復現場、不留垃圾。'));

// 附錄
push(new Paragraph({ children: [new PageBreak()] }));
push(h1('附錄'));
push(h2('附錄一　樣區基本資料表'.replace(/　/g, ' ')));
push(table([1500, 3000, 2100, 1226, 1200], [
  ['樣區代碼', '事業區・林班（假地號）', '林型（齡級）', '量測部位', '面積(ha)'],
  ['115121', '大安溪事業區 115 林班假 12 號', '成熟林（15—20 年生）', '胸徑', '0.5'],
  ['117218', '大安溪事業區 117 林班假 28 號', '幼齡林（1—2 年生）', '地徑', '0.355'],
  ['811', '八仙山事業區 8 林班假 1 號', '幼齡林（1—2 年生）', '地徑', '0.2372'],
  ['8110', '八仙山事業區 8 林班假 1 號-10', '幼齡林（1—2 年生）', '地徑', '0.4482'],
]));
push(plain('附註：各樣區均配置 C0、P1、F150、P1F150 四處理，合計 16 個樣區—處理單元。', { spacing: { before: 60, after: 120 } }));

push(h2('附錄二　處理代碼與析因因子'.replace(/　/g, ' ')));
push(table([1500, 2600, 1700, 1700], [
  ['處理代碼', '處理內容', '修剪（0/1）', '施肥（公克）'],
  ['C0', '對照', '0', '0'],
  ['P1', '修剪矮化', '1', '0'],
  ['F150', '施肥 150 公克', '0', '150'],
  ['P1F150', '修剪加施肥', '1', '150'],
]));

push(h2('附錄三　立木狀態碼對照表'.replace(/　/g, ' ')));
push(table([2200, 2400, 4426], [
  ['類別', '狀態', '說明與作業'],
  ['活力', '健康／衰弱', '存活木依目視判定活力等級'],
  ['複查命運', '存活', '兩期皆活，計入生長量'],
  ['複查命運', '枯死', '枯立或倒伏；直徑、樹高留空'],
  ['複查命運', '進界', '本期新出現/新達標；記錄進界期別'],
  ['複查命運', '失蹤', '無法尋獲；不得以枯死或新木替代'],
  ['身分', '樹牌脫落', '依原編號補釘新牌並標記'],
]));

push(h2('附錄四　器材檢核清單'.replace(/　/g, ' ')));
push(table([4513, 4513], [
  ['項目', '檢核（□）'],
  ['徑帶／輪尺', '□'],
  ['雷射測高儀／測高桿', '□'],
  ['捲尺、噴漆、樹牌與補釘', '□'],
  ['行動裝置（可連線 ForestMRV）與電源', '□'],
  ['複查野外清單（已列印）', '□'],
  ['紙本野外記錄表（附錄五）', '□'],
  ['相機／攝影設備', '□'],
  ['急救用品與個人防護裝備', '□'],
]));

push(h2('附錄五　野外記錄表（紙本備援）'.replace(/　/g, ' ')));
push(plain('樣區—處理：____________   調查日期：____________   記錄人：____________', { spacing: { before: 60, after: 100 } }));
push(table([1700, 1100, 1100, 1100, 1400, 1626], [
  ['樣木編號', '莖序', '直徑(cm)', '樹高(m)', '活力/狀態', '備註'],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
]));
push(plain('附註：本表為連線異常時之紙本備援，回程後須將資料補登 ForestMRV。', { spacing: { before: 80 } }));

// 封面標題放大（重建為較大字級）
const coverDocChildren = [
  new Paragraph({ children: [cr('', 24)], spacing: { before: 1700 } }),
  centerRuns([cr('林業及自然保育署臺中分署', 26)], { spacing: { after: 80 } }),
  centerRuns([cr('114—115 年林業永續多元輔導計畫', 24)], { spacing: { after: 60 } }),
  rule({ spacing: { before: 80, after: 520 } }),
  centerRuns([cr('土肉桂修枝矮化及施肥', 36, true)], { spacing: { after: 60 } }),
  centerRuns([cr('對生長影響之研究', 36, true)], { spacing: { after: 420 } }),
  centerRuns([cr('下一期（第四期）樣區調查', 30, true)], { spacing: { after: 60 } }),
  centerRuns([cr('作業程序手冊', 30, true)], { spacing: { after: 240 } }),
  centerRuns([cr('—— 永久樣區複查標準作業程序（SOP）——', 24)], { spacing: { after: 200 } }),
  centerRuns([
    new TextRun({ text: '研究樹種：土肉桂 ', size: 22, font: CJK }),
    new TextRun({ text: 'Cinnamomum osmophloeum', size: 22, italics: true, font: CJK }),
  ], { spacing: { after: 1500 } }),
  rule({ spacing: { before: 200, after: 200 } }),
  centerRuns([cr('版　本：第 1.0 版'.replace('　', ' '), 24)], { spacing: { after: 80 } }),
  centerRuns([cr('編製日期：中華民國 115 年 6 月', 24)], { spacing: { after: 80 } }),
  centerRuns([cr('適用期別：第四期複查（115Q2；推定調查日 2026-06-30，實際依現場排定）', 22)], { spacing: { after: 80 } }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  styles: { default: { document: { run: { font: CJK, size: 24 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '第 ', size: 20 }), new TextRun({ children: [PageNumber.CURRENT], size: 20 }), new TextRun({ text: ' 頁', size: 20 })] })] }) },
    children: [...coverDocChildren, ...content],
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync(OUT, buf); console.log('written:', OUT, buf.length, 'bytes'); });
