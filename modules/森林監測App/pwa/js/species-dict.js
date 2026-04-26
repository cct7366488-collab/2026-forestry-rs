// ===== species-dict.js — v2.0 物種字典（樹種 / 動物 / 草本 / 入侵種）=====
// 與 species-equations.js 分工：本檔只放名單，equations 放計算公式。
// 引用方式：import { TREES, ANIMALS, HERBS, INVASIVE_PLANTS, isInvasive, findHerb, findAnimal } from './species-dict.js';

// ===== 樹種（從 forms.js 抽出，v1.1 ~100 種台灣常見木本）=====
export const TREES = [
  // 針葉 - 杉科
  { zh: '台灣杉', sci: 'Taiwania cryptomerioides', cons: null },
  { zh: '柳杉', sci: 'Cryptomeria japonica', cons: null },
  { zh: '杉木', sci: 'Cunninghamia lanceolata', cons: null },
  { zh: '香杉', sci: 'Cunninghamia konishii', cons: null },
  // 針葉 - 柏科
  { zh: '紅檜', sci: 'Chamaecyparis formosensis', cons: null },
  { zh: '台灣扁柏', sci: 'Chamaecyparis obtusa var. formosana', cons: null },
  { zh: '台灣肖楠', sci: 'Calocedrus macrolepis var. formosana', cons: null },
  { zh: '玉山圓柏', sci: 'Juniperus squamata', cons: null },
  // 針葉 - 松科
  { zh: '台灣二葉松', sci: 'Pinus taiwanensis', cons: null },
  { zh: '台灣五葉松', sci: 'Pinus morrisonicola', cons: null },
  { zh: '台灣鐵杉', sci: 'Tsuga chinensis var. formosana', cons: null },
  { zh: '台灣冷杉', sci: 'Abies kawakamii', cons: null },
  { zh: '台灣雲杉', sci: 'Picea morrisonicola', cons: null },
  { zh: '濕地松', sci: 'Pinus elliottii', cons: null },
  { zh: '琉球松', sci: 'Pinus luchuensis', cons: null },
  // 針葉 - 紅豆杉科
  { zh: '台灣油杉', sci: 'Keteleeria davidiana var. formosana', cons: 'I' },
  { zh: '台灣穗花杉', sci: 'Amentotaxus formosana', cons: 'I' },
  { zh: '台灣紅豆杉', sci: 'Taxus mairei', cons: 'II' },
  { zh: '蘭嶼羅漢松', sci: 'Podocarpus costalis', cons: 'II' },
  // 闊葉 - 樟科
  { zh: '牛樟', sci: 'Cinnamomum kanehirae', cons: 'II' },
  { zh: '樟樹', sci: 'Cinnamomum camphora', cons: null },
  { zh: '土肉桂', sci: 'Cinnamomum osmophloeum', cons: null },
  { zh: '香桂', sci: 'Cinnamomum subavenium', cons: null },
  { zh: '陰香', sci: 'Cinnamomum burmannii', cons: null },
  { zh: '紅楠', sci: 'Machilus thunbergii', cons: null },
  { zh: '大葉楠', sci: 'Machilus japonica var. kusanoi', cons: null },
  { zh: '香楠', sci: 'Machilus zuihoensis', cons: null },
  // 闊葉 - 殼斗科
  { zh: '青剛櫟', sci: 'Cyclobalanopsis glauca', cons: null },
  { zh: '赤皮', sci: 'Cyclobalanopsis gilva', cons: null },
  { zh: '長尾尖葉櫧', sci: 'Castanopsis cuspidata var. carlesii', cons: null },
  { zh: '印度栲', sci: 'Castanopsis indica', cons: null },
  { zh: '小西氏石櫟', sci: 'Lithocarpus konishii', cons: null },
  { zh: '油葉石櫟', sci: 'Lithocarpus konishii var. lanceolatus', cons: null },
  { zh: '三斗石櫟', sci: 'Pasania hancei', cons: null },
  { zh: '槲櫟', sci: 'Quercus aliena', cons: null },
  // 闊葉 - 木蘭科
  { zh: '烏心石', sci: 'Michelia compressa', cons: null },
  // 闊葉 - 桑科
  { zh: '雀榕', sci: 'Ficus superba var. japonica', cons: null },
  { zh: '榕樹', sci: 'Ficus microcarpa', cons: null },
  { zh: '大葉雀榕', sci: 'Ficus caulocarpa', cons: null },
  { zh: '稜果榕', sci: 'Ficus septica', cons: null },
  { zh: '牛奶榕', sci: 'Ficus erecta var. beecheyana', cons: null },
  // 闊葉 - 楝科
  { zh: '苦楝', sci: 'Melia azedarach', cons: null },
  { zh: '大葉桃花心木', sci: 'Swietenia macrophylla', cons: null },
  { zh: '桃花心木', sci: 'Swietenia mahagoni', cons: null },
  { zh: '紅椿', sci: 'Toona sureni', cons: null },
  { zh: '香椿', sci: 'Toona sinensis', cons: null },
  // 闊葉 - 大戟科
  { zh: '烏桕', sci: 'Sapium sebiferum', cons: null },
  { zh: '茄苳', sci: 'Bischofia javanica', cons: null },
  { zh: '血桐', sci: 'Macaranga tanarius', cons: null },
  { zh: '蟲屎', sci: 'Melanolepis multiglandulosa', cons: null },
  // 闊葉 - 漆樹科
  { zh: '黃連木', sci: 'Pistacia chinensis', cons: null },
  { zh: '羅氏鹽膚木', sci: 'Rhus chinensis var. roxburghii', cons: null },
  { zh: '山漆', sci: 'Rhus succedanea', cons: null },
  // 闊葉 - 楓樹科
  { zh: '青楓', sci: 'Acer serrulatum', cons: null },
  { zh: '樟葉楓', sci: 'Acer albopurpurascens', cons: null },
  { zh: '尖葉槭', sci: 'Acer kawakamii', cons: null },
  { zh: '台灣三角楓', sci: 'Acer buergerianum var. formosanum', cons: null },
  // 闊葉 - 榆科
  { zh: '櫸木', sci: 'Zelkova serrata', cons: null },
  { zh: '台灣櫸', sci: 'Zelkova serrata var. tarokoensis', cons: null },
  { zh: '山黃麻', sci: 'Trema orientalis', cons: null },
  { zh: '朴樹', sci: 'Celtis sinensis', cons: null },
  { zh: '沙朴', sci: 'Celtis formosana', cons: null },
  // 闊葉 - 樺木科 / 桃金孃科
  { zh: '台灣赤楊', sci: 'Alnus formosana', cons: null },
  { zh: '台灣赤楠', sci: 'Syzygium formosanum', cons: null },
  { zh: '賽赤楠', sci: 'Syzygium tetragonum', cons: null },
  { zh: '蓮霧', sci: 'Syzygium samarangense', cons: null },
  // 闊葉 - 蝶形花科
  { zh: '相思樹', sci: 'Acacia confusa', cons: null },
  { zh: '大葉合歡', sci: 'Albizia lebbeck', cons: null },
  { zh: '印度紫檀', sci: 'Pterocarpus indicus', cons: null },
  { zh: '大葉相思', sci: 'Acacia mangium', cons: null },
  // 闊葉 - 木麻黃科 / 桉樹
  { zh: '木麻黃', sci: 'Casuarina equisetifolia', cons: null },
  { zh: '桉樹', sci: 'Eucalyptus robusta', cons: null },
  { zh: '檸檬桉', sci: 'Corymbia citriodora', cons: null },
  // 闊葉 - 杜英科 / 五加科 / 山茶科
  { zh: '猴歡喜', sci: 'Sloanea formosana', cons: null },
  { zh: '杜英', sci: 'Elaeocarpus sylvestris', cons: null },
  { zh: '鵝掌柴', sci: 'Schefflera octophylla', cons: null },
  { zh: '木荷', sci: 'Schima superba', cons: null },
  { zh: '油茶', sci: 'Camellia oleifera', cons: null },
  // 闊葉 - 安息香 / 千屈菜 / 金縷梅 / 木犀
  { zh: '烏皮九芎', sci: 'Styrax suberifolia', cons: null },
  { zh: '紅皮', sci: 'Styrax tonkinensis', cons: null },
  { zh: '九芎', sci: 'Lagerstroemia subcostata', cons: null },
  { zh: '大花紫薇', sci: 'Lagerstroemia speciosa', cons: null },
  { zh: '楓香', sci: 'Liquidambar formosana', cons: null },
  { zh: '光蠟樹', sci: 'Fraxinus formosana', cons: null },
  { zh: '小葉白蠟樹', sci: 'Fraxinus floribunda', cons: null },
  // 闊葉 - 無患子 / 山欖 / 紫葳 / 海桐
  { zh: '無患子', sci: 'Sapindus mukorossi', cons: null },
  { zh: '台灣欒樹', sci: 'Koelreuteria henryi', cons: null },
  { zh: '荔枝', sci: 'Litchi chinensis', cons: null },
  { zh: '龍眼', sci: 'Dimocarpus longan', cons: null },
  { zh: '山欖', sci: 'Planchonella obovata', cons: null },
  { zh: '黃花風鈴木', sci: 'Tabebuia chrysantha', cons: null },
  { zh: '藍花楹', sci: 'Jacaranda mimosifolia', cons: null },
  { zh: '台灣海桐', sci: 'Pittosporum pentandrum', cons: null },
  // 紅樹林
  { zh: '海茄苳', sci: 'Avicennia marina', cons: null },
  { zh: '紅海欖', sci: 'Rhizophora stylosa', cons: null },
  { zh: '水筆仔', sci: 'Kandelia obovata', cons: null },
  { zh: '欖李', sci: 'Lumnitzera racemosa', cons: null },
  // 經濟果樹
  { zh: '芒果', sci: 'Mangifera indica', cons: null }
];

