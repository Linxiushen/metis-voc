/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildResearchDataAdapterRegistry } from "./research-data-adapters";
import { normalizeVocThemeBucket } from "./voc-evidence";

type JsonObject = Record<string, any>;

const table = (columns: string[], rows: any[][], note?: string) => ({
  columns,
  rows,
  ...(note ? { note } : {}),
});

export const STRATEGY_FRAMEWORK_VERSION = "2026-08-06.1-psychology-journey";

const METHODOLOGY_SOURCES = [
  {
    id: "METHOD-STP-SEGMENT",
    framework: "STP｜Segmentation",
    source: "OpenStax Principles of Marketing",
    url: "https://openstax.org/books/principles-marketing/pages/5-4-essential-factors-in-effective-market-segmentation",
    use: "可触达、可区分、可行动、可测量和足够大的有效细分条件",
  },
  {
    id: "METHOD-STP-TARGET",
    framework: "STP｜Targeting",
    source: "OpenStax Principles of Marketing",
    url: "https://openstax.org/books/principles-marketing/pages/5-5-selecting-target-markets",
    use: "目标市场选择结构参考",
  },
  {
    id: "METHOD-STP-POSITION",
    framework: "STP｜Positioning",
    source: "OpenStax Principles of Marketing",
    url: "https://openstax.org/books/principles-marketing/pages/5-6-product-positioning",
    use: "定位声明与差异理由结构参考",
  },
  {
    id: "METHOD-JTBD",
    framework: "Jobs to Be Done",
    source: "Christensen Institute",
    url: "https://www.christenseninstitute.org/theory/jobs-to-be-done/",
    use: "从购买情境识别功能、情绪与社交任务",
  },
  {
    id: "METHOD-COMB",
    framework: "COM-B",
    source: "Michie, van Stralen & West (2011), Implementation Science",
    url: "https://doi.org/10.1186/1748-5908-6-42",
    use: "把行为条件拆为能力、机会与动机；在本项目中只用于形成可验证假设，不推断真实心理发生率",
  },
  {
    id: "METHOD-FOGG",
    framework: "Fogg Behavior Model",
    source: "Behavior Design Lab / BJ Fogg",
    url: "https://www.behaviormodel.org/",
    use: "检查动机、行为难度与提示是否在同一触点同时成立",
  },
  {
    id: "METHOD-JOURNEY",
    framework: "Customer Journey",
    source: "Lemon & Verhoef (2016), Journal of Marketing",
    url: "https://doi.org/10.1509/jm.15.0420",
    use: "覆盖购买前、购买中、购买后阶段及品牌自有、伙伴和外部触点",
  },
  {
    id: "METHOD-JOURNEY-MAP",
    framework: "Journey Mapping",
    source: "Nielsen Norman Group",
    url: "https://www.nngroup.com/articles/journey-mapping-101/",
    use: "统一呈现场景、阶段、行为、想法、情绪、触点、机会与责任人",
  },
  {
    id: "METHOD-BCG",
    framework: "Growth Share Matrix",
    source: "Boston Consulting Group",
    url: "https://www.bcg.com/about/overview/our-history/growth-share-matrix",
    use: "经典 BCG 的市场增长率与相对市场份额定义",
  },
  {
    id: "METHOD-RICE",
    framework: "RICE",
    source: "Intercom",
    url: "https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/",
    use: "Reach × Impact × Confidence / Effort 的待办排序数据门",
  },
  {
    id: "METHOD-ICE",
    framework: "ICE",
    source: "Itamar Gilad",
    url: "https://itamargilad.com/ice-scores/",
    use: "Impact、Confidence、Ease 统一按 0–10 校准后取算术平均；Ease 表示投入越小得分越高",
  },
  {
    id: "METHOD-ANSOFF",
    framework: "Ansoff Matrix",
    source: "H. Igor Ansoff, Strategies for Diversification (1957)",
    url: "https://archive.org/download/strategiesfordiversificationansoff1957hbr/Strategies%20for%20Diversification-Ansoff1957-HBR.pdf",
    use: "区分市场渗透、产品开发、市场开发与多元化的增长方向",
  },
  {
    id: "METHOD-PROV",
    framework: "Evidence provenance",
    source: "W3C PROV Overview",
    url: "https://www.w3.org/TR/prov-overview/",
    use: "策略判断与原始证据、派生计算和责任人的可追溯关系",
  },
];

const CATEGORY_STRATEGY: Record<string, JsonObject> = {
  nightstands: {
    jobs: [
      ["功能任务", "当我睡前或起床时，我要在伸手可及的位置收纳随身物并安全充电，让床边保持有序且不被灯效和线缆打扰。", "睡前放置手机、眼镜、书和水杯；双人卧室希望成套购买", "收纳、取放和充电一步完成", "双真抽屉、隐蔽可更换充电仓、双只装一致交付"],
      ["情绪任务", "我想让卧室看起来安静、可靠、有家具质感，而不是临时拼凑的廉价功能架。", "升级卧室或替换晃动、异响、布抽屉产品", "获得秩序感、耐用品信任和睡眠氛围", "暖木纹、静音导轨、克制黑色细节与稳定结构"],
      ["社交任务", "我希望伴侣或访客看到的是协调、成熟的卧室，而不是外露插座和炫彩灯带。", "布置双人卧室、出租房升级或搬新家", "体现审美一致与对共同空间的照顾", "成套比例、统一缝隙、隐藏电气与系列化语言"],
    ],
    segments: [
      { id: "NS-S1", name: "低价功能追随者", definition: "以最低价格获得充电、灯效或临时收纳；对材料与寿命容忍度较高", need: "基础收纳 + 显性功能", willingness: "低", fit: "低", evidence: "公开样本显示低价功能款拥挤；本报告不推断其市场份额", status: "EXCLUDED", reason: "与品牌溢价和真家具质量目标冲突" },
      { id: "NS-S2", name: "卧室质感升级者", definition: "关注成套一致、木质感、静音真抽屉和隐蔽充电的双人卧室用户", need: "安静收纳 + 成套审美 + 可信充电", willingness: "中高（待价格测试）", fit: "高", evidence: "零售样本、VOC 与自有物流能力形成方向性支持", status: "PRIMARY", reason: "痛点、品牌语言与双只装履约能力同时匹配" },
      { id: "NS-S3", name: "紧凑空间整理者", definition: "在公寓或次卧中需要控制宽度，同时重视抽屉容量和走线", need: "小体积 + 有效容量 + 尺寸透明", willingness: "中（待验证）", fit: "中高", evidence: "VOC 存在尺寸两极信号，需用场景测试确认", status: "SECONDARY", reason: "可用同平台尺寸/内容变体承接，但不应牺牲主款稳定性" },
    ],
    positioning: {
      frame: "中高端双只装床头柜",
      statement: "面向希望卧室安静、协调且床边真正好用的美国双人卧室用户，Arc-Rhythm Charge 24 是一款中高端双只装床头柜，以静音真抽屉、隐蔽可更换充电和暖木纹家具质感，替代低价布抽屉与外露灯效功能款。",
      reasons: ["双全宽真抽屉与静音导轨", "后置可更换 UL Listed 成品充电模块", "双只装同步到货与部件级补发"],
    },
  },
  sideboard: {
    jobs: [
      ["功能任务", "当餐厅或客厅物品开始外溢时，我要把餐具、酒具和杂物集中收好，同时保留可布置的台面。", "搬新家、聚餐前整理或替换容量不足的柜体", "大容量分类收纳且门体长期顺畅", "64 英寸四门两仓、可调层板、静音门铰与清晰内尺寸"],
      ["情绪任务", "我想获得空间被整理好的掌控感，并相信这个大件不会晃动、错箱或装完门缝凌乱。", "大件到货、组装和第一次摆放", "降低大件购买焦虑并获得完成感", "两箱防错、门缝调节指引、稳定背板与快速补件"],
      ["社交任务", "我希望它在招待亲友时像客餐厅的完整家具，而不是仓储用品。", "聚餐、节日布置、开放式客餐厅展示", "表达成熟审美和待客秩序", "连续木纹、圆弧端部、克制比例与可陈列台面"],
    ],
    segments: [
      { id: "SB-S1", name: "低价大容量采购者", definition: "优先按体积和价格购买，接受通用外观与较高装配负担", need: "最低成本的大容量", willingness: "低", fit: "中低", evidence: "公开价格样本支持竞争激烈判断，不代表市场份额", status: "EXCLUDED", reason: "大件价格战会放大广告、破损与逆向物流风险" },
      { id: "SB-S2", name: "设计型客餐厅升级者", definition: "需要 60–70 英寸家具级收纳，并要求外观、门缝和到货体验一致", need: "家具质感 + 大容量 + 低装配摩擦", willingness: "中高（待价格测试）", fit: "高", evidence: "零售价格带、VOC 与公司大件物流能力相互支持", status: "PRIMARY", reason: "五品类中物流与品牌能力的差异最可被感知" },
      { id: "SB-S3", name: "家庭高容量组织者", definition: "以餐具、玩具、杂物混合收纳为主，更关注层板承载、可调性和安全", need: "容量、承重和灵活分区", willingness: "中（待验证）", fit: "高", evidence: "使用任务明确，但内部配置偏好需家庭样本验证", status: "SECONDARY", reason: "可通过内部分区配件承接，不改变首发外观平台" },
    ],
    positioning: {
      frame: "中高端 64 英寸四门餐边柜",
      statement: "面向重视客餐厅秩序与家具完整度的美国家庭，Arc-Rhythm 64 是一款中高端四门餐边柜，以家具级连续木纹、可调大容量收纳、两箱防错交付和快速补件，替代低价通用储物柜的门缝、晃动与大件履约焦虑。",
      reasons: ["四门两仓与可调层板", "两箱防错包装和门体调节体系", "自有大件物流与部件级补发闭环"],
    },
  },
  "drawer-cabinet": {
    jobs: [
      ["功能任务", "当桌边、手作区或家庭文件不断堆积时，我要按类别快速收纳，并能把柜体移动到使用位置后锁稳。", "居家办公、手作、学习或文件整理", "抽屉顺畅、内尺寸真实、移动后稳定", "全拉出导轨、可用内尺寸标注、低位底座与四只锁止脚轮"],
      ["情绪任务", "我想摆脱抽屉卡顿、倾倒和零件脆弱带来的烦躁，觉得工作区可控。", "频繁开合、移动或装满之后", "获得可靠、顺手和安全感", "活动件循环、联锁/防倾评估、结构与承重验证"],
      ["社交任务", "我希望家庭办公区看起来专业整洁，而不是布抽屉或工业文件柜。", "视频会议、共享家庭空间", "呈现专业秩序并融入家具环境", "木纹家具外观、紧凑比例与隐藏脚轮视觉"],
    ],
    segments: [
      { id: "DC-S1", name: "超低价临时收纳者", definition: "以布抽屉或轻型塑料柜满足短期收纳", need: "最低成本与轻便", willingness: "低", fit: "低", evidence: "低价替代品广泛存在；未测量份额", status: "EXCLUDED", reason: "与导轨、安全和家具级外观成本结构不匹配" },
      { id: "DC-S2", name: "桌边工作流组织者", definition: "需要紧凑柜体、顺滑抽屉、真实内尺寸和可锁止移动能力", need: "高频取放 + 空间适配 + 可移动", willingness: "中（待价格测试）", fit: "中高", evidence: "VOC 指向导轨、内尺寸与移动稳定性，仍需场景样本", status: "PRIMARY", reason: "专用工作流可脱离普通低价收纳柜" },
      { id: "DC-S3", name: "家庭安全型收纳者", definition: "需要较大容量并重视倾倒、联锁、承重和儿童环境风险", need: "容量 + 稳定 + 安全", willingness: "中高（待验证）", fit: "中", evidence: "法规和结构门槛明确，首发前必须完成用途判定", status: "SECONDARY", reason: "潜在价值较高，但法规与结构复杂度先过门" },
    ],
    positioning: {
      frame: "家具级移动抽屉柜",
      statement: "面向需要在居家办公或手作场景中高频整理的美国用户，Arc-Rhythm Mobile Drawer 是一款家具级移动抽屉柜，以真实内尺寸、顺滑全拉出导轨、低位锁止脚轮和安全验证，替代布抽屉与卡顿、易倾的轻型收纳。",
      reasons: ["内尺寸和使用场景透明", "导轨循环与锁轮稳定验证", "用途文案、联锁和 STURDY 适用性预评估"],
    },
  },
  "coffee-bar-counter": {
    jobs: [
      ["功能任务", "当我每天制作咖啡时，我要让咖啡机、磨豆机、杯具、耗材和线缆形成顺手工作流，不必在厨房台面来回搬动。", "晨间咖啡、招待客人或释放厨房台面", "设备放得下、散热安全、取用与清洁顺畅", "设备包络、耐液体台面、走线、抽屉与可调储物"],
      ["情绪任务", "我想拥有一个专属而有仪式感的咖啡角，同时不担心台面受潮、线缆凌乱或柜体不稳。", "日常冲煮与清洁", "获得愉悦、掌控和安全感", "暖木纹咖啡站语言、挡水/易清洁细节和电气边界"],
      ["社交任务", "我希望咖啡角成为家中可展示、可招待的生活方式节点。", "朋友来访、开放式厨房或餐厅展示", "表达生活品味和好客", "家具级外观、杯具陈列与不外露的功能组织"],
    ],
    segments: [
      { id: "CB-S1", name: "通用储物柜替代者", definition: "把普通餐边柜或厨房推车临时当咖啡柜，主要按价格与容量选择", need: "低成本台面 + 收纳", willingness: "低至中", fit: "中低", evidence: "混合零售样本提供价格参照，不代表专用品类份额", status: "EXCLUDED", reason: "通用柜难以支撑专用产品溢价" },
      { id: "CB-S2", name: "日常咖啡工作流用户", definition: "拥有咖啡机与磨豆机，重视设备包络、散热、线缆、清洁和耗材组织", need: "专用工作流 + 安全 + 易清洁", willingness: "中高（待价格测试）", fit: "高", evidence: "任务差异明确，需用三组主流设备做实物验证", status: "PRIMARY", reason: "专用任务最能形成区别于普通餐边柜的价值" },
      { id: "CB-S3", name: "紧凑型饮品角用户", definition: "公寓或小空间中需要较窄柜体兼容胶囊机、热水壶与杯具", need: "小占地 + 垂直收纳 + 走线", willingness: "中（待验证）", fit: "中高", evidence: "空间需求合理但尺寸分布尚未测量", status: "SECONDARY", reason: "适合后续窄体平台，先用主款需求验证" },
    ],
    positioning: {
      frame: "专用家庭咖啡工作站",
      statement: "面向希望把日常冲煮从杂乱厨房台面迁移出来的美国家庭咖啡用户，Arc-Rhythm Coffee Station 是一款专用咖啡工作站，以主流设备包络、散热与隐蔽走线、耐液体易清洁台面和耗材分区，替代普通餐边柜的尺寸猜测与工作流妥协。",
      reasons: ["三组主流咖啡设备包络验证", "电气、散热、液体和清洁边界", "两箱防护与大件真实履约验证"],
    },
  },
  "slatted-platform-bed": {
    jobs: [
      ["功能任务", "当我组装并长期使用床架时，我要床垫被稳定支撑、夜间不异响，搬运和补件也不拖累家庭。", "搬家、换床或解决旧床晃动异响", "一次装对、长期安静、部件可替换", "LVL 中梁、锁止排骨条、连接预紧、零件编码和分箱"],
      ["情绪任务", "我想放心睡眠，不再担心床架松动、吱响或长件破损后无法处理。", "翻身、双人使用与到货开箱", "获得稳定、安全和耐久信任", "疲劳/异响验证、长件包装、快速补件"],
      ["社交任务", "我希望卧室呈现低调、完整的家具感，而不是廉价金属框或夸张造型。", "卧室升级、共同生活空间", "表达成熟审美与长期投入", "暖木纹、低矮比例、圆角和系列化床边家具"],
    ],
    segments: [
      { id: "PB-S1", name: "最低价金属平台购买者", definition: "优先低价、快速到货与基础承托，对家具外观和长期异响容忍度较高", need: "最低成本承托", willingness: "低", fit: "低", evidence: "低价替代存在；未测量其市场份额", status: "EXCLUDED", reason: "无法发挥木质家族和自有长件物流优势" },
      { id: "PB-S2", name: "安静卧室升级者", definition: "重视木质家具感、无异响、稳固承托和清晰装配的双人/家庭用户", need: "安静 + 稳固 + 家具质感", willingness: "中高（待价格测试）", fit: "高", evidence: "VOC、结构任务和长件物流能力方向一致", status: "PRIMARY", reason: "公司 Alpha 与高频失败任务最匹配" },
      { id: "PB-S3", name: "搬家与易维护用户", definition: "重视分箱可搬、零件编码、可重复装配和部件级补发", need: "搬运 + 装配 + 可维护", willingness: "中（待验证）", fit: "高", evidence: "自有物流可兑现，但需真实线路和二次装配测试", status: "SECONDARY", reason: "服务差异明显，可作为主款第二信息层" },
    ],
    positioning: {
      frame: "中高端木质排骨架平台床",
      statement: "面向希望一次装好并长期安静使用的美国卧室升级用户，Arc-Rhythm Quiet Platform 是一款中高端木质排骨架床，以 LVL 中梁、锁止排骨条、连接预紧和长件分箱补件体系，替代低价平台床的晃动、异响与售后失联。",
      reasons: ["LVL 中梁、三支腿与锁止排骨条", "疲劳、异响和重复装配验证", "长件分箱、线路实测与部件级补发"],
    },
  },
  "cat-bed": {
    jobs: [
      ["功能任务", "当室内猫需要休息时，主人希望提供一个尺寸、支撑、温度与清洁方式都适配的固定休息点。", "替换旧窝、换季、搬家或发现猫持续改睡其他位置", "猫愿意使用，主人可以稳定清洁并判断尺寸是否适配", "PENDING｜先用家庭观察、尺寸任务和清洁测试定义产品响应"],
      ["情绪任务", "主人希望猫的休息空间看起来安全、卫生且可信，而不是买回后被闲置或快速塌陷。", "比较开放式、包裹式与结构式猫窝时", "降低闲置、卫生、材料与耐久焦虑", "PENDING｜用无品牌概念测试、材料说明和耐久验证建立证据"],
      ["社交任务", "主人希望宠物用品能够融入居家环境，同时不牺牲猫的真实使用偏好。", "猫窝放在客厅、卧室或共享空间时", "兼顾宠物照护与空间秩序", "PENDING｜用真实家庭场景测试外观接受度和持续使用"],
    ],
    segments: [
      { id: "CAT-S1", name: "价格优先替换者", definition: "先按低价、到货速度和基础柔软度选择，尚未证明对耐久或设计有溢价意愿", need: "基础休息点", willingness: "PENDING", fit: "PENDING", evidence: "KeepaMore 搜索样本只能证明商品供给存在，不能证明消费者偏好或细分规模", status: "EXCLUDED", reason: "在真实贡献与持续使用证据前，不以低价红海作为目标" },
      { id: "CAT-S2", name: "室内舒适与卫生管理者", definition: "重视猫持续使用、尺寸适配、可清洁性和日常维护的室内养猫家庭", need: "持续使用 + 易清洁 + 适配透明", willingness: "PENDING｜待价格测试", fit: "MANAGEMENT-HYPOTHESIS", evidence: "当前无评论正文或家庭行为数据；仅作为待验证主目标", status: "PRIMARY", reason: "任务可被观察和验证，但尚无发生率、支付意愿或转化证据" },
      { id: "CAT-S3", name: "安全感与家居融合者", definition: "关注包裹感、结构稳定、材料触感与共享空间外观的养猫家庭", need: "安全感 + 稳定 + 家居融合", willingness: "PENDING｜待价格测试", fit: "MANAGEMENT-HYPOTHESIS", evidence: "商品标题中的 cave、covered 等词不能替代真实偏好研究", status: "SECONDARY", reason: "保留为概念测试分支，不在现有数据下冻结产品形态" },
    ],
    positioning: {
      frame: "PENDING｜室内猫休息与清洁系统",
      statement: "定位待验证：面向重视持续使用、清洁和空间适配的室内养猫家庭，先比较开放、包裹和结构式方案；在真实 VOC、家庭观察与价格测试完成前不冻结产品承诺。",
      reasons: ["PENDING｜真实家庭持续使用", "PENDING｜清洁与耐久测试", "PENDING｜尺寸、材料和场景证据透明"],
    },
  },
};

