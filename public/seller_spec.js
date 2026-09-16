// 由多智能体设计生成：按卖家类型自适应的选品简报输入维度（工厂/品牌方/铺货）
export const SELLER = {
 "common": [
  {
   "id": "targetMargin",
   "label": "目标毛利率",
   "type": "number",
   "unit": "%",
   "placeholder": "如 35",
   "default": "35"
  },
  {
   "id": "annualRevenue",
   "label": "公司年销售规模",
   "type": "number",
   "unit": "万元 CNY",
   "placeholder": "如 80000",
   "default": "80000"
  },
  {
   "id": "ownLogistics",
   "label": "自有物流 / 履约能力",
   "type": "toggle",
   "default": "true"
  },
  {
   "id": "spApiAuth",
   "label": "SP-API 授权",
   "type": "toggle",
   "default": "false"
  }
 ],
 "blocks": {
  "factory": [
   {
    "id": "monthlyCapacityUnits",
    "label": "可动用月产能",
    "type": "number",
    "unit": "件/月",
    "placeholder": "如 30000",
    "default": "20000"
   },
   {
    "id": "existingProcesses",
    "label": "现有工艺/产线匹配",
    "type": "pills",
    "placeholder": "如 注塑/五金冲压/缝纫车缝/铝型材阳极/覆膜"
   },
   {
    "id": "costAdvantageSource",
    "label": "成本优势来源",
    "type": "segment",
    "options": [
     "原材料自采/自产",
     "核心工艺自有",
     "规模摊薄",
     "一体化省中间商",
     "暂无明显优势"
    ]
   },
   {
    "id": "toolingBudget",
    "label": "开模/模具预算",
    "type": "number",
    "unit": "元",
    "placeholder": "如 80000",
    "default": "50000"
   },
   {
    "id": "minEconomicBatch",
    "label": "最小经济批量(自定)",
    "type": "number",
    "unit": "件/批",
    "placeholder": "如 2000",
    "default": "1000"
   },
   {
    "id": "flexibilityLevel",
    "label": "产品迭代/柔性能力",
    "type": "segment",
    "default": "中等(可小批量多SKU)",
    "options": [
     "刚性大货(改款慢/单一SKU)",
     "中等(可小批量多SKU)",
     "高柔性(可快速打样迭代)"
    ]
   }
  ],
  "brand": [
   {
    "id": "productCapability",
    "label": "现有核心能力",
    "type": "pills",
    "default": [
     "品牌运营",
     "家具产品开发",
     "供应链整合",
     "自有物流"
    ],
    "options": [
     "品牌运营",
     "家具产品开发",
     "供应链整合",
     "自有物流",
     "海外仓配",
     "内容与广告投放"
    ]
   },
   {
    "id": "brand_positioning",
    "label": "品牌定位",
    "type": "segment",
    "default": "高端/溢价",
    "options": [
     "高端/溢价",
     "大众/主流",
     "性价比/走量"
    ]
   },
   {
    "id": "target_persona",
    "label": "目标人群画像",
    "type": "pills",
    "placeholder": "如 都市新中产女性 / 露营发烧友 / Z世代宠物主 / 银发健康人群"
   },
   {
    "id": "target_asp",
    "label": "目标客单价",
    "type": "number",
    "unit": "USD",
    "placeholder": "如 49"
   },
   {
    "id": "max_cac",
    "label": "可接受获客成本 CAC",
    "type": "number",
    "unit": "USD",
    "placeholder": "如 15"
   },
   {
    "id": "brand_assets",
    "label": "现有品牌资产",
    "type": "pills",
    "options": [
     "品牌注册Brand Registry",
     "官方旗舰店",
     "A+页面/品牌旗舰页",
     "私域/DTC独立站",
     "达人/KOL资源",
     "现有粉丝基本盘"
    ]
   },
   {
    "id": "ip_reserve",
    "label": "知产储备诉求",
    "type": "select",
    "default": "仅商标保护",
    "options": [
     "已有专利/外观可迁移",
     "计划为新品申请专利",
     "仅商标保护",
     "暂不涉及知产",
     "需规避他人专利雷区"
    ]
   },
   {
    "id": "ltv_focus",
    "label": "复购/LTV 诉求强度",
    "type": "segment",
    "default": "中等(可延伸产品线)",
    "options": [
     "强复购(耗材/订阅型)",
     "中等(可延伸产品线)",
     "弱(耐用/一次性)"
    ]
   }
  ],
  "reseller": [
   {
    "id": "stocking_mode",
    "label": "铺货策略",
    "type": "segment",
    "default": "半精铺(赛道内批量测)",
    "options": [
     "精铺(少量精选SKU深挖)",
     "泛铺(海量SKU广撒网)",
     "半精铺(赛道内批量测)"
    ]
   },
   {
    "id": "target_sku_count",
    "label": "本轮计划上架 SKU 数",
    "type": "select",
    "default": "10-50",
    "options": [
     "1-10(小步试)",
     "10-50",
     "50-200",
     "200-500",
     "500+"
    ]
   },
   {
    "id": "test_qty_per_sku",
    "label": "单 SKU 首单试单量",
    "type": "number",
    "unit": "件",
    "placeholder": "如 30",
    "default": "50"
   },
   {
    "id": "supplier_readystock",
    "label": "现货/小单快反依赖",
    "type": "segment",
    "default": "必须现货(拒绝备料周期)",
    "options": [
     "必须现货(拒绝备料周期)",
     "可接受短备料(≤7天)",
     "可等常规生产(15天+)"
    ]
   },
   {
    "id": "turnover_cycle",
    "label": "可接受动销周期/周转",
    "type": "select",
    "default": "15-30天",
    "options": [
     "≤15天(极快周转)",
     "15-30天",
     "30-45天",
     "45-60天(可接受慢销)"
    ]
   },
   {
    "id": "trial_budget_per_sku",
    "label": "单 SKU 可承受试错亏损",
    "type": "number",
    "unit": "元",
    "placeholder": "如 800",
    "default": "1000"
   },
   {
    "id": "trend_catch_speed",
    "label": "爆款捕捉时效偏好",
    "type": "segment",
    "default": "两者混投",
    "options": [
     "抢新趋势/早期爆品(赌爆发)",
     "跟成熟稳定需求(求确定)",
     "两者混投"
    ]
   }
  ]
 },
 "presets": {
  "factory": {
   "demand": 24,
   "growth": 16,
   "competition": 14,
   "monetization": 30,
   "seasonality": 16
  },
  "brand": {
   "demand": 24,
   "growth": 22,
   "competition": 14,
   "monetization": 30,
   "seasonality": 10
  },
  "reseller": {
   "demand": 22,
   "growth": 28,
   "competition": 22,
   "monetization": 10,
   "seasonality": 18
  }
 },
 "emphasis": {
  "factory": "把'成本优势能否在该品类真实成立并可迁移'作为一票否决级校验(CPT_VERIFY 重点核成本护城河),全程用可动用月产能与最小经济批量反推'需求量级能否撑起吃满产线的稳定订单',而非只看市场大盘热度。",
  "brand": "额外强调 monetization(溢价变现)与差异化可防御性:MIND_DECODE 深挖目标人群未被满足痛点作为差异化支点,CPT_VERIFY 重点核知产壁垒与被抄板风险,GTM 围绕现有品牌资产与 CAC 约束定制冷启动,允许在竞争略高但有溢价与知产护城河的赛道给机会。",
  "reseller": "把 MOQ/交期/备货深度作为反向淘汰硬指标(MOQ 远高于试单量即降分),优先输出现货可小单、上升期、易批量复制的候选池,弱化单品深度护城河、强调周转速度与爆款捕捉时效。"
 }
};