// ===== 動物字典（v2.0 新增）=====
// group: '哺乳類' | '鳥類' | '爬蟲類' | '兩棲類' | '蝶類' | '其他無脊椎'
// cons: I/II/III（依 2019 修訂保育類名錄）/ null
export const ANIMALS = [
  // ===== 哺乳類 =====
  { zh: '台灣獼猴', sci: 'Macaca cyclopis', group: '哺乳類', cons: 'III' },
  { zh: '台灣黑熊', sci: 'Ursus thibetanus formosanus', group: '哺乳類', cons: 'I' },
  { zh: '石虎', sci: 'Prionailurus bengalensis chinensis', group: '哺乳類', cons: 'I' },
  { zh: '穿山甲', sci: 'Manis pentadactyla pentadactyla', group: '哺乳類', cons: 'II' },
  { zh: '台灣野山羊', sci: 'Capricornis swinhoei', group: '哺乳類', cons: 'III' },
  { zh: '水鹿', sci: 'Rusa unicolor swinhoei', group: '哺乳類', cons: 'III' },
  { zh: '山羌', sci: 'Muntiacus reevesi micrurus', group: '哺乳類', cons: null },
  { zh: '山豬', sci: 'Sus scrofa taivanus', group: '哺乳類', cons: null },
  { zh: '白鼻心', sci: 'Paguma larvata taivana', group: '哺乳類', cons: 'III' },
  { zh: '麝香貓', sci: 'Viverricula indica taivana', group: '哺乳類', cons: 'III' },
  { zh: '鼬獾', sci: 'Melogale moschata subaurantiaca', group: '哺乳類', cons: null },
  { zh: '黃喉貂', sci: 'Martes flavigula chrysospila', group: '哺乳類', cons: 'III' },
  { zh: '台灣野兔', sci: 'Lepus sinensis formosanus', group: '哺乳類', cons: null },
  { zh: '赤腹松鼠', sci: 'Callosciurus erythraeus', group: '哺乳類', cons: null },
  { zh: '條紋松鼠', sci: 'Tamiops maritimus formosanus', group: '哺乳類', cons: null },
  { zh: '大赤鼯鼠', sci: 'Petaurista philippensis grandis', group: '哺乳類', cons: null },
  { zh: '白面鼯鼠', sci: 'Petaurista alborufus lena', group: '哺乳類', cons: null },
  { zh: '小黃腹鼠', sci: 'Niviventer culturatus', group: '哺乳類', cons: null },
  { zh: '刺鼠', sci: 'Niviventer coninga', group: '哺乳類', cons: null },
  { zh: '台灣狐蝠', sci: 'Pteropus dasymallus formosus', group: '哺乳類', cons: 'I' },

  // ===== 鳥類 =====
  { zh: '台灣藍鵲', sci: 'Urocissa caerulea', group: '鳥類', cons: 'III' },
  { zh: '帝雉', sci: 'Syrmaticus mikado', group: '鳥類', cons: 'II' },
  { zh: '藍腹鷴', sci: 'Lophura swinhoii', group: '鳥類', cons: 'II' },
  { zh: '台灣山鷓鴣', sci: 'Arborophila crudigularis', group: '鳥類', cons: 'III' },
  { zh: '深山竹雞', sci: 'Bambusicola sonorivox', group: '鳥類', cons: null },
  { zh: '台灣竹雞', sci: 'Bambusicola thoracica', group: '鳥類', cons: null },
  { zh: '大冠鷲', sci: 'Spilornis cheela hoya', group: '鳥類', cons: 'II' },
  { zh: '林鵰', sci: 'Ictinaetus malaiensis', group: '鳥類', cons: 'I' },
  { zh: '熊鷹', sci: 'Nisaetus nipalensis', group: '鳥類', cons: 'I' },
  { zh: '黃魚鴞', sci: 'Ketupa flavipes', group: '鳥類', cons: 'II' },
  { zh: '領角鴞', sci: 'Otus lettia', group: '鳥類', cons: 'II' },
  { zh: '褐林鴞', sci: 'Strix leptogrammica', group: '鳥類', cons: 'II' },
  { zh: '黃嘴角鴞', sci: 'Otus spilocephalus', group: '鳥類', cons: 'II' },
  { zh: '鵂鶹', sci: 'Glaucidium brodiei', group: '鳥類', cons: 'II' },
  { zh: '紅頭咬鵑', sci: 'Harpactes erythrocephalus', group: '鳥類', cons: 'II' },
  { zh: '五色鳥', sci: 'Psilopogon nuchalis', group: '鳥類', cons: null },
  { zh: '繡眼畫眉', sci: 'Alcippe morrisonia', group: '鳥類', cons: null },
  { zh: '白耳畫眉', sci: 'Heterophasia auricularis', group: '鳥類', cons: null },
  { zh: '冠羽畫眉', sci: 'Yuhina brunneiceps', group: '鳥類', cons: null },
  { zh: '紋翼畫眉', sci: 'Actinodura morrisoniana', group: '鳥類', cons: null },
  { zh: '頭烏線', sci: 'Schoeniparus brunneus', group: '鳥類', cons: null },
  { zh: '黃胸藪眉', sci: 'Liocichla steerii', group: '鳥類', cons: null },
  { zh: '青背山雀', sci: 'Parus monticolus', group: '鳥類', cons: null },
  { zh: '黃山雀', sci: 'Machlolophus holsti', group: '鳥類', cons: 'II' },
  { zh: '紅頭山雀', sci: 'Aegithalos concinnus', group: '鳥類', cons: null },
  { zh: '紅嘴黑鵯', sci: 'Hypsipetes leucocephalus', group: '鳥類', cons: null },
  { zh: '白頭翁', sci: 'Pycnonotus sinensis', group: '鳥類', cons: null },
  { zh: '樹鵲', sci: 'Dendrocitta formosae', group: '鳥類', cons: null },
  { zh: '紫嘯鶇', sci: 'Myophonus insularis', group: '鳥類', cons: null },
  { zh: '栗背林鴝', sci: 'Tarsiger johnstoniae', group: '鳥類', cons: null },
  { zh: '黃尾鴝', sci: 'Phoenicurus auroreus', group: '鳥類', cons: null },
  { zh: '台灣戴菊', sci: 'Regulus goodfellowi', group: '鳥類', cons: null },
  { zh: '紅胸啄花', sci: 'Dicaeum ignipectus', group: '鳥類', cons: null },
  { zh: '綠繡眼', sci: 'Zosterops japonicus', group: '鳥類', cons: null },
  { zh: '小彎嘴', sci: 'Pomatorhinus musicus', group: '鳥類', cons: null },
  { zh: '大彎嘴', sci: 'Erythrogenys erythrocnemis', group: '鳥類', cons: null },
  { zh: '紅尾伯勞', sci: 'Lanius cristatus', group: '鳥類', cons: 'III' },
  { zh: '棕面鶯', sci: 'Abroscopus albogularis', group: '鳥類', cons: null },
  { zh: '紅鳩', sci: 'Streptopelia tranquebarica', group: '鳥類', cons: null },
  { zh: '珠頸斑鳩', sci: 'Spilopelia chinensis', group: '鳥類', cons: null },
  { zh: '小啄木', sci: 'Yungipicus canicapillus', group: '鳥類', cons: null },
  { zh: '大赤啄木', sci: 'Dendrocopos leucotos', group: '鳥類', cons: null },

  // ===== 爬蟲類 =====
  { zh: '百步蛇', sci: 'Deinagkistrodon acutus', group: '爬蟲類', cons: 'II' },
  { zh: '龜殼花', sci: 'Protobothrops mucrosquamatus', group: '爬蟲類', cons: null },
  { zh: '青竹絲', sci: 'Trimeresurus stejnegeri', group: '爬蟲類', cons: null },
  { zh: '雨傘節', sci: 'Bungarus multicinctus', group: '爬蟲類', cons: null },
  { zh: '眼鏡蛇', sci: 'Naja atra', group: '爬蟲類', cons: 'II' },
  { zh: '攀木蜥蜴', sci: 'Diploderma swinhonis', group: '爬蟲類', cons: null },
  { zh: '麗紋石龍子', sci: 'Plestiodon elegans', group: '爬蟲類', cons: null },
  { zh: '食蛇龜', sci: 'Cuora flavomarginata', group: '爬蟲類', cons: 'II' },
  { zh: '柴棺龜', sci: 'Mauremys mutica', group: '爬蟲類', cons: 'II' },
  { zh: '斑龜', sci: 'Mauremys sinensis', group: '爬蟲類', cons: 'III' },

  // ===== 兩棲類 =====
  { zh: '盤古蟾蜍', sci: 'Bufo bankorensis', group: '兩棲類', cons: null },
  { zh: '莫氏樹蛙', sci: 'Rhacophorus moltrechti', group: '兩棲類', cons: null },
  { zh: '台北樹蛙', sci: 'Rhacophorus taipeianus', group: '兩棲類', cons: 'III' },
  { zh: '面天樹蛙', sci: 'Kurixalus idiootocus', group: '兩棲類', cons: null },
  { zh: '橙腹樹蛙', sci: 'Rhacophorus aurantiventris', group: '兩棲類', cons: 'II' },
  { zh: '翡翠樹蛙', sci: 'Rhacophorus prasinatus', group: '兩棲類', cons: 'III' },
  { zh: '斯文豪氏赤蛙', sci: 'Odorrana swinhoana', group: '兩棲類', cons: null },
  { zh: '長腳赤蛙', sci: 'Rana longicrus', group: '兩棲類', cons: null },
  { zh: '澤蛙', sci: 'Fejervarya limnocharis', group: '兩棲類', cons: null },
  { zh: '貢德氏赤蛙', sci: 'Hylarana guentheri', group: '兩棲類', cons: null },

  // ===== 蝶類 =====
  { zh: '寬尾鳳蝶', sci: 'Papilio maraho', group: '蝶類', cons: 'I' },
  { zh: '黃裳鳳蝶', sci: 'Troides aeacus formosanus', group: '蝶類', cons: 'II' },
  { zh: '珠光黃裳鳳蝶', sci: 'Troides magellanus', group: '蝶類', cons: 'I' },
  { zh: '青斑蝶', sci: 'Tirumala limniace', group: '蝶類', cons: null },
  { zh: '紋白蝶', sci: 'Pieris rapae', group: '蝶類', cons: null },
  { zh: '青鳳蝶', sci: 'Graphium sarpedon', group: '蝶類', cons: null },
  { zh: '大紅紋鳳蝶', sci: 'Byasa polyeuctes', group: '蝶類', cons: null },
  { zh: '紫斑蝶', sci: 'Euploea spp.', group: '蝶類', cons: null },
  { zh: '黑鳳蝶', sci: 'Papilio protenor', group: '蝶類', cons: null },
  { zh: '玉帶鳳蝶', sci: 'Papilio polytes', group: '蝶類', cons: null },

  // ===== 其他無脊椎 =====
  { zh: '黑翅螢', sci: 'Abscondita cerata', group: '其他無脊椎', cons: null },
  { zh: '黃緣螢', sci: 'Aquatica ficta', group: '其他無脊椎', cons: null },
  { zh: '獨角仙', sci: 'Allomyrina dichotoma', group: '其他無脊椎', cons: null },
  { zh: '長臂金龜', sci: 'Cheirotonus formosanus', group: '其他無脊椎', cons: 'II' },
  { zh: '津田氏大頭竹節蟲', sci: 'Megacrania tsudai', group: '其他無脊椎', cons: 'II' }
];