const CATEGORY_JTBD_CONTRACTS: Record<string, JsonObject[]> = {
  nightstands: [
    {
      job_type: "功能任务",
      evidence_ids: ["RAW-NS", "MKT-NS-01"],
      evidence_basis: "床头柜评论与零售样本中关于抽屉、尺寸、走线和成套使用的可追溯观察。",
      protocol: { method: "实体床边任务可用性测试", sample: "8 名主目标用户，各完成睡前与起床任务 2 轮", metrics: "取放成功率、抽屉卡滞、线缆外露、任务时长", pass_rule: "任务成功率 ≥90%，零安全事件，关键摩擦均有可复验记录" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["RAW-NS"],
      evidence_basis: "评论中关于稳固、质感、噪声与廉价感的语言信号；不把工程测试替代为情绪证据。",
      protocol: { method: "情境访谈 + 7 日卧室使用日记", sample: "12–15 名主目标用户", metrics: "安心、秩序、廉价感与噪声触发事件", pass_rule: "至少 70% 用户在无引导复述中确认核心情绪进展，反例单独编码" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["RAW-NS"],
      evidence_basis: "成套卧室、外露电气与家居协调性的定位假设，当前没有发生率结论。",
      protocol: { method: "无品牌双人卧室概念盲测", sample: "60 名符合筛选条件用户，随机展示 3 个概念", metrics: "协调、成熟、共同空间照顾感与选择理由", pass_rule: "目标概念在社交表达维度显著领先基线，且开放题理由与定位一致" },
    },
  ],
  sideboard: [
    {
      job_type: "功能任务",
      evidence_ids: ["RAW-SB", "MKT-SB-01"],
      evidence_basis: "餐边柜样本与评论中关于容量、门体、装配和台面使用的观察。",
      protocol: { method: "实体餐具收纳与聚餐准备任务测试", sample: "8 个目标家庭，各完成装载、取用与复位任务", metrics: "有效容量、取放成功率、门体干涉、任务时长", pass_rule: "任务成功率 ≥90%，门体零干涉，所有尺寸偏差可追溯" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["RAW-SB"],
      evidence_basis: "评论中的大件到货焦虑、门缝、晃动和组装完成感信号。",
      protocol: { method: "情境访谈 + 开箱组装体验日记", sample: "12–15 个近期购买大件柜体的家庭", metrics: "购买焦虑、掌控感、完成感和失望触发点", pass_rule: "至少 70% 用户确认核心焦虑被两箱防错、调节与补件方案缓解" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["RAW-SB"],
      evidence_basis: "招待、陈列和家具完整度的管理假设，不从价格样本推导社交需求规模。",
      protocol: { method: "无品牌客餐厅场景盲测", sample: "60 名有聚餐/开放式客餐厅场景的用户", metrics: "家具完整度、待客秩序、展示意愿与选择理由", pass_rule: "目标概念的展示意愿领先通用储物柜基线，开放题无明显廉价感信号" },
    },
  ],
  "drawer-cabinet": [
    {
      job_type: "功能任务",
      evidence_ids: ["RAW-DC", "VOC-DC", "QA-DC-01"],
      evidence_basis: "已排除错误品类样本后的抽屉开度、内尺寸、移动与稳定性证据。",
      protocol: { method: "实体桌边工作流任务测试", sample: "8 名办公/手作用户，各完成分类、移动、锁止与高频取放", metrics: "可用内尺寸、取放成功率、锁轮稳定、抽屉干涉", pass_rule: "任务成功率 ≥90%，零倾倒/夹伤事件，移动后柜体保持稳定" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["VOC-DC", "RAW-DC"],
      evidence_basis: "评论中的卡顿、倾倒担忧、材料耐久和工作区失控感。",
      protocol: { method: "情境访谈 + 5 日工作流日记", sample: "12–15 名目标用户", metrics: "烦躁事件、可靠感、安全感与控制感", pass_rule: "至少 70% 用户确认关键烦躁事件减少；安全担忧必须逐条记录而非平均化" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["RAW-DC"],
      evidence_basis: "家庭办公区专业感与家具融合度的定位假设。",
      protocol: { method: "视频会议背景与共享空间概念盲测", sample: "60 名居家办公用户", metrics: "专业、整洁、家具融合度和陈列接受度", pass_rule: "目标概念在专业与整洁维度领先布抽屉/工业柜基线" },
    },
  ],
  "coffee-bar-counter": [
    {
      job_type: "功能任务",
      evidence_ids: ["RAW-CB", "VOC-CB", "MKT-CB-01"],
      evidence_basis: "咖啡柜评论中的设备包络、散热、走线、清洁和耗材组织证据。",
      protocol: { method: "三套主流设备的实体冲煮工作流测试", sample: "8 名日常咖啡用户，每人完成冲煮、清洁与补充耗材", metrics: "设备干涉、取用步数、线缆/散热异常、清洁时长", pass_rule: "任务成功率 ≥90%，零电气/温升风险，所有设备包络均通过" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["VOC-CB", "RAW-CB"],
      evidence_basis: "评论和场景中关于仪式感、杂乱、液体焦虑与空间掌控的信号。",
      protocol: { method: "情境访谈 + 7 日冲煮日记", sample: "12–15 名日常咖啡用户", metrics: "仪式感、掌控感、清洁焦虑和线缆焦虑事件", pass_rule: "至少 70% 用户确认专用工作站改善日常体验，负面异常全部保留" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["RAW-CB"],
      evidence_basis: "咖啡角作为展示与待客节点的管理假设。",
      protocol: { method: "无品牌待客场景概念盲测", sample: "60 名有家庭招待场景的咖啡用户", metrics: "展示意愿、好客感、生活方式表达与选择理由", pass_rule: "目标概念在展示意愿上领先普通餐边柜基线，且功能组织不被视觉遮蔽" },
    },
  ],
  "slatted-platform-bed": [
    {
      job_type: "功能任务",
      evidence_ids: ["RAW-BED", "VOC-BED", "MKT-BED-01"],
      evidence_basis: "平台床评论中的排骨条滑落、异响、断裂、尺寸兼容和装配证据。",
      protocol: { method: "实体安装、翻身与二次装配任务测试", sample: "8 组双人用户，完成首次安装、夜间模拟与一次拆装", metrics: "安装成功率、异响事件、排骨条位移、零件丢失", pass_rule: "安装成功率 ≥90%，零滑落，二次装配后零新增异响" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["VOC-BED", "RAW-BED"],
      evidence_basis: "评论中的睡眠安心、松动担忧、长件破损与售后失联信号。",
      protocol: { method: "情境访谈 + 14 夜睡眠使用日记", sample: "12 对目标用户", metrics: "安心感、异响担忧、夜间打扰与维护信心", pass_rule: "至少 70% 用户确认安心进展；任何安全担忧直接升级为失败事件" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["RAW-BED"],
      evidence_basis: "木质卧室完整度与共同空间长期投入的定位假设。",
      protocol: { method: "无品牌卧室场景双人概念盲测", sample: "60 对/名卧室升级决策者，随机展示 3 个概念", metrics: "成熟、长期投入、共同空间协调与选择理由", pass_rule: "目标概念在成熟与长期投入维度领先低价金属架基线" },
    },
  ],
  "cat-bed": [
    {
      job_type: "功能任务",
      evidence_ids: ["KM-CAT-SEARCH"],
      evidence_basis: "KeepaMore 仅支持商品供给、价格、评分数与评论数聚合字段；不支持猫的持续使用行为或评论正文。",
      protocol: { method: "真实家庭猫窝放置与持续使用观察", sample: "至少 12 个室内养猫家庭，覆盖不同体型与既有休息点", metrics: "首次接近、连续使用天数、停留时长、清洁任务、尺寸干涉", pass_rule: "预注册阈值后再判定；当前保持 PENDING，不从评分聚合值推断使用成功" },
    },
    {
      job_type: "情绪任务",
      evidence_ids: ["KM-CAT-SEARCH"],
      evidence_basis: "现有数据没有主人焦虑、信任或闲置原因的原始语言，只能登记待验证假设。",
      protocol: { method: "近期猫窝购买者情境访谈 + 使用日记", sample: "12–15 名目标购买者", metrics: "闲置焦虑、卫生、材料、耐久与安全感的原始语言和反例", pass_rule: "核心命题必须被无引导语言重复支持，且反例单独编码；未达到前保持 PENDING" },
    },
    {
      job_type: "社交任务",
      evidence_ids: ["KM-CAT-SEARCH"],
      evidence_basis: "商品标题和图片不能证明家居融合偏好或支付意愿。",
      protocol: { method: "无品牌家庭场景概念盲测", sample: "至少 100 名符合筛选条件的室内养猫家庭", metrics: "场景适配、照护可信、持续摆放意愿、价格选择与开放题理由", pass_rule: "达到预注册差异且实物任务不退化；AIGC 画面美感不得单独作为通过证据" },
    },
  ],
};

const CATEGORY_STP_EVIDENCE_CONTRACTS: Record<string, Record<string, JsonObject>> = {
  nightstands: {
    "NS-S1": { evidence_ids: ["MKT-NS-01"], validation: "以低价功能款清单、真实获客成本和贡献实账验证；不得从宽词样本外推份额。" },
    "NS-S2": { evidence_ids: ["RAW-NS"], validation: "以卧室升级用户概念/价格随机测试和实物任务验证质感、静音与充电价值。" },
    "NS-S3": { evidence_ids: ["RAW-NS", "MKT-NS-01"], validation: "以紧凑卧室实测尺寸、容量任务和尺寸退货原因验证。" },
  },
  sideboard: {
    "SB-S1": { evidence_ids: ["MKT-SB-01"], validation: "以低价大容量竞品清单、真实获客成本和履约贡献验证。" },
    "SB-S2": { evidence_ids: ["RAW-SB"], validation: "以设计型客餐厅用户概念/价格盲测和大件开箱任务验证。" },
    "SB-S3": { evidence_ids: ["RAW-SB", "MKT-SB-01"], validation: "以家庭混合收纳任务、层板负载和内部分区选择实验验证。" },
  },
  "drawer-cabinet": {
    "DC-S1": { evidence_ids: ["RAW-DC"], validation: "以布抽屉/轻型柜替代清单和真实价格选择验证，不推断人群规模。" },
    "DC-S2": { evidence_ids: ["VOC-DC", "RAW-DC"], validation: "以桌边工作流任务、内尺寸、导轨与锁轮实测验证。" },
    "DC-S3": { evidence_ids: ["VOC-DC", "REG-STURDY"], validation: "以家庭安全场景、用途筛选、联锁/稳定测试与法规判定验证。" },
  },
  "coffee-bar-counter": {
    "CB-S1": { evidence_ids: ["MKT-CB-01"], validation: "以普通柜/开放架替代清单和真实价格选择验证。" },
    "CB-S2": { evidence_ids: ["VOC-CB", "RAW-CB"], validation: "以三组设备包络和日常冲煮、清洁、走线任务验证专用价值。" },
    "CB-S3": { evidence_ids: ["RAW-CB"], validation: "以紧凑空间实测、窄体概念盲测和尺寸退货原因验证。" },
  },
  "slatted-platform-bed": {
    "PB-S1": { evidence_ids: ["MKT-BED-01"], validation: "以低价金属床替代清单、真实获客成本和贡献实账验证。" },
    "PB-S2": { evidence_ids: ["VOC-BED", "RAW-BED"], validation: "以双人安装、异响、滑落和价格盲测验证安静升级价值。" },
    "PB-S3": { evidence_ids: ["RAW-BED"], validation: "以搬运、拆装、零件编码与补件服务任务验证。" },
  },
  "cat-bed": {
    "CAT-S1": { evidence_ids: ["KM-CAT-SEARCH"], validation: "用去重搜索商品池、真实成交与贡献数据验证价格竞争；不得把搜索出现率当销量份额。" },
    "CAT-S2": { evidence_ids: ["KM-CAT-SEARCH"], validation: "用真实家庭持续使用、清洁任务、评论正文与随机价格测试验证；当前商品聚合字段只支持供给基线。" },
    "CAT-S3": { evidence_ids: ["KM-CAT-SEARCH"], validation: "用开放/包裹/结构式概念盲测、持续使用和尺寸适配验证；标题属性不能替代偏好证据。" },
  },
};

const CATEGORY_EXECUTION_CONTRACTS: Record<string, JsonObject[]> = {
  nightstands: [
    {
      id: "D0-14", owner: "产品/采购/法规/财务", gate_type: "HARD_GATE",
      category_action: "完成双只装柜体与可更换充电模块的两家 RFQ、HTS/TSCA 与 UL 适用性预审。",
      deliverable: "两家可比 RFQ、充电模块证书核验、税则/法规意见、未知项台账。",
      acceptance_contract: { metric: "可比 RFQ 数、证书/税则关闭率", threshold: "RFQ ≥2 家且高风险未知项 100% 指定 Owner/截止日；充电模块证书可核验", sample_window: "2 家独立供应商；D0–14", evidence: "签章报价、证书查询截图/报告、关务与法规书面意见", approver: "采购负责人 + 法规负责人 + 财务负责人" },
      stop_line: "若两家 RFQ 无法支撑营销后贡献率 ≥12%，或充电模块证书/法规适用性未关闭，则冻结概念投入并退回成本、模块或品类方案重算。",
    },
    {
      id: "D15-30", owner: "产品/用户研究/研发/财务", gate_type: "HARD_GATE",
      category_action: "验证卧室质感升级者对双真抽屉、隐蔽充电与 $179 目标价的选择，并冻结 DFM v1。",
      deliverable: "筛选器、3 个无品牌概念、随机价格测试、受控 BOM/尺寸/DFM v1。",
      acceptance_contract: { metric: "核心任务选择率、目标价接受度、DFM 关键项关闭率", threshold: "主概念选择率 ≥70%，价格测试覆盖 $159–199，Must 结构项 100% 进入受控版本", sample_window: "12–15 次情境访谈 + ≥100 名合格受访者随机概念/价格测试；D15–30", evidence: "去标识访谈记录、随机分组原始数据、版本化 BOM/图纸", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 财务负责人" },
      stop_line: "若主目标用户不认可安静收纳/隐蔽充电任务，或价格测试不能覆盖贡献线，则停止 DFM 冻结并退回 STP、定位或成本方案。",
    },
    {
      id: "D31-60", owner: "研发/质量/包装/法规", gate_type: "HARD_GATE",
      category_action: "完成抽屉循环、桌面静载、包装跌落与电源温升/插拔验证。",
      deliverable: "EVT/DVT 报告、CAPA/复验记录、量产签样、包装与电气文件包。",
      acceptance_contract: { metric: "产品验证矩阵 Must 项通过率与高风险 CAPA 关闭率", threshold: "配置中的抽屉、静载、包装和电气目标 100% 通过；高风险 CAPA 100% 复验关闭", sample_window: "按产品验证矩阵的逐项样本；D31–60", evidence: "原始测试数据、照片/视频、校准记录、签样与 CAPA 复验报告", approver: "研发负责人 + QA 负责人 + 法规负责人" },
      stop_line: "若任一抽屉、结构、包装或电气硬闸门失败，或 CAPA 未复验关闭，则禁止首批 PO 并退回设计/供应商整改。",
    },
    {
      id: "D61-90", owner: "业务/物流/数据/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行双只装美国真实履约，观察贡献、同步到货、破损、补件、退货和成熟 VOC。",
      deliverable: "逐单成熟度台账、财务复算、物流 KPI、退货原因编码和 GO/ITERATE/STOP 签核包。",
      acceptance_contract: { metric: "成熟订单贡献率、一次妥投、破损、补件 48h、缺箱与退货率", threshold: "50–100 单只生成 PILOT_ALERT；达到 ≥100 个成熟订单后才可对照财务与物流红线提交签核，且不得自动 PASS", sample_window: "每笔订单完成适用渠道退货窗口后继续观察 7 天", evidence: "订单级结算、承运扫描、RMA/补件工单、退货原因与 VOC 原文", approver: "业务负责人 + 物流负责人 + 财务负责人 + QA 负责人" },
      maturity_rule: "全部纳入判断的订单必须完成适用销售渠道退货窗口，并额外观察 7 天。",
      insufficient_evidence_rule: "样本不足 100 个成熟订单或任一订单观察窗未完成时，状态只能为 INSUFFICIENT_EVIDENCE，绝不能为 PASS。",
      stop_line: "若成熟订单营销后贡献率 <12%，或破损、缺箱、补件、退货任一指标超过红线，则冻结补货并退回成本、包装、物流或产品 CAPA。",
    },
  ],
  sideboard: [
    {
      id: "D0-14", owner: "产品/采购/关务/财务/物流", gate_type: "HARD_GATE",
      category_action: "完成 64 英寸四门两箱方案的两家 RFQ、HTS/Section 232 预归类与单箱可搬性评估。",
      deliverable: "两家可比 RFQ、税则意见、两箱重量/尺寸表、法规和供应风险台账。",
      acceptance_contract: { metric: "可比 RFQ 数、税则关闭率、两箱可搬性", threshold: "RFQ ≥2 家；HTS/附加税取得书面意见；两箱方案均在承运与人工搬运限制内", sample_window: "2 家独立供应商 + 1 条目标物流线路；D0–14", evidence: "签章报价、报关行意见、箱规/重量测量与线路规则", approver: "采购负责人 + 关务负责人 + 财务负责人 + 物流负责人" },
      stop_line: "若税则或箱规使营销后贡献率低于 12%，或两箱方案不满足线路限制，则停止样件投入并退回结构、包装或定价重算。",
    },
    {
      id: "D15-30", owner: "产品/用户研究/研发/财务", gate_type: "HARD_GATE",
      category_action: "验证设计型客餐厅升级者对家具质感、四门容量、低装配摩擦与 $349–399 价格的选择。",
      deliverable: "目标筛选器、3 个概念、价格测试、门缝/模块/包装 DFM v1。",
      acceptance_contract: { metric: "核心任务选择率、价格接受度、关键 DFM 关闭率", threshold: "主概念选择率 ≥70%，价格测试覆盖 $349–399，门缝/背板/中央支撑/两箱 Must 项 100% 受控", sample_window: "12–15 次情境访谈 + ≥100 名合格受访者随机测试；D15–30", evidence: "访谈与随机测试原始数据、受控图纸/BOM/风险清单", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 财务负责人" },
      stop_line: "若主目标不认可家具级收纳与低装配摩擦，或目标价格不能支撑贡献线，则停止 DFM 冻结并退回细分、定位或结构方案。",
    },
    {
      id: "D31-60", owner: "研发/质量/包装/法规/物流", gate_type: "HARD_GATE",
      category_action: "完成柜门循环、台面静载、双箱运输和两人装配验证。",
      deliverable: "EVT/DVT 与双箱线路报告、CAPA/复验记录、量产签样和安装文件。",
      acceptance_contract: { metric: "产品验证矩阵通过率、门缝/破损/装配达标率", threshold: "配置中的循环、静载、8 套运输和 10 组装配目标 100% 通过；高风险 CAPA 100% 关闭", sample_window: "按产品验证矩阵逐项样本；D31–60", evidence: "原始测试数据、运输扫描/开箱记录、计时视频、签样和 CAPA", approver: "研发负责人 + QA 负责人 + 包装/物流负责人" },
      stop_line: "若柜门、结构、双箱运输或装配任一硬闸门失败，或 CAPA 未关闭，则禁止首批 PO 并退回结构/包装整改。",
    },
    {
      id: "D61-90", owner: "业务/物流/数据/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行美国两箱真实履约，观察贡献、同日妥投、破损、门板补件、装配返工与退货。",
      deliverable: "逐单成熟度、订单结算、物流/RMA 数据和董事会签核包。",
      acceptance_contract: { metric: "成熟订单贡献率、破损、多箱同日、门板补件、装配返工与退货", threshold: "50–100 单只生成 PILOT_ALERT；≥100 个成熟订单后才可对照全部红线提交签核，不得自动 PASS", sample_window: "每笔订单完成适用渠道退货窗口后继续观察 7 天", evidence: "订单结算、两箱扫描、RMA/返工工单、退货原因与 VOC 原文", approver: "业务负责人 + 物流负责人 + 财务负责人 + QA 负责人" },
      maturity_rule: "全部纳入判断的订单必须完成适用销售渠道退货窗口，并额外观察 7 天。",
      insufficient_evidence_rule: "样本不足 100 个成熟订单或观察窗未完成时，状态只能为 INSUFFICIENT_EVIDENCE，绝不能为 PASS。",
      stop_line: "若成熟订单营销后贡献率 <12%，或破损、多箱同日、补件、返工、退货任一指标突破红线，则冻结补货并退回包装、物流或结构 CAPA。",
    },
  ],
  "drawer-cabinet": [
    {
      id: "D0-14", owner: "产品/采购/法规/财务/质量", gate_type: "HARD_GATE",
      category_action: "关闭 home office/craft 用途、STURDY/联锁适用性、导轨与锁轮两家 RFQ。",
      deliverable: "用途与法规判定、两家 RFQ、导轨/联锁方案、风险台账。",
      acceptance_contract: { metric: "用途/法规关闭率、可比 RFQ 数、安全未知项关闭率", threshold: "用途文案与法规边界 100% 书面确认；RFQ ≥2 家；所有安全未知项有 Owner/截止日", sample_window: "2 家独立供应商；D0–14", evidence: "法规备忘录、签章报价、导轨/联锁规格书和风险登记", approver: "法规负责人 + 采购负责人 + QA 负责人 + 财务负责人" },
      stop_line: "若用途/法规边界未关闭、联锁不可实现或成本不能支撑贡献率 ≥12%，则停止概念推进并退回用途、结构或成本方案。",
    },
    {
      id: "D15-30", owner: "产品/用户研究/研发/法规", gate_type: "HARD_GATE",
      category_action: "验证桌边工作流用户对真实内尺寸、全拉出导轨、隐藏锁轮和家具外观的选择。",
      deliverable: "筛选器、3 个概念、价格测试、用途文案和 DFM v1。",
      acceptance_contract: { metric: "任务选择率、安全理解率、目标价接受度、DFM 关闭率", threshold: "主概念选择率 ≥70%，安全/用途理解率 ≥90%，Must 结构与文案 100% 受控", sample_window: "12–15 次情境访谈 + ≥100 名合格受访者随机测试；D15–30", evidence: "访谈/随机测试原始数据、理解题结果、受控 BOM/图纸/文案", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 法规负责人" },
      stop_line: "若用户不能正确理解用途/安全边界，或核心工作流与价格假设不成立，则停止 DFM 冻结并退回 STP、文案或结构方案。",
    },
    {
      id: "D31-60", owner: "研发/质量/法规/包装", gate_type: "HARD_GATE",
      category_action: "完成导轨循环、单抽联锁、倾倒预评估与脚轮越障验证。",
      deliverable: "EVT/DVT、安全/法规文件、CAPA/复验记录和量产签样。",
      acceptance_contract: { metric: "产品验证矩阵通过率、安全失效数、高风险 CAPA 关闭率", threshold: "配置中的导轨、联锁、倾倒和脚轮目标 100% 通过；安全失效 0；高风险 CAPA 100% 关闭", sample_window: "按产品验证矩阵逐项样本；D31–60", evidence: "原始测试数据、视频、法规判定、签样和 CAPA 复验报告", approver: "研发负责人 + QA 负责人 + 法规负责人" },
      stop_line: "若联锁、稳定、导轨或脚轮任一安全/质量硬闸门失败，则禁止首批 PO 并退回结构或用途整改。",
    },
    {
      id: "D61-90", owner: "业务/物流/数据/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行美国真实办公/手作场景履约，观察贡献、导轨损坏、破损、缺件、退货和安全 VOC。",
      deliverable: "逐单成熟度、订单结算、物流/RMA/安全事件编码和签核包。",
      acceptance_contract: { metric: "成熟订单贡献率、导轨损坏、运输破损、缺件、退货与安全事件", threshold: "50–100 单只生成 PILOT_ALERT；≥100 个成熟订单且安全事件为 0 后才可提交签核，不得自动 PASS", sample_window: "每笔订单完成适用渠道退货窗口后继续观察 7 天", evidence: "订单结算、承运记录、RMA/客服工单、退货原因和安全事件原文", approver: "业务负责人 + 物流负责人 + 财务负责人 + QA/法规负责人" },
      maturity_rule: "全部纳入判断的订单必须完成适用销售渠道退货窗口，并额外观察 7 天。",
      insufficient_evidence_rule: "样本不足 100 个成熟订单或观察窗未完成时，状态只能为 INSUFFICIENT_EVIDENCE，绝不能为 PASS。",
      stop_line: "若出现任何安全事件、成熟订单营销后贡献率 <12%，或导轨损坏、破损、缺件、退货任一指标突破红线，则冻结补货并退回安全/质量 CAPA。",
    },
  ],
  "coffee-bar-counter": [
    {
      id: "D0-14", owner: "产品/采购/法规/关务/财务", gate_type: "HARD_GATE",
      category_action: "冻结三组设备包络，核验选配电源证书与布线边界，并完成两家 RFQ/HTS 预归类。",
      deliverable: "设备包络表、证书/布线审查、两家 RFQ、税则意见与未知项台账。",
      acceptance_contract: { metric: "设备包络覆盖率、证书/税则关闭率、可比 RFQ 数", threshold: "3 组主流设备 100% 有尺寸/净空；电源证书可核验；RFQ ≥2 家；高风险未知项 100% 指派", sample_window: "3 组设备 + 2 家供应商；D0–14", evidence: "实测尺寸、设备厂商净空说明、证书查询、签章报价与关务意见", approver: "产品负责人 + 法规负责人 + 采购/关务负责人 + 财务负责人" },
      stop_line: "若设备包络、电源证书或 HTS 边界未关闭，或成本不能支撑贡献率 ≥12%，则停止样件投入并退回功能、模块或成本方案。",
    },
    {
      id: "D15-30", owner: "产品/用户研究/研发/财务", gate_type: "HARD_GATE",
      category_action: "验证日常咖啡工作流对设备适配、散热、走线、耐液体和 $329 目标价的选择。",
      deliverable: "筛选器、3 个概念、价格测试、设备/线缆/台面 DFM v1。",
      acceptance_contract: { metric: "专用任务选择率、目标价接受度、设备包络与 DFM 关闭率", threshold: "主概念选择率 ≥70%，价格测试覆盖目标价，3 组设备包络和 Must 项 100% 受控", sample_window: "12–15 次情境访谈 + ≥100 名合格咖啡用户随机测试；D15–30", evidence: "访谈/随机测试原始数据、受控包络图、BOM/图纸", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 财务负责人" },
      stop_line: "若专用咖啡工作流不优于普通餐边柜，或目标价不能支撑贡献线，则停止 DFM 冻结并退回定位、功能或成本方案。",
    },
    {
      id: "D31-60", owner: "研发/质量/法规/包装", gate_type: "HARD_GATE",
      category_action: "完成设备运行/散热、台面耐液体、选配电源/走线和两箱运输验证。",
      deliverable: "EVT/DVT、电气/液体/运输测试报告、CAPA/复验与量产签样。",
      acceptance_contract: { metric: "产品验证矩阵通过率、电气/温升异常数、高风险 CAPA 关闭率", threshold: "配置中的 3 组设备、5 片台面、5 台电气与 8 套运输目标 100% 通过；安全异常 0", sample_window: "按产品验证矩阵逐项样本；D31–60", evidence: "原始温升/液体/运输数据、照片视频、证书、签样和 CAPA", approver: "研发负责人 + QA 负责人 + 法规负责人" },
      stop_line: "若设备散热、电气、液体或运输任一硬闸门失败，或安全 CAPA 未关闭，则禁止首批 PO 并退回结构/模块整改。",
    },
    {
      id: "D61-90", owner: "业务/物流/数据/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行美国真实咖啡场景履约，观察贡献、多箱同日、破损、装配、尺寸退货及电气/液体 VOC。",
      deliverable: "逐单成熟度、订单结算、物流/RMA/安全事件数据和签核包。",
      acceptance_contract: { metric: "成熟订单贡献率、多箱同日、破损、装配工单、尺寸退货和安全事件", threshold: "50–100 单只生成 PILOT_ALERT；≥100 个成熟订单且安全事件为 0 后才可提交签核，不得自动 PASS", sample_window: "每笔订单完成适用渠道退货窗口后继续观察 7 天", evidence: "订单结算、两箱扫描、RMA/安装工单、退货原因与安全 VOC 原文", approver: "业务负责人 + 物流负责人 + 财务负责人 + QA/法规负责人" },
      maturity_rule: "全部纳入判断的订单必须完成适用销售渠道退货窗口，并额外观察 7 天。",
      insufficient_evidence_rule: "样本不足 100 个成熟订单或观察窗未完成时，状态只能为 INSUFFICIENT_EVIDENCE，绝不能为 PASS。",
      stop_line: "若出现电气/液体安全事件、成熟订单贡献率 <12%，或同日妥投、破损、装配、尺寸退货任一指标突破红线，则冻结补货并退回 CAPA。",
    },
  ],
  "slatted-platform-bed": [
    {
      id: "D0-14", owner: "产品/采购/法规/财务/物流", gate_type: "HARD_GATE",
      category_action: "完成 LVL 中梁/锁止排骨条两家 RFQ、承重声明边界和 Queen 两箱长件线路评估。",
      deliverable: "两家 RFQ、结构初算、声明/法规意见、箱规重量与线路风险台账。",
      acceptance_contract: { metric: "可比 RFQ 数、承重声明关闭率、两箱线路可行性", threshold: "RFQ ≥2 家；承重声明 100% 标为待实测；两箱均满足线路与人工搬运限制", sample_window: "2 家供应商 + 1 条目标长件线路；D0–14", evidence: "签章报价、结构初算、法规意见、箱规实测与承运规则", approver: "采购负责人 + 研发负责人 + 法规负责人 + 财务/物流负责人" },
      stop_line: "若主承力结构不可制造、承重声明边界未关闭，或两箱线路使贡献率低于 12%，则停止样件投入并退回结构、包装或定价。",
    },
    {
      id: "D15-30", owner: "产品/用户研究/研发/财务", gate_type: "HARD_GATE",
      category_action: "验证安静卧室升级者对木质感、零异响、零滑落、两箱可搬与 $399 目标价的选择。",
      deliverable: "筛选器、3 个概念、价格测试、承力节点/排骨条/两箱 DFM v1。",
      acceptance_contract: { metric: "核心任务选择率、目标价接受度、承力 DFM 关闭率", threshold: "主概念选择率 ≥70%，价格测试覆盖 $399，主承力/锁止/两箱 Must 项 100% 受控", sample_window: "12–15 次情境访谈 + ≥100 名合格受访者随机测试；D15–30", evidence: "访谈/随机测试原始数据、受控结构图/BOM/风险清单", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 财务负责人" },
      stop_line: "若零异响/零滑落任务不被认可，或 $399 价格不能支撑贡献线，则停止 DFM 冻结并退回定位、结构或成本方案。",
    },
    {
      id: "D31-60", owner: "研发/质量/包装/法规/物流", gate_type: "HARD_GATE",
      category_action: "完成 1,000 lb 静载、10,000 次动态、边缘坐压和两箱长件运输验证。",
      deliverable: "EVT/DVT、异响/结构/运输原始报告、CAPA/复验、量产签样。",
      acceptance_contract: { metric: "产品验证矩阵通过率、异响/滑落/结构失效数、高风险 CAPA 关闭率", threshold: "配置中的静载、动态、边缘坐压和 8 套运输目标 100% 通过；异响/滑落/结构失效为 0", sample_window: "按产品验证矩阵逐项样本；D31–60", evidence: "原始载荷/循环/声学/运输数据、视频、校准记录、签样和 CAPA", approver: "研发负责人 + QA 负责人 + 包装/物流负责人" },
      stop_line: "若承重、动态异响、排骨条锁止、边缘坐压或长件运输任一硬闸门失败，则禁止首批 PO 并退回结构/包装整改。",
    },
    {
      id: "D61-90", owner: "业务/物流/数据/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行 Queen 两箱美国真实履约，观察贡献、同日妥投、长件破损、异响退货、缺件补发与安全 VOC。",
      deliverable: "逐单成熟度、订单结算、两箱/RMA/异响数据和董事会签核包。",
      acceptance_contract: { metric: "成熟订单贡献率、两箱同日、长件破损、异响退货、补件 48h 与安全事件", threshold: "50–100 单只生成 PILOT_ALERT；≥100 个成熟订单且安全事件为 0 后才可提交签核，不得自动 PASS", sample_window: "每笔订单完成适用渠道退货窗口后继续观察 7 天", evidence: "订单结算、两箱扫描、RMA/补件工单、异响音视频、退货原因与 VOC 原文", approver: "业务负责人 + 物流负责人 + 财务负责人 + QA 负责人" },
      maturity_rule: "全部纳入判断的订单必须完成适用销售渠道退货窗口，并额外观察 7 天。",
      insufficient_evidence_rule: "样本不足 100 个成熟订单或观察窗未完成时，状态只能为 INSUFFICIENT_EVIDENCE，绝不能为 PASS。",
      stop_line: "若出现安全事件、成熟订单贡献率 <12%，或两箱同日、长件破损、异响退货、补件任一指标突破红线，则冻结补货并退回结构、包装或物流 CAPA。",
    },
  ],
  "cat-bed": [
    {
      id: "D0-14", owner: "研究/数据/产品/法规/财务", gate_type: "HARD_GATE",
      category_action: "合并多关键词 KeepaMore 批次并按 ASIN 去重，补齐评论正文、类目口径、法规范围与成本字段。",
      deliverable: "带 query/batch/search position/observed_at 的商品池、VOC 采集方案、适用性清单与成本输入模板。",
      acceptance_contract: { metric: "商品去重、来源追溯、VOC 与成本字段完整性", threshold: "每条商品可追溯到查询与批次；评论正文、类目口径、成本和法规缺口均有 Owner 与截止日", sample_window: "多关键词、多批次；观察窗与批次在数据中原样保留", evidence: "KeepaMore 导出、ASIN 去重日志、评论正文采集合同、法规/成本输入台账", approver: "数据负责人 + 产品负责人 + 法规负责人 + 财务负责人" },
      stop_line: "若数据来源、授权范围或 ASIN 去重不可审计，则停止把样本用于品类决策；现有报告保持 INSUFFICIENT_EVIDENCE。",
    },
    {
      id: "D15-30", owner: "用户研究/产品/研发/财务", gate_type: "HARD_GATE",
      category_action: "用真实家庭观察验证开放、包裹和结构式休息方案，并运行无品牌概念与价格测试。",
      deliverable: "目标筛选器、家庭使用记录、三方案概念测试、尺寸/清洁任务与初版产品约束。",
      acceptance_contract: { metric: "持续使用、尺寸适配、清洁任务、概念选择与价格证据", threshold: "阈值在看数前预注册；任何安全、持续闲置或清洁失败均保留为反证，不以评分聚合值替代", sample_window: "至少 12 个家庭观察 + 按效应量确定的随机概念/价格样本", evidence: "去标识行为记录、访谈原文、随机分组数据与版本化研究方案", approver: "用户研究负责人 + 产品负责人 + 研发负责人 + 财务负责人" },
      stop_line: "若猫持续使用任务、主人清洁任务或目标价格选择不成立，则停止产品定义冻结并退回 STP/JTBD。",
    },
    {
      id: "D31-60", owner: "研发/质量/包装/法规", gate_type: "HARD_GATE",
      category_action: "在产品形态通过用户 Gate 后，完成材料、尺寸、支撑、清洁、耐久、包装与标签验证。",
      deliverable: "EVT/DVT 原始记录、材料/标签文件、包装测试、CAPA 复验和量产签样。",
      acceptance_contract: { metric: "受控产品验证矩阵通过率与安全/高风险 CAPA 关闭率", threshold: "最终验证矩阵 Must 项全部通过；任何安全异常为零容忍；高风险 CAPA 复验关闭", sample_window: "按冻结后的测试方案与样本量执行；当前不得预填结果", evidence: "原始测试数据、校准记录、照片/视频、法规文件与签样", approver: "研发负责人 + QA 负责人 + 法规负责人" },
      stop_line: "若材料、结构、清洁、包装、标签或任何安全硬闸门失败，则禁止首批 PO。",
    },
    {
      id: "D61-90", owner: "业务/数据/客服/物流/财务/质量", gate_type: "PILOT_ALERT",
      category_action: "执行小批真实履约，观察成熟订单贡献、持续使用、退货、清洁、破损与客服原始 VOC。",
      deliverable: "逐单成熟度、订单结算、退货/客服原文、持续使用回访与 GO/ITERATE/STOP 签核包。",
      acceptance_contract: { metric: "成熟订单贡献、持续使用、退货、质量、客服与安全事件", threshold: "样本和阈值由签核方案预注册；观察窗未完成时只允许 PILOT_ALERT / INSUFFICIENT_EVIDENCE，不得自动 PASS", sample_window: "每笔订单完成适用退货窗口后继续观察；持续使用需单独回访", evidence: "订单结算、RMA/客服原文、回访记录、承运与质量事件", approver: "业务负责人 + 数据负责人 + 财务负责人 + QA/法规负责人" },
      maturity_rule: "只有完成退货窗口并完成持续使用回访的订单才能进入成熟样本。",
      insufficient_evidence_rule: "成熟样本或观察窗不足时必须保持 INSUFFICIENT_EVIDENCE。",
      stop_line: "任何安全事件、持续闲置集中出现、贡献不成立或质量/退货突破预注册红线时冻结补货并启动 CAPA。",
    },
  ],
};

const PORTFOLIO_PROXY = [
  ["Nightstands", "中高", "中高", "选择性投入", "以双只装、静音真抽屉和隐蔽充电验证溢价"],
  ["Sideboard", "高", "高", "优先投入", "大件履约、补件和家具级完成度最能形成公司胜算"],
  ["Drawer cabinet", "中", "中", "小额验证或延后", "先关闭导轨、安全用途与法规复杂度"],
  ["Coffee bar counter", "高", "中高", "验证后投入", "专用工作流成立，但设备包络、电气与液体风险先过门"],
  ["Slatted platform bed", "高", "高", "优先投入", "长件物流、异响控制和部件级售后构成明显壁垒"],
];

function rowsOf(value: unknown): any[][] {
  return Array.isArray((value as JsonObject)?.rows) ? (value as JsonObject).rows : [];
}

function categoryName(config: JsonObject): string {
  return String(config.category || "").split("｜")[0] || String(config.slug || "目标品类");
}

function sourceIds(config: JsonObject): string[] {
  return (config.sources || []).map((source: JsonObject) => String(source?.id || "")).filter(Boolean);
}

function buildJtbd(config: JsonObject, vocEvidence: JsonObject, profile: JsonObject) {
  const themes = rowsOf(vocEvidence?.theme_distribution).slice(0, 4).map((row) => String(row?.[0] || "")).filter(Boolean);
  const availableSources = new Set(sourceIds(config));
  const contracts: JsonObject[] = (CATEGORY_JTBD_CONTRACTS[config.slug] || []).map((contract: JsonObject, index): JsonObject => ({
    id: `JTBD-CONTRACT-${String(config.slug).toUpperCase()}-${index + 1}`,
    evidence_strategy: "EXPLICIT_CATEGORY_JOB_CONTRACT",
    ...contract,
    missing_evidence_ids: (contract.evidence_ids || []).filter((id: string) => !availableSources.has(id)),
  }));
  const anchors = [...new Set(contracts.flatMap((contract: JsonObject) => contract.evidence_ids || []))];
  const protocolLabel = (contract: JsonObject) => {
    const protocol = contract.protocol || {};
    return `${protocol.method}｜样本：${protocol.sample}｜指标：${protocol.metrics}｜通过：${protocol.pass_rule}`;
  };
  return {
    framework: "Jobs to Be Done",
    status: "EVIDENCE-GATED",
    definition: "任务不是人口画像或功能清单，而是消费者在具体情境中希望取得的进展；功能、情绪与社交任务必须一起验证。",
    jobs: table(
      ["Job ID", "任务类型", "Job statement", "购买/使用情境", "期望进展", "产品响应", "证据锚点", "验证门"],
      (profile.jobs || []).map((row: any[], index: number) => [
        `JOB-${String(config.slug).toUpperCase()}-${index + 1}`,
        ...row,
        (() => {
          const contract = contracts.find((item: JsonObject) => item.job_type === row[0]);
          return contract ? `${contract.id}｜${contract.evidence_ids.join(" / ")}｜${contract.evidence_basis}` : "VOC-EVIDENCE-PENDING";
        })(),
        (() => {
          const contract = contracts.find((item: JsonObject) => item.job_type === row[0]);
          return contract ? protocolLabel(contract) : "真实目标用户任务测试";
        })(),
      ]),
      "Job statement 为基于可追溯 VOC 的研究假设，不是逐字消费者引语；必须用真实目标用户和实物任务复核。",
    ),
    circumstances: table(["触发", "阻碍", "切换动力", "验证方式"], [
      ["现有产品在高频任务中持续失败", themes.slice(0, 2).join(" / ") || "VOC 主题待补", "降低摩擦并改善完成质量", "12–15 名目标用户情境访谈"],
      ["搬家、空间升级或家庭结构变化", "尺寸、装配与大件购买风险", "获得更适配且可信的完整方案", "场景测量 + 概念/价格随机测试"],
      ["竞品承诺与实物体验不一致", "材料、结构、物流和售后不透明", "用可验证证据降低购买风险", "实物测试 + 50–100 件真实履约"],
    ]),
    forces_of_progress: table(["力量", "当前假设", "产品/研究响应"], [
      ["Push｜推动离开现状", themes.slice(0, 2).join(" / ") || "现有方案在高频任务中失败", "在访谈中追问最近一次失败事件，不用抽象偏好代替"],
      ["Pull｜新方案吸引", profile.positioning?.reasons?.slice(0, 2).join(" / "), "用无品牌概念盲测验证，不把 AIGC 画面美感当购买证据"],
      ["Anxiety｜切换焦虑", "价格、尺寸、装配、质量、运输和售后不确定", "规格透明、测试证据、小批履约和补件 SLA"],
      ["Habit｜旧习惯阻力", "继续使用现有家具、通用品或低价替代", "验证专用任务改善是否足以支撑切换成本"],
    ]),
    current_alternatives: table(["替代类型", "消费者当前做法", "主要妥协"], [
      ["继续忍受", "保留现有产品并绕开问题", themes[0] || "高频摩擦未被解决"],
      ["通用品替代", "用相邻品类或低价通用品完成任务", "尺寸、工作流、家具感或长期可靠性不足"],
      ["自行修补", "加垫片、理线、换五金或请求补件", "时间成本高且结果不稳定"],
    ]),
    desired_outcomes: table(["结果层", "期望结果", "当前证据", "下一验证"], [
      ["功能", profile.jobs?.[0]?.[3], themes.join(" / ") || "VOC 编码观察", "实物任务成功率与故障记录"],
      ["情绪", profile.jobs?.[1]?.[3], "消费者信号转述；非发生率", "情境访谈 + 使用日记"],
      ["社交", profile.jobs?.[2]?.[3], "定位假设；尚未量化", "概念盲测 + 信息层 A/B"],
    ]),
    job_contracts: contracts,
    evidence_anchors: anchors,
    validation: {
      sequence: contracts.map((contract: JsonObject) => contract.protocol?.method).filter(Boolean),
      stop_line: "若任一功能安全、任务价值、情绪进展或社交表达协议失败，则停止将 JTBD 假设升级为已验证结论，并退回证据补采。",
    },
  };
}

function buildStp(config: JsonObject, profile: JsonObject) {
  const segments = profile.segments || [];
  const primary = segments.find((segment: JsonObject) => segment.status === "PRIMARY");
  const secondary = segments.find((segment: JsonObject) => segment.status === "SECONDARY");
  const excluded = segments.filter((segment: JsonObject) => segment.status === "EXCLUDED");
  const ids = sourceIds(config);
  const availableSources = new Set(ids);
  const evidenceDefinitions = CATEGORY_STP_EVIDENCE_CONTRACTS[config.slug] || {};
  const evidenceContracts: JsonObject[] = segments.map((segment: JsonObject): JsonObject => {
    const definition = evidenceDefinitions[segment.id];
    if (!definition) throw new Error(`Missing STP evidence contract for ${String(config.slug)} ${String(segment.id)}`);
    return {
      id: `STP-EVIDENCE-${segment.id}`,
      segment_id: segment.id,
      status: "DIRECTIONAL",
      claim: segment.evidence,
      evidence_ids: definition.evidence_ids,
      missing_evidence_ids: definition.evidence_ids.filter((id: string) => !availableSources.has(id)),
      validation: definition.validation,
      independence_rule: "本合同只支持该 Segment ID；不得因目标状态相同或品类来源相同而复制到其他细分。",
    };
  });
  const evidenceContractFor = (segmentId: string) => evidenceContracts.find((contract: JsonObject) => contract.segment_id === segmentId);
  const segmentRows = segments.map((segment: JsonObject) => [
    segment.id,
    segment.name,
    segment.definition,
    segment.need,
    segment.willingness,
    segment.fit,
    segment.status,
    segment.reason,
    (() => {
      const contract = evidenceContractFor(segment.id);
      return `${contract?.id}｜${contract?.evidence_ids?.join(" / ")}｜${contract?.claim}`;
    })(),
  ]);
  return {
    framework: "STP",
    status: "MANAGEMENT-HYPOTHESIS",
    segmentation: {
      axes: table(["细分轴", "本报告定义", "不得误用"], [
        ["购买任务", "消费者希望在特定情境取得的进展", "不能只按年龄或收入贴标签"],
        ["使用场景", "空间、频率、共同使用者与失败后果", "公开评论样本不能外推人群占比"],
        ["价值取舍", "价格、家具质感、功能、装配与服务之间的取舍", "支付意愿必须通过真实价格测试"],
        ["公司可赢性", "品牌设计、供应链、自有物流和售后能否形成优势", "内部评分不是市场份额"],
      ]),
      validity_gates: table(["有效细分条件", "本报告检查", "当前状态"], [
        ["可触达", "能通过合规关键词、内容、渠道或 CRM 触达", "PENDING｜需接入渠道实账"],
        ["可区分", "细分内任务和取舍相近、细分间对产品与营销响应不同", "方向性满足；筛选器与响应差异待实测"],
        ["可行动", "产品、价格、内容和履约能形成不同动作", "满足｜已定义产品与服务响应"],
        ["可测量", "可估算人数、需求、转化和贡献", "PENDING｜未接入面板/交易数据"],
        ["足够大", "在真实贡献与库存约束下值得服务", "PENDING｜小批履约后判断"],
      ]),
      segments,
      evidence_contracts: evidenceContracts,
      matrix: table(
        ["Segment ID", "细分", "操作性定义", "核心任务", "支付意愿", "公司匹配", "目标状态", "选择/排除理由", "证据锚点"],
        segmentRows,
        "细分规模尚未接入可审计交易或面板数据；当前仅用于定性取舍，不显示虚假人群占比。",
      ),
    },
    targeting: {
      hypothesis_label: "MANAGEMENT-HYPOTHESIS",
      selection_rule: "先过需求证据、公司可赢性和硬闸门，再比较吸引力；总分不能覆盖合规、质量、利润或履约否决项。",
      selection_score_gate: {
        status: "PENDING",
        required_inputs: ["同口径细分规模", "目标价格下转化/支付意愿", "可触达成本", "真实履约贡献", "证据置信度"],
        rule: "输入未齐备前只使用高/中/低管理判断，不生成伪精确目标分。",
      },
      primary_target_id: primary?.id,
      secondary_target_id: secondary?.id,
      excluded_target_ids: excluded.map((segment: JsonObject) => segment.id),
      candidate_matrix: table(["Segment ID", "细分", "吸引力假设（管理判断）", "公司胜算", "证据状态", "选择"], segments.map((segment: JsonObject) => {
        const contract = evidenceContractFor(segment.id);
        return [
          segment.id,
          segment.name,
          `MANAGEMENT-HYPOTHESIS｜${segment.status === "PRIMARY" ? "高" : segment.status === "SECONDARY" ? "中高" : "中/低"}`,
          segment.fit,
          `MANAGEMENT-HYPOTHESIS｜${contract?.id}｜规模与支付意愿待验证`,
          segment.status,
        ];
      })),
      selection: table(["角色", "Segment ID", "细分", "决策理由"], [
        ["主目标", primary?.id, primary?.name, primary?.reason],
        ["次目标", secondary?.id, secondary?.name, secondary?.reason],
        ...excluded.map((segment: JsonObject) => ["排除", segment.id, segment.name, segment.reason]),
      ]),
    },
    positioning: {
      target_segment_id: primary?.id,
      target: primary?.name,
      frame_of_reference: profile.positioning?.frame,
      positioning_statement: profile.positioning?.statement,
      reasons_to_believe: profile.positioning?.reasons || [],
      price_test_range_hypothesis: (() => {
        const price = Number(config.finance?.target_price || rowsOf(config.finance?.cost_waterfall)?.[0]?.[1] || 0);
        return {
          status: "MANAGEMENT-HYPOTHESIS",
          range: price ? `$${Math.round(price * 0.9)}–$${Math.round(price * 1.1)}` : null,
          basis: "以立项目标价上下 10% 作为实验范围；不是已验证支付意愿或最终价格。",
        };
      })(),
      price_band: (() => {
        const price = Number(config.finance?.target_price || rowsOf(config.finance?.cost_waterfall)?.[0]?.[1] || 0);
        return `MANAGEMENT-HYPOTHESIS｜${price ? `$${Math.round(price * 0.9)}–$${Math.round(price * 1.1)}` : "价格待财务签核"}`;
      })(),
      exclusions: excluded.map((segment: JsonObject) => `${segment.name}：${segment.reason}`),
      validation_gate: "主目标概念/价格测试通过，定位 RTB 与量产签样一致，且小批真实履约不突破硬停止线。",
      evidence_ids: ids.slice(0, 5),
      confidence: "MEDIUM-DIRECTIONAL",
    },
  };
}

function buildBcg(config: JsonObject) {
  const currentCategory = categoryName(config);
  const marketGrowthFormula = "(current_period_market_size - prior_period_market_size) / prior_period_market_size";
  const relativeMarketShareFormula = "company_market_share / largest_competitor_market_share";
  const portfolioUniverse = PORTFOLIO_PROXY.map((row) => String(row[0]));
  const isExistingPortfolioCategory = portfolioUniverse.includes(currentCategory);
  const portfolioCategories = isExistingPortfolioCategory
    ? [currentCategory, ...portfolioUniverse.filter((category) => category !== currentCategory)]
    : [currentCategory];
  const entries = portfolioCategories.map((category) => ({
    category,
    is_current_category: category === currentCategory,
    status: "PENDING",
    observation_window: null,
    market_growth_rate: null,
    relative_market_share: null,
    quadrant: "PENDING",
    capital_action: "PENDING",
    market_growth_formula: marketGrowthFormula,
    relative_market_share_formula: relativeMarketShareFormula,
    high_growth_threshold: null,
    high_relative_share_threshold: 1,
    evidence_ids: ["METHOD-BCG"],
    confidence: "PENDING",
  }));
  const attractivenessRows = isExistingPortfolioCategory
    ? PORTFOLIO_PROXY
    : [[currentCategory, "PENDING", "PENDING", "补证后决定", "当前只有搜索商品聚合字段；不得复制其他品类评分或资源优先级"]];
  const attractivenessCapabilityMatrix = table(
    ["品类", "市场吸引力（管理判断）", "公司竞争能力（管理判断）", "管理动作", "依据与下一步"],
    attractivenessRows,
    "这是独立的市场吸引力 × 公司竞争能力管理矩阵，不是经典 BCG；不得解读为真实增长率或相对市场份额。",
  );
  return {
    framework: "BCG Growth-Share Matrix + independent Attractiveness-Capability Matrix",
    current_category: currentCategory,
    entries,
    classic_input_gate: {
      status: "PENDING",
      observation_window: null,
      market_growth_rate: null,
      relative_market_share: null,
      quadrant: "PENDING",
      market_growth_formula: marketGrowthFormula,
      relative_market_share_formula: relativeMarketShareFormula,
      high_growth_threshold: null,
      high_relative_share_threshold: 1,
      threshold_rule: "增长阈值必须在看数前按同一市场口径预先登记；相对份额 >= 1 才属于高份额。",
      required_inputs: table(["经典轴", "定义", "当前状态", "补数要求"], [
        ["市场增长率", "同一品类、同一市场、同一口径的期间增长率", "PENDING", "至少 24 个月可审计类目销售或可靠面板时序"],
        ["相对市场份额", "本公司份额 / 最大竞争者份额", "PENDING", "公司实销 + 同口径最大竞争者销售或份额"],
      ]),
      decision_rule: "两项真实输入未齐备前，不给出 Star / Cash Cow / Question Mark / Dog 象限，也不据此分配资本。",
      category_rows: entries,
    },
    attractiveness_capability_matrix: attractivenessCapabilityMatrix,
    proxy_matrix: attractivenessCapabilityMatrix,
    portfolio_actions: table(["管理动作", "适用品类", "资本纪律", "放行证据"], isExistingPortfolioCategory ? [
      ["优先投入", "Sideboard / Slatted platform bed", "并行推进 DFM，但错峰进入真实履约", "单位经济、质量、合规、路线容量全部过门"],
      ["验证后投入", "Coffee bar counter", "先买设备包络、电气和液体风险信息", "专用任务概念测试 + DVT + 真实履约"],
      ["选择性投入", "Nightstands", "限定在双只装中高端差异，不追逐低价功能红海", "价格测试 + 充电模块 + 套装履约"],
      ["小额验证或延后", "Drawer cabinet", "先关闭法规、安全与导轨复杂度，再决定首批", "用途判定 + 联锁/稳定 + 真实场景"],
    ] : [
      ["补证后决定", currentCategory, "不与既有品类共享评分，不在证据不足时分配量产资本", "真实需求/VOC、单位经济、质量、合规与履约全部过门"],
    ]),
    methodology_warning: "经典 BCG 只回答增长与相对份额的组合角色；独立的吸引力-能力矩阵用于资源讨论，不能替代市场份额、增长率、现金流和风险验证。",
    methodology_source_id: "METHOD-BCG",
  };
}

function buildConsumerPsychology(
  config: JsonObject,
  vocEvidence: JsonObject,
  profile: JsonObject,
  jtbd: JsonObject,
) {
  const themeRows = rowsOf(vocEvidence?.theme_distribution).slice(0, 6);
  const circumstanceRows = rowsOf(jtbd?.circumstances);
  const contracts = Array.isArray(jtbd?.job_contracts) ? jtbd.job_contracts : [];
  const themeLabel = (index: number) => String(themeRows[index]?.[0] || "VOC 主题待补");
  const sourceAnchor = (index: number) => {
    const contract = contracts[index] || {};
    const ids = Array.isArray(contract.evidence_ids) ? contract.evidence_ids : [];
    return ids.length ? ids.join(" / ") : "EVIDENCE-PENDING";
  };
  const protocolFor = (index: number) => {
    const protocol = contracts[index]?.protocol || {};
    return protocol.method
      ? `${protocol.method}｜${protocol.metrics}｜通过：${protocol.pass_rule}`
      : "目标用户情境访谈 + 实物任务测试";
  };
  const readinessMatrix = (profile.jobs || []).slice(0, 3).map((row: any[], index: number) => {
    const contract = contracts[index] || {};
    const evidenceIds = Array.isArray(contract.evidence_ids) ? contract.evidence_ids : [];
    const missing = Array.isArray(contract.missing_evidence_ids) ? contract.missing_evidence_ids : [];
    return [
      row?.[1] ? 3 : 0,
      Math.min(3, evidenceIds.length),
      evidenceIds.length ? (missing.length ? 1 : 3) : 0,
      contract.protocol?.method ? 3 : 0,
    ];
  });
  const valueRiskPoints = themeRows.map((row) => ({
    label: String(row?.[0] || "未分类"),
    positive_observations: Number(row?.[3] || 0),
    negative_observations: Number(row?.[2] || 0),
  }));

  return {
    framework: "COM-B + Fogg behavior conditions + perceived value/risk + decision heuristic watchlist",
    status: "EVIDENCE-GATED",
    evidence_boundary: "消费者心理机制是由公开 VOC 与产品任务形成的编码解释或管理假设，不是临床判断、市场发生率或真实转化因果。只有预注册访谈、任务、概念和行为实验才能升级状态。",
    evidence_states: {
      observed_fact: "只指可回溯页面、评论转述、订单或事件记录",
      coded_interpretation: "把消费者语言映射到动机、能力、机会、风险与旅程阶段",
      management_hypothesis: "对价值感、风险感、捷径和信息反应的待验证判断",
      pending_measurement: "未来接入行为、调查、订单或售后适配器后计算",
    },
    motivation_barrier_matrix: table(
      ["心理任务", "情境触发", "期望进展 / 动机", "当前障碍 / 风险", "降低难度与可信提示", "证据状态", "证据 ID", "验证门"],
      (profile.jobs || []).slice(0, 3).map((row: any[], index: number) => [
        row?.[0] || `任务 ${index + 1}`,
        row?.[2] || circumstanceRows[index]?.[0] || "触发待验证",
        row?.[3] || row?.[1] || "动机待验证",
        circumstanceRows[index]?.[1] || themeLabel(index),
        row?.[4] || profile.positioning?.reasons?.[index] || "产品响应待定义",
        index === 0 ? "CODED-INTERPRETATION" : "MANAGEMENT-HYPOTHESIS",
        sourceAnchor(index),
        protocolFor(index),
      ]),
      "功能、情绪与社交任务必须分别保留证据和验证门；同一条评论不能被重复解释为三种心理事实。",
    ),
    behavior_mechanism_flow: {
      kind: "chart",
      title: "购买行为条件链｜触发 × 动机 × 低摩擦 × 可信证据",
      value: {
        nodes: [
          { id: "trigger", label: "情境触发" },
          { id: "motivation", label: "功能 / 情绪 / 社交动机" },
          { id: "ability", label: "尺寸、理解与操作难度" },
          { id: "prompt", label: "页面、口碑与实物证据" },
          { id: "choice", label: "选择 / 延迟 / 放弃" },
          { id: "confirmation", label: "交付与使用确认" },
        ],
        links: [
          { source: "trigger", target: "motivation" },
          { source: "motivation", target: "ability" },
          { source: "ability", target: "prompt" },
          { source: "prompt", target: "choice" },
          { source: "choice", target: "confirmation" },
        ],
      },
      note: "结构参考 COM-B 与 Fogg 行为条件，只表达研究逻辑，不代表已经测得因果路径或阶段转化率。",
    },
    psychology_evidence_readiness: {
      kind: "chart",
      title: "心理任务证据成熟度热力图",
      value: {
        xLabels: ["任务定义", "证据锚点", "来源完整", "验证协议"],
        yLabels: (profile.jobs || []).slice(0, 3).map((row: any[], index: number) => String(row?.[0] || `任务 ${index + 1}`)),
        matrix: readinessMatrix,
      },
      note: "0–3 只表示结构化研究合同的完整度，不表示消费者动机强度、人口占比或购买概率。",
    },
    value_risk_signal_map: {
      kind: "chart",
      title: "价值信号 × 风险信号定位图",
      value: {
        points: valueRiskPoints,
        xKey: "positive_observations",
        yKey: "negative_observations",
        labelKey: "label",
        xLabel: "正向编码观察",
        yLabel: "负向编码观察",
      },
      note: "坐标来自本轮 VOC 编码观察数；它们不是独立消费者人数、全市场发生率或购买驱动力系数。",
    },
    heuristic_watchlist: table(["可能的决策捷径", "本品类触发", "误导风险", "可信设计 / 内容响应", "当前状态", "验证方式"], [
      ["损失规避", `${themeLabel(0)} 或大件失败后果被放大`, "只放大恐惧会制造焦虑，不能证明选择偏好", "展示可核验结构、测试、包装与补件边界", "AIGC-HYPOTHESIS", "随机信息架构测试 + 风险感量表"],
      ["社会证明", "评分、评论量与场景口碑", "来源偏差、激励评论和覆盖基数会被误读", "显示来源、观察窗、验证购买与样本边界", "AIGC-HYPOTHESIS", "控制社会证明信息的概念实验"],
      ["价格-质量推断", `${config.finance?.target_price ? `$${config.finance.target_price}` : "目标价"} 与家具质感联动`, "高价不自动等于质量，低价也不等于价值", "把价格与材料、结构、测试、服务证据同时展示", "MANAGEMENT-HYPOTHESIS", "无品牌价格随机测试 + 实物盲测"],
      ["模糊厌恶", "尺寸、装配、材质、交付与售后不确定", "用笼统承诺掩盖未知会增加退货与失望", "净尺寸、步骤、包装、SLA 与未知项明确标注", "CODED-INTERPRETATION", "页面任务测试 + 咨询/退货 reason code"],
      ["现状偏好 / 延迟决策", "继续忍受旧家具或使用通用品", "功能堆叠未必足以覆盖切换成本", "证明高频任务改善，并降低购买、装配和退货摩擦", "MANAGEMENT-HYPOTHESIS", "最近一次切换访谈 + 真实试销"],
    ], "清单只用于设计实验和防止误导性表达；在真实实验前不得宣称某种偏差驱动了购买。"),
    validation_sequence: [
      "12–15 名目标用户关键事件访谈，分离功能、情绪与社交进展",
      "8–12 户实物任务测试，记录理解、装配、取放与失败行为",
      "按效应量重算样本的无品牌概念 / 价格随机测试",
      "小批真实流量和成熟订单复核选择、退货、售后与复购信号",
    ],
  };
}

function buildCustomerJourney(config: JsonObject, vocEvidence: JsonObject, profile: JsonObject) {
  const evidenceRows = rowsOf(vocEvidence?.evidence_log);
  const themeRows = rowsOf(vocEvidence?.theme_distribution).slice(0, 6);
  const positioning = profile.positioning || {};
  const category = categoryName(config);
  const stages = [
    {
      id: "trigger_discovery",
      stage: "触发与发现",
      question: `为什么现在要寻找新的 ${category}？`,
      touchpoints: "家庭事件、搜索、社媒/内容、类目页",
      psychology: "现状失败的 Push、理想场景的 Pull、注意与相关性",
      pattern: /外观|风格|质感|设计|场景|价格|需求|空间|升级|替代/i,
      response: `用真实场景先讲清 ${positioning.frame || category} 的单一价值主张`,
      metric: "qualified_reach / engaged_view",
      adapter: "search-demand-adapter + behavior-analytics-adapter",
    },
    {
      id: "consideration",
      stage: "初步比较",
      question: "它是否适合我的空间、任务和预算？",
      touchpoints: "搜索结果、PDP 首屏、尺寸图、对比表",
      psychology: "感知价值、认知负荷、价格-质量推断、可比性",
      pattern: /尺寸|容量|兼容|收纳|材质|价格|功能|空间|包络/i,
      response: "用净尺寸、任务包络、材料与 Must-have 证据降低比较成本",
      metric: "comparison_to_detail / size_guide_use",
      adapter: "behavior-analytics-adapter",
    },
    {
      id: "validation",
      stage: "信任验证",
      question: "质量、耐久、安全和品牌承诺可信吗？",
      touchpoints: "评论、Q&A、结构特写、测试、品牌页",
      psychology: "感知风险、社会证明、模糊厌恶、损失规避",
      pattern: /质量|耐久|稳定|承重|安全|异响|导轨|门缝|结构|信任|评价/i,
      response: (positioning.reasons || []).join("；") || "把卖点绑定到结构、测试和来源证据",
      metric: "evidence_interaction / qualified_add_to_cart",
      adapter: "review-voc-adapter + behavior-analytics-adapter",
    },
    {
      id: "purchase",
      stage: "购买决策",
      question: "价格、交付和退换风险是否值得现在下单？",
      touchpoints: "购物车、促销、配送承诺、退换政策",
      psychology: "机会成本、损失规避、确定性与默认选项",
      pattern: /价格|配送|到货|退货|退款|库存|促销|交付/i,
      response: "同时展示真实到手价、配送边界、退换条件与可兑现服务",
      metric: "checkout_start / purchase / contribution",
      adapter: "advertising-adapter + orders-returns-adapter",
    },
    {
      id: "delivery",
      stage: "到货与开箱",
      question: "是否准时、完整、无破损地收到？",
      touchpoints: "物流通知、包裹、开箱、缺件入口",
      psychology: "预期确认、控制感、峰终效应的首个关键节点",
      pattern: /包装|破损|物流|到货|错箱|缺件|运输|箱/i,
      response: config.logistics?.company_advantage || "分箱防错、易损面保护与快速缺件入口",
      metric: "on_time_delivery / damage / split_shipment",
      adapter: "service-logistics-adapter",
    },
    {
      id: "assembly_onboarding",
      stage: "装配与启用",
      question: "能否一次装对并顺利开始使用？",
      touchpoints: "说明书、零件编码、视频、客服与补件",
      psychology: "能力、努力成本、自我效能与挫败恢复",
      pattern: /装配|组装|说明|孔位|五金|螺丝|补件|安装/i,
      response: "零件编码、关键步骤可视化、错误恢复与部件级补发",
      metric: "task_success / assembly_time / parts_ticket",
      adapter: "survey-concept-test-adapter + service-logistics-adapter",
    },
    {
      id: "use_value",
      stage: "持续使用",
      question: "高频任务是否真的更顺手、稳定并值得价格？",
      touchpoints: "日常使用、清洁维护、客服、保修",
      psychology: "习惯形成、价值确认、失望差距与认知失调",
      pattern: /使用|清洁|异响|抽屉|柜门|稳定|耐久|收纳|充电|排骨|线缆|活动件/i,
      response: (profile.jobs || []).slice(0, 2).map((row: any[]) => row?.[4]).filter(Boolean).join("；"),
      metric: "task_success / defect / support_contact",
      adapter: "review-voc-adapter + service-logistics-adapter",
    },
    {
      id: "advocacy_return",
      stage: "评价、推荐或退货",
      question: "体验是否足以推荐，还是需要退货和补救？",
      touchpoints: "评价请求、退货、退款、补件、复购/推荐",
      psychology: "峰终效应、公平感、服务恢复与购后确认",
      pattern: /评价|推荐|退货|退款|客服|售后|补件|保修|复购|失望/i,
      response: "先解决问题再请求评价；保留 reason code、恢复时长和成熟订单口径",
      metric: "return / resolution_time / verified_review / repeat_order",
      adapter: "orders-returns-adapter + service-logistics-adapter + review-voc-adapter",
    },
  ];
  const stageEvidence = stages.map((stage) => {
    const matched = evidenceRows.filter((row) => stage.pattern.test(row.map((cell) => String(cell || "")).join(" ")));
    return {
      ...stage,
      observations: matched.length,
      evidence_ids: matched.slice(0, 4).map((row) => String(row?.[0] || "")).filter(Boolean),
      matched,
    };
  });
  const heatmap = stageEvidence.map((stage) => themeRows.map((theme) => {
    const label = String(theme?.[0] || "");
    return stage.matched.filter((row) => normalizeVocThemeBucket(row?.[5]) === label).length;
  }));

  return {
    framework: "End-to-end customer journey｜pre-purchase + purchase + post-purchase",
    status: "EVIDENCE-GATED",
    evidence_boundary: "当前旅程中的阶段、心理机制和触点关系属于研究编码；图表只显示本轮可追溯 VOC 观察覆盖，不显示未经行为事件验证的流量、转化或流失率。",
    journey_flow: {
      kind: "chart",
      title: "端到端消费旅程｜从触发到推荐 / 退货",
      value: {
        nodes: stageEvidence.map((stage) => ({ id: stage.id, label: stage.stage })),
        links: stageEvidence.slice(0, -1).map((stage, index) => ({ source: stage.id, target: stageEvidence[index + 1].id })),
      },
      note: "箭头表示研究顺序，不是线性必经路径；消费者可能跳步、循环或同时接触多个品牌、伙伴与外部触点。",
    },
    stage_contract: table(
      ["阶段", "消费者问题", "主要触点", "心理机制假设", "本轮证据覆盖", "产品 / 内容 / 服务响应", "未来 KPI", "数据适配器", "状态"],
      stageEvidence.map((stage) => [
        stage.stage,
        stage.question,
        stage.touchpoints,
        stage.psychology,
        stage.observations ? `${stage.observations} 条编码观察｜${stage.evidence_ids.join(" / ")}` : "0 条｜PENDING",
        stage.response || "响应待定义",
        stage.metric,
        stage.adapter,
        stage.observations ? "CODED-INTERPRETATION" : "PENDING",
      ]),
      "同一观察可能关联多个阶段，因此各阶段覆盖数不可相加为样本量。未来 KPI 接口就绪但真实数据未接入。",
    ),
    touchpoint_pain_heatmap: {
      kind: "chart",
      title: "旅程阶段 × VOC 主题摩擦热力图",
      value: {
        xLabels: themeRows.map((row) => String(row?.[0] || "未分类")),
        yLabels: stageEvidence.map((stage) => stage.stage),
        matrix: heatmap,
      },
      note: "数值是将本轮编码观察按关键词规则映射到旅程阶段后的记录数；属于可复核编码解释，不是阶段发生率或转化损失。",
    },
    stage_evidence_coverage: {
      kind: "chart",
      title: "各旅程阶段的现有证据覆盖",
      value: {
        items: stageEvidence.map((stage) => ({ label: stage.stage, value: stage.observations, unit: " 条" })),
      },
      note: "覆盖为编码观察关联数；0 表示当前证据缺口，不表示该阶段没有问题。",
    },
    expectation_gap_register: table(["阶段", "消费者预期", "潜在落差", "最早信号", "责任动作", "验证 / 停止线"], stageEvidence.map((stage) => [
      stage.stage,
      stage.question,
      stage.observations ? `${themeRows.slice(0, 2).map((row) => row?.[0]).join(" / ")} 等主题需在该阶段复核` : "PENDING｜当前无可归因观察",
      stage.observations ? `${stage.observations} 条方向性编码观察` : "接入未来 KPI 与原始事件",
      stage.response || "定义产品、内容或服务响应",
      `由 ${stage.adapter} 提供 ${stage.metric}；未接入前不得宣称改善`,
    ]), "期望落差登记用于提前设计证据和服务恢复，不把推断的心理机制写成消费者原话。"),
    ownership: table(["旅程域", "主责", "共同责任", "董事会停止线"], [
      ["触发—信任", "品牌 / 电商", "研究 / 产品", "定位与证据无法被目标用户理解则退回"],
      ["购买", "电商 / 财务", "广告 / 法务", "贡献、价格或承诺口径未过门则不放量"],
      ["到货—启用", "物流 / 包装", "产品 / 客服", "安全、破损、错箱或装配硬闸失败则冻结"],
      ["使用—恢复", "产品 / 质量", "客服 / 数据", "成熟订单退货、故障或恢复指标突破红线则 CAPA"],
    ]),
  };
}

function buildExecutionBacklog(config: JsonObject) {
  const evidence = sourceIds(config);
  const phaseMetadata: JsonObject[] = [
    { id: "D0-14", priority: "P0", window: "D0–14", title: "补证、RFQ、税则与合规预审", dependencies: [] as string[] },
    { id: "D15-30", priority: "P0", window: "D15–30", title: "STP/JTBD 概念与价格测试、DFM 冻结", dependencies: ["D0-14"] },
    { id: "D31-60", priority: "P0", window: "D31–60", title: "EVT/DVT、结构、包装与合规验证", dependencies: ["D15-30"] },
    { id: "D61-90", priority: "P1", window: "D61–90", title: "小批真实履约与成熟订单复盘", dependencies: ["D31-60"] },
  ];
  const contracts: JsonObject[] = CATEGORY_EXECUTION_CONTRACTS[config.slug] || [];
  const formatSourceRows = (value: unknown) => rowsOf(value)
    .map((row) => row.filter((cell) => cell !== undefined && cell !== null && cell !== "").join("："))
    .join("；");
  const sourceContractsFor = (phaseId: string) => {
    if (phaseId === "D31-60") return `产品验证矩阵｜${formatSourceRows(config.product?.validation)}`;
    if (phaseId === "D61-90") {
      return `财务放行线｜${formatSourceRows(config.finance?.approval_gates)}；物流运营红线｜${formatSourceRows(config.logistics?.operating_kpis)}`;
    }
    return `财务放行线｜${formatSourceRows(config.finance?.approval_gates)}`;
  };
  const phases: JsonObject[] = phaseMetadata.map((metadata: JsonObject): JsonObject => {
    const contract = contracts.find((item: JsonObject) => item.id === metadata.id);
    if (!contract) throw new Error(`Missing execution contract for ${String(config.slug)} ${metadata.id}`);
    const acceptanceContract = {
      ...contract.acceptance_contract,
      source_contracts: sourceContractsFor(metadata.id),
    };
    return { ...metadata, ...contract, acceptance_contract: acceptanceContract };
  });
  const items = phases.map((phase: JsonObject, index) => ({
    id: `TASK-${config.slug}-${index + 1}`,
    priority: phase.priority,
    time_window: phase.window,
    title: phase.title,
    task: phase.title,
    category_action: phase.category_action,
    owner_role: phase.owner,
    owner: phase.owner,
    deliverable: phase.deliverable,
    acceptance_contract: phase.acceptance_contract,
    acceptance: `指标：${phase.acceptance_contract.metric}；阈值：${phase.acceptance_contract.threshold}；样本/观察窗：${phase.acceptance_contract.sample_window}；证据：${phase.acceptance_contract.evidence}；签核人：${phase.acceptance_contract.approver}；来源合同：${phase.acceptance_contract.source_contracts}`,
    dependency_ids: phase.dependencies.map((dependency: string) => `TASK-${config.slug}-${phases.findIndex((item: JsonObject) => item.id === dependency) + 1}`),
    dependencies: phase.dependencies,
    gate_type: phase.gate_type,
    stop_line: phase.stop_line,
    gate: phase.stop_line,
    evidence_ids: evidence,
    ...(phase.maturity_rule ? { maturity_rule: phase.maturity_rule } : {}),
    ...(phase.insufficient_evidence_rule ? { insufficient_evidence_rule: phase.insufficient_evidence_rule } : {}),
    prioritization: {
      method: "HARD_GATE_DEPENDENCY",
      score: null,
      status: "ACTIVE",
      rule: "串行阶段只能在依赖阶段验收后启动；任何硬闸门失败都不能被加权分数覆盖。",
    },
    optional_experiment_scoring: {
      method: "RICE",
      reach: null,
      impact: null,
      confidence: null,
      effort_person_weeks: null,
      capital_required_usd: null,
      score: null,
      status: "PENDING",
      rule: "仅对同一已放行阶段内的可选实验排序；Effort 只用 person-weeks，现金投入单列且不进入 Effort。",
    },
    next_action: index === 0 ? "登记负责人并启动证据缺口/RFQ 清单" : `等待 ${phase.dependencies.join(" / ")} 验收后启动`,
    status: "PENDING",
  }));
  return {
    framework: "90-day evidence-gated backlog",
    objective: "只投入足够获得下一阶段信息的资源；每阶段可继续、迭代或停止。",
    items,
    table: table(["ID", "优先级", "时间窗", "任务", "Owner", "交付物", "验收线", "依赖", "停止线", "状态"], items.map((item) => [
      item.id,
      item.priority,
      item.time_window,
      item.title,
      item.owner_role,
      item.deliverable,
      item.acceptance,
      item.dependency_ids.join(" / ") || "无",
      item.stop_line,
      item.status,
    ])),
  };
}

export function buildStrategyFrameworks(config: JsonObject, vocEvidence: JsonObject) {
  const profile = CATEGORY_STRATEGY[config.slug];
  if (!profile) throw new Error(`Missing strategy profile for ${String(config.slug || "unknown")}`);
  const jtbd = buildJtbd(config, vocEvidence, profile);
  const stp = buildStp(config, profile);
  const bcg = buildBcg(config);
  const consumerPsychology = buildConsumerPsychology(config, vocEvidence, profile, jtbd);
  const customerJourney = buildCustomerJourney(config, vocEvidence, profile);
  const executionBacklog = buildExecutionBacklog(config);
  return {
    framework_version: STRATEGY_FRAMEWORK_VERSION,
    decision_chain: [
      "VOC evidence",
      "JTBD",
      "消费者心理机制与证据门",
      "端到端消费旅程与触点摩擦",
      "STP",
      "产品规格 / AIGC 概念",
      "Unit Economics 硬门",
      "Ansoff 输入门",
      "经典 BCG 输入门",
      "独立吸引力-能力矩阵",
      "RICE / ICE 可选实验排序",
      "90 天依赖待办",
      "成熟订单复盘",
    ],
    jtbd,
    consumer_psychology: consumerPsychology,
    customer_journey: customerJourney,
    stp,
    bcg,
    execution_backlog_90d: executionBacklog,
    complementary_frameworks: {
      ansoff: {
        status: "PENDING",
        route: null,
        required_inputs: ["current_portfolio_category", "country", "channel", "customer"],
        classification_rule: "只有在当前产品组合/品类、国家、渠道和客户四项均由管理层确认后，才能分类为市场渗透、产品开发、市场开发或多元化。",
        boundary: "若进入新国家、新渠道或全新人群，必须重新验证市场、合规、单位经济与组织能力，不沿用本报告结论。",
      },
      rice_input_gate: {
        status: "PENDING",
        formula: "Reach × Impact × Confidence / Effort",
        required_inputs: ["90 天可触达真实订单或用户数", "预定义业务影响档位", "证据置信等级", "Effort（person-weeks）"],
        effort_unit: "person-weeks",
        capital_input: { field: "capital_required_usd", unit: "USD", included_in_effort: false },
        use_scope: "只用于已通过硬闸门阶段内的可选实验排序，不用于四个串行阶段排序。",
        rule: "输入未齐备前不生成 RICE 分数；现金投入与人周分列；P0 来自硬闸门与依赖顺序。",
      },
      ice_input_gate: {
        status: "OPTIONAL-PENDING",
        methodology_source_id: "METHOD-ICE",
        method_version: "ICE-ARITHMETIC-MEAN-V1",
        formula: "(Impact + Confidence + Ease) / 3",
        scale: { min: 0, max: 10, applies_to: ["Impact", "Confidence", "Ease"] },
        ease_convention: "Ease 是 Effort 的反向量表：投入越小、越容易执行，Ease 分越高。",
        effort_reference_unit: "person-weeks",
        capital_input: { field: "capital_required_usd", unit: "USD", included_in_ease: false },
        rule: "只用于 Reach 不可得时的早期可选实验初筛；固定使用算术平均，不得与乘法 ICE 混排，现金资本单列。",
      },
      pre_mortem: "复用 pre_mortem_redteam 模块，列出最早信号、预防动作和止损线。",
    },
    data_adapter_contract: buildResearchDataAdapterRegistry(
      categoryName(config),
      String(config.marketplace || "Amazon US"),
    ),
    methodology_sources: METHODOLOGY_SOURCES,
  };
}