// ===== 草本/蕨類/苔蘚字典（v2.0 新增 — 地被植物用）=====
// lifeForm: '草本' | '蕨類' | '苔蘚' | '藤本' | '灌木幼株'
// isInvasive: 是否為公告外來入侵種
export const HERBS = [
  // ===== 禾本科 =====
  { zh: '芒草', sci: 'Miscanthus floridulus', lifeForm: '草本', isInvasive: false },
  { zh: '五節芒', sci: 'Miscanthus floridulus', lifeForm: '草本', isInvasive: false },
  { zh: '白茅', sci: 'Imperata cylindrica', lifeForm: '草本', isInvasive: false },
  { zh: '求米草', sci: 'Oplismenus compositus', lifeForm: '草本', isInvasive: false },
  { zh: '兩耳草', sci: 'Paspalum conjugatum', lifeForm: '草本', isInvasive: false },
  { zh: '牛筋草', sci: 'Eleusine indica', lifeForm: '草本', isInvasive: false },
  { zh: '狗牙根', sci: 'Cynodon dactylon', lifeForm: '草本', isInvasive: false },
  { zh: '巴拉草', sci: 'Brachiaria mutica', lifeForm: '草本', isInvasive: true },
  { zh: '紅毛草', sci: 'Melinis repens', lifeForm: '草本', isInvasive: true },

  // ===== 莎草科 =====
  { zh: '香附子', sci: 'Cyperus rotundus', lifeForm: '草本', isInvasive: false },
  { zh: '碎米莎草', sci: 'Cyperus iria', lifeForm: '草本', isInvasive: false },
  { zh: '單葉鹹草', sci: 'Cyperus malaccensis', lifeForm: '草本', isInvasive: false },

  // ===== 菊科 =====
  { zh: '大花咸豐草', sci: 'Bidens pilosa var. radiata', lifeForm: '草本', isInvasive: true },
  { zh: '咸豐草', sci: 'Bidens pilosa', lifeForm: '草本', isInvasive: false },
  { zh: '昭和草', sci: 'Crassocephalum crepidioides', lifeForm: '草本', isInvasive: false },
  { zh: '紫背草', sci: 'Emilia sonchifolia', lifeForm: '草本', isInvasive: false },
  { zh: '艾納香', sci: 'Blumea balsamifera', lifeForm: '草本', isInvasive: false },
  { zh: '台灣山菊', sci: 'Farfugium japonicum var. formosanum', lifeForm: '草本', isInvasive: false },
  { zh: '小花蔓澤蘭', sci: 'Mikania micrantha', lifeForm: '藤本', isInvasive: true },
  { zh: '香澤蘭', sci: 'Chromolaena odorata', lifeForm: '草本', isInvasive: true },
  { zh: '銀膠菊', sci: 'Parthenium hysterophorus', lifeForm: '草本', isInvasive: true },
  { zh: '霍香薊', sci: 'Ageratum conyzoides', lifeForm: '草本', isInvasive: false },
  { zh: '紫花霍香薊', sci: 'Ageratum houstonianum', lifeForm: '草本', isInvasive: true },

  // ===== 蕨類 =====
  { zh: '腎蕨', sci: 'Nephrolepis cordifolia', lifeForm: '蕨類', isInvasive: false },
  { zh: '芒萁', sci: 'Dicranopteris linearis', lifeForm: '蕨類', isInvasive: false },
  { zh: '伏石蕨', sci: 'Lemmaphyllum microphyllum', lifeForm: '蕨類', isInvasive: false },
  { zh: '海金沙', sci: 'Lygodium japonicum', lifeForm: '蕨類', isInvasive: false },
  { zh: '烏蕨', sci: 'Sphenomeris chinensis', lifeForm: '蕨類', isInvasive: false },
  { zh: '過溝菜蕨', sci: 'Diplazium esculentum', lifeForm: '蕨類', isInvasive: false },
  { zh: '貫眾蕨', sci: 'Cyrtomium fortunei', lifeForm: '蕨類', isInvasive: false },
  { zh: '鳳尾蕨', sci: 'Pteris multifida', lifeForm: '蕨類', isInvasive: false },
  { zh: '筆筒樹', sci: 'Sphaeropteris lepifera', lifeForm: '蕨類', isInvasive: false },
  { zh: '台灣桫欏', sci: 'Cyathea spinulosa', lifeForm: '蕨類', isInvasive: false },
  { zh: '烏毛蕨', sci: 'Blechnum orientale', lifeForm: '蕨類', isInvasive: false },
  { zh: '單葉新月蕨', sci: 'Pronephrium simplex', lifeForm: '蕨類', isInvasive: false },
  { zh: '瓦氏鱗毛蕨', sci: 'Dryopteris wallichiana', lifeForm: '蕨類', isInvasive: false },
  { zh: '崖薑蕨', sci: 'Pseudodrynaria coronans', lifeForm: '蕨類', isInvasive: false },
  { zh: '台灣金狗毛蕨', sci: 'Cibotium taiwanense', lifeForm: '蕨類', isInvasive: false },

  // ===== 苔蘚地衣 =====
  { zh: '泥炭蘚', sci: 'Sphagnum spp.', lifeForm: '苔蘚', isInvasive: false },
  { zh: '地錢', sci: 'Marchantia polymorpha', lifeForm: '苔蘚', isInvasive: false },
  { zh: '葫蘆蘚', sci: 'Funaria hygrometrica', lifeForm: '苔蘚', isInvasive: false },
  { zh: '羽蘚', sci: 'Thuidium spp.', lifeForm: '苔蘚', isInvasive: false },

  // ===== 藤本 =====
  { zh: '懸鉤子', sci: 'Rubus spp.', lifeForm: '藤本', isInvasive: false },
  { zh: '雞屎藤', sci: 'Paederia foetida', lifeForm: '藤本', isInvasive: false },
  { zh: '葛藤', sci: 'Pueraria lobata', lifeForm: '藤本', isInvasive: false },
  { zh: '台灣山葡萄', sci: 'Ampelopsis brevipedunculata', lifeForm: '藤本', isInvasive: false },
  { zh: '川七', sci: 'Anredera cordifolia', lifeForm: '藤本', isInvasive: true },
  { zh: '長穗木', sci: 'Stachytarpheta jamaicensis', lifeForm: '草本', isInvasive: true },

  // ===== 灌木幼株（地被高度）=====
  { zh: '山棕', sci: 'Arenga engleri', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '姑婆芋', sci: 'Alocasia odora', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '月桃', sci: 'Alpinia zerumbet', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '野牡丹', sci: 'Melastoma candidum', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '山黃梔', sci: 'Gardenia jasminoides', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '山香圓', sci: 'Turpinia formosana', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '燈稱花', sci: 'Ilex asprella', lifeForm: '灌木幼株', isInvasive: false },
  { zh: '馬纓丹', sci: 'Lantana camara', lifeForm: '灌木幼株', isInvasive: true },
  { zh: '銀合歡', sci: 'Leucaena leucocephala', lifeForm: '灌木幼株', isInvasive: true },
  { zh: '含羞草', sci: 'Mimosa pudica', lifeForm: '草本', isInvasive: true },
  { zh: '刺莧', sci: 'Amaranthus spinosus', lifeForm: '草本', isInvasive: false },
  { zh: '龍葵', sci: 'Solanum nigrum', lifeForm: '草本', isInvasive: false },
  { zh: '酸藤', sci: 'Ecdysanthera rosea', lifeForm: '藤本', isInvasive: false }
];

// ===== 外來入侵種公告名錄（林業署/農業部）=====
// 用於 understory 表單即時警示。從 HERBS 中 isInvasive=true 自動抽出 + 補充純名單。
export const INVASIVE_PLANTS = new Set([
  ...HERBS.filter(h => h.isInvasive).map(h => h.zh),
  // 補充：未在 HERBS 中、但 PI 可能自由輸入的入侵種
  '銀合歡', '小花蔓澤蘭', '香澤蘭', '大花咸豐草', '長穗木', '銀膠菊',
  '馬纓丹', '巴拉草', '紅毛草', '川七', '紫花霍香薊', '含羞草',
  '布袋蓮', '互花米草', '美洲含羞草', '含羞紫花苜蓿', '光冠水菊',
  '南美蟛蜞菊', '小花漏斗草', '美洲商陸', '加拿大蓬', '裂葉月見草',
  '長柄菊', '蒺藜草', '田菁', '毒魚藤', '五爪金英', '王爺葵',
  '飛機草', '美洲假蓬', '銀澤蘭'
]);

// ===== 查詢 helper =====
export function findTree(zh) { return TREES.find(s => s.zh === zh); }
export function findAnimal(zh) { return ANIMALS.find(s => s.zh === zh); }
export function findHerb(zh) { return HERBS.find(s => s.zh === zh); }
export function isInvasive(zh) { return INVASIVE_PLANTS.has(zh); }

// ===== 動物分組 helper（給 datalist 分群用）=====
export function animalsByGroup() {
  const out = {};
  for (const a of ANIMALS) {
    if (!out[a.group]) out[a.group] = [];
    out[a.group].push(a);
  }
  return out;
}

// ===== 草本分組 helper =====
export function herbsByLifeForm() {
  const out = {};
  for (const h of HERBS) {
    if (!out[h.lifeForm]) out[h.lifeForm] = [];
    out[h.lifeForm].push(h);
  }
  return out;
}
