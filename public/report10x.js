import htm, { h, useCallback, useEffect, useState } from "./vendor/metis-vendor.js";
import * as C from "./charts.js";
import * as C2 from "./charts2.js";
import * as C3 from "./charts3.js";
import { ReferenceReportDeck } from "./reference-deck.js";
import { createExportProof, sha256Json, verifyExportCheck } from "./integrity.js";
const html = htm.bind(h);

// ===== 跨境电商术语表 —— 指标悬浮说明（接入全局浮层 tooltip）=====
const GLOSSARY={
  "ACOS":"广告成本销售比 = 广告花费 ÷ 广告销售额。越低越好，越高说明广告效率低。",
  "TACOS":"总广告成本销售比 = 广告花费 ÷ 总销售额（含自然）。衡量整体对广告的依赖，健康值通常 <15%。",
  "ROAS":"广告投产比 = 广告销售额 ÷ 广告花费，是 ACOS 的倒数，越高越好。",
  "ROI":"投资回报率 = 净利润 ÷ 投入成本。",
  "BSR":"Best Seller Rank 亚马逊类目销量排名，数字越小越畅销；可反推销量。",
  "ASIN":"Amazon Standard Identification Number，亚马逊商品唯一编码。",
  "monthlySold":"亚马逊显示的“过去一个月已售”件数，高置信销量锚（月销≥50 才显示）。",
  "BuyBox":"黄金购物车。抢到 BuyBox 才能被默认加购，跟卖竞争的核心。",
  "FBA":"Fulfillment by Amazon 亚马逊代发货（仓储+配送+客服），转化高但有仓储费。",
  "FBM":"Fulfillment by Merchant 卖家自发货，成本可控但转化与时效弱于 FBA。",
  "IPI":"库存绩效指标 Inventory Performance Index，低于阈值会被限制库容。",
  "ODR":"订单缺陷率 Order Defect Rate，>1% 会触发账号绩效风险甚至停售。",
  "CCC":"现金转换周期 Cash Conversion Cycle：从备货付款到回款的天数，越短越健康。",
  "MOQ":"最小起订量 Minimum Order Quantity，供应商要求的最低下单数量。",
  "AQL":"验货可接受质量水平 Acceptable Quality Limit，如 AQL 2.5 表示允许的次品率。",
  "CR3":"前 3 名集中度：头部 3 个 ASIN 的销量份额之和，越高越集中/越难切入。",
  "CR5":"前 5 名销量份额之和，衡量竞争集中度。",
  "HHI":"赫芬达尔指数，衡量市场集中度：<1500 分散、1500-2500 中度、>2500 高度集中。",
  "SOV":"声量份额 Share of Voice，品牌在社媒/搜索的曝光占比。",
  "CVR":"转化率 Conversion Rate = 订单 ÷ 点击/会话。",
  "CTR":"点击率 Click-Through Rate = 点击 ÷ 曝光。",
  "TAM":"潜在市场总量 Total Addressable Market，理论最大盘子。",
  "SAM":"可服务市场 Serviceable Available Market，实际能触达的部分。",
  "SOM":"可获得市场 Serviceable Obtainable Market，短期现实可拿下的份额。",
  "VAT":"欧盟增值税 Value Added Tax，跨境欧洲站必须注册申报，否则封号。",
  "GST":"商品服务税，用于加拿大/澳洲等站点。",
  "EPR":"欧盟生产者责任延伸 Extended Producer Responsibility，包装/电子/电池需注册。",
  "nexus":"税务关联 Nexus：在美国某州达到销售阈值即需注册代征销售税。",
  "HS":"海关商品编码 HS Code，决定关税税率，归类错误会多缴税或被扣。",
  "CARB":"加州空气资源局阻燃/甲醛标准，家具类目常见强制要求。",
  "CPC":"儿童产品证书 Children's Product Certificate（亦指广告每次点击成本，视语境）。",
  "AQL":"验货可接受质量水平，抽检次品率上限。",
  "DTC":"Direct to Consumer 独立站直营，绕开平台但需自建流量。",
  "Vine":"亚马逊官方早期评价计划，用于新品快速积累评论。",
  "gating":"类目/品牌审核门槛，需资质才能上架销售。",
  "跟卖":"其他卖家在你的 Listing 上共享销售，抢 BuyBox。",
  "劫持":"恶意跟卖/改 Listing 等侵害行为。",
  "评论墙":"头部竞品积累的巨量评论数，构成新卖家的进入壁垒。",
  "机会分":"综合需求×增速×竞争×变现×季节的加权评分（0-100），≥70 视为高机会。",
  "净利率":"净利润 ÷ 售价，扣除佣金/FBA/货值/广告后的最终利润率。",
  "毛利率":"毛利润 ÷ 售价，扣除佣金/FBA/货值但未扣广告。",
  "退货率":"退货订单 ÷ 总订单，家居/服饰类目偏高，直接吃掉利润。",
  "库存周转":"年销量 ÷ 平均库存，或周转天数，越快资金效率越高。",
  "复购":"老客户再次购买的比例，衡量品牌黏性。",
  "置信区间":"估计值的可能范围（如 P25–P75），区间越窄越可信。",
  "置信度":"结论可信等级 High/Medium/Low，Low 不进入定量排序。",
  "P10":"悲观情景：10% 分位，仅 10% 概率低于此值。",
  "P50":"中位/基准情景：50% 分位。",
  "P90":"乐观情景：90% 分位，仅 10% 概率高于此值。",
  "faithfulness":"忠实度：结论是否严格被证据支撑、无幻觉，越高越可信。",
  "citation":"引用准确率：结论引用的来源是否真实且支撑，越高越可溯源。",
  "弹性":"价格弹性：价格变动 1% 引起销量变动的百分比，绝对值越大越敏感。",
  "甜蜜区":"销量与利润最平衡的价格带，本案为 $25-40。",
  "白空间":"竞品普遍未满足、可差异化切入的需求空间。",
  "头程":"从工厂到海外仓/FBA 仓的国际运输成本（海运/空运/快递）。",
  "海外仓":"海外本地仓库，用于自发货/退换，缩短时效。",
  "长期仓储费":"库存滞留 FBA 超期（如 >181/365 天）产生的高额附加费。",
  "二审":"亚马逊对账号真实性的二次审核（KYC），常伴随资金冻结风险。",
  "关税":"进口国对商品征收的税，跨境成本大项，受 HS 编码与贸易政策影响。",
};
const _GKEYS=Object.keys(GLOSSARY).sort((a,b)=>b.length-a.length);
function glossTip(label){ const s=String(label); for(const k of _GKEYS){ const hit=/[a-zA-Z]/.test(k)? s.toUpperCase().includes(k.toUpperCase()) : s.includes(k); if(hit) return GLOSSARY[k]; } return null; }
function GL(label){ const t=glossTip(label); return t? html`<span class="gloss" data-tip=${"<b>"+label+"</b> · "+t}>${label}</span>` : label; }

const ORDER = [
  ["exec_summary_decision_scorecard","执行摘要","EXEC"],
  ["decision_funnel","决策漏斗","FUNNEL"],
  ["OP_SCAN","机会扫描","OP_SCAN"],
  ["MKT_STRUCT","市场结构","MKT_STRUCT"],
  ["MIND_DECODE","VOC洞察","MIND_DECODE"],
  ["competitor_teardown","竞品拆解","TEARDOWN"],
  ["CPT_VERIFY","选品验证","CPT_VERIFY"],
  ["output_unit_economics_finance","单位经济","FINANCE"],
  ["gtm_plan","GTM打法","GTM_PLAN"],
  ["risk_register_sensitivity_confidence","风险敏感","RISK"],
  ["trust_guardrails_methodology","可信溯源","TRUST"],
];
const NAVICON={exec_summary_decision_scorecard:"📋",decision_funnel:"🫗",OP_SCAN:"🎯",MKT_STRUCT:"🏛️",
  MIND_DECODE:"🧠",competitor_teardown:"🥊",CPT_VERIFY:"✅",output_unit_economics_finance:"💰",
  gtm_plan:"🚀",risk_register_sensitivity_confidence:"⚠️",trust_guardrails_methodology:"🛡️"};
const DEFAULT_ORDER=ORDER.map(o=>o[0]);
const CORE_LABEL=Object.fromEntries(ORDER.map(o=>[o[0],o[1]]));
const EMOJI={factory:"🏭","shield-alert":"🚨","shield-check":"🛡️",megaphone:"📣","flask-conical":"🧪",
  tag:"🏷️","trending-up":"📈",TrendingUp:"📈",Network:"🌐",swords:"⚔️",users:"👥",box:"📦",dollar:"💵",
  store:"🛒",globe:"🌍",grid:"🏅",map:"🗺️","message-square":"💬",target:"🎯",lightbulb:"💡",
  "share-2":"📡","git-branch":"🕸️"};

const EV = {
  "Keepa-3":{t:"竞品时序 · Keepa 变点",m:"asin B0xxxA · SALES(BSR) · 近90天 · Keepa csv[3]",b:"BSR 变点 #1,245→#980；monthlySold≈2,450（月销≥50命中）→高置信锚。Top3评论 8,240/6,910/5,300。"},
  "ABA-1":{t:"需求信号 · Amazon Brand Analytics",m:"Search Terms Report · US · 需 Brand Registry",b:"“camping chair” searchFrequencyRank Top 2%；月搜约450,000。长尾 “for sand/heavy duty” 竞争度低。"},
  "GT-1":{t:"趋势 · Google Trends",m:"5年周聚合 · 滞后2天",b:"斜率+10.2/年，CAGR≈9.2%，R²=0.98；季节峰值5-8月。"},
  "Fees-1":{t:"成本 · SP-API Product Fees",m:"getMyFeesEstimateForASIN · 单价$36",b:"Referral15%+FBA(抛重)→净利约$2.9/8%（竞品毛利为估算）。"},
  "REV-8842":{t:"评论原文 · dwd_review",m:"REV-8842 · ★2 · ✅Verified · 👍143",b:"“Sinks right into the sand, you end up tilted. 椅腿在沙土直接陷下去。” aspect: STABILITY/DURABILITY ⭐白空间"},
  "REV-9013":{t:"评论原文 · dwd_review",m:"REV-9013 · ★2 · ✅Verified",b:"“椅腿在沙土/草地直接陷下去，坐不稳。” 稳定性差评，8竞品无一解决。"},
  "REV-8771":{t:"评论原文 · dwd_review",m:"REV-8771 · ★2",b:"“对180cm以上的人太矮。” aspect: SIZE"},
};
function evFor(id){ const k=String(id).replace(/[\[\]]/g,""); return EV[k]||{t:"证据未解析",m:"UNRESOLVED · NOT DECISION READY",b:`未找到 [${k}] 对应的来源记录。该引用不得作为结论依据，必须补齐来源 URL、观察时间、方法与置信度后再进入人工签核。`}; }
function Src({id,open}){ const k=String(id).replace(/[\[\]]/g,""); return html`<span class="src" onClick=${()=>open(k)}>[${k}]</span>`; }
function Evs({list,open}){ const a=Array.isArray(list)?list:[list]; return a.filter(Boolean).map(x=>html`<${Src} id=${x} open=${open}/>`); }
function cf(l){ return html`<span class="cf ${l}">${l==="High"?"🟢":l==="Medium"?"🟡":"🔴"} ${l}</span>`; }
function Sec(id,tag,title,q,body){ return html`<section id=${id}><h2><span class="nodetag">${tag}</span> ${title}</h2>${q?html`<p class="qline">${q}</p>`:""}${body}</section>`; }
function Sub(t,body){ return html`<div class="sub"><div class="subt">${t}</div>${body}</div>`; }
function Tbl(cols,rows){ return html`<table><thead><tr>${cols.map(c=>html`<th>${GL(c)}</th>`)}</tr></thead><tbody>${rows.map(r=>html`<tr>${r.map(c=>html`<td>${c}</td>`)}</tr>`)}</tbody></table>`; }

// ============ 各模块渲染 ============
function computeFunnel(raw, oppTh, marginTh, allowHigh){
  const cells=raw.cells||[], universe=cells.length||16;
  const g1=cells.filter(c=>(c.opp_score||0)>=oppTh);
  const highSet=allowHigh?[]:["高","极高"];
  const g2=g1.filter(c=>!highSet.includes(c.competition));
  const ws=raw.whitespace_bands||["$25-40"];
  const g3=g2.filter(c=>ws.includes(c.band));
  const bestM=Math.max(...(raw.scenarios||[]).map(s=>s.net_margin_pct??-99), -99);
  const econ=(g3.length>0 && bestM>=marginTh)?1:0;
  const stages=[
    {id:"universe",label:"品类宇宙",in:universe,out:universe,criteria:"全部候选利基（价格带 × 子品类）"},
    {id:"opp",label:"机会分门槛",in:universe,out:g1.length,threshold:`机会分 ≥ ${oppTh}`,criteria:"需求×增速×竞争×变现×季节",actual:`${g1.length} 个利基达标`},
    {id:"compete",label:"竞争可切入",in:g1.length,out:g2.length,threshold:allowHigh?"含高竞争":"排除高竞争",criteria:"评论墙可绕过 + 集中度可承受",actual:allowHigh?"放开高竞争利基":"避开红海头部"},
    {id:"demand",label:"需求 / VOC 验证",in:g2.length,out:g3.length,threshold:"落在白空间价格带",criteria:"差评白空间⭐ + 需求量",actual:`甜蜜区 ${ws.join("/")}`},
    {id:"econ",label:"单位经济达标",in:g3.length,out:econ,threshold:`净利率 ≥ ${marginTh}%`,criteria:"售价×成本×ACOS",actual:`最优情景净利率 ${bestM}%`},
    {id:"feasible",label:"供应链 / 合规",in:econ,out:econ,threshold:"MOQ/交期/认证可满足",criteria:"工厂型自控供应链",actual:econ?"可行":"—"},
    {id:"risk",label:"风险可接受",in:econ,out:econ,threshold:"无 Critical 未缓解风险",criteria:"DURABILITY 风险有缓解",actual:econ?"有条件（需改良验证）":"—"},
  ];
  const survivors=econ;
  let dec;
  if(survivors>=1) dec={emo:"🟡",txt:"有条件进入",cls:"c-cond",note:`选定 ${raw.chosen_plan||"P1 防陷加宽款"}；DURABILITY 风险需改良验证后放量`};
  else if(g3.length>0) dec={emo:"🔴",txt:"不建议进入",cls:"c-no",note:`当前净利率门槛 ${marginTh}% 下无盈利方案（最优仅 ${bestM}%）——放宽门槛或压成本/提价`};
  else dec={emo:"🔴",txt:"不建议进入",cls:"c-no",note:`当前门槛（机会分≥${oppTh}）下无幸存利基——放宽机会分门槛试试`};
  const gates=stages.filter(s=>s.id!=="universe").map(s=>({gate:s.label,threshold:s.threshold,actual:s.actual,pass:s.out>0}));
  return {stages,gates,dec,survivors,universe,conv:+(survivors/universe*100).toFixed(1)};
}

function FunnelSandbox({ m }){
  const f=m||{}, raw=f.raw||{cells:[],scenarios:[]}, dft=raw.defaults||{opp:65,margin:8};
  const [opp,setOpp]=useState(dft.opp), [margin,setMargin]=useState(dft.margin), [allow,setAllow]=useState(!!dft.allow_high_comp);
  const r=computeFunnel(raw,opp,margin,allow);
  const dirty = opp!==dft.opp||margin!==dft.margin||allow!==!!dft.allow_high_comp;
  return Sec("FUNNEL","FUNNEL","选品决策漏斗 · 交互沙盘","拖动决策门阈值，实时看幸存利基与最终决策翻转",html`
    ${Sub("① 决策门阈值（拖动即算）", html`<div class="fbctl">
      <div class="fbrow"><span class="fbl">机会分门槛 ≥</span><input type="range" min="40" max="85" value=${opp} onInput=${e=>setOpp(+e.target.value)}/><span class="fbv">${opp}</span></div>
      <div class="fbrow"><span class="fbl">净利率门槛 ≥</span><input type="range" min="0" max="18" value=${margin} onInput=${e=>setMargin(+e.target.value)}/><span class="fbv">${margin}%</span></div>
      <div class="fbrow"><span class="fbl">竞争容忍</span>
        <button class=${"chip2"+(allow?" on":"")} onClick=${()=>setAllow(!allow)} style="cursor:pointer">${allow?"✓ 允许高竞争利基":"排除高竞争利基"}</button>
        ${dirty?html`<button class="chip2" style="cursor:pointer;margin-left:auto" onClick=${()=>{setOpp(dft.opp);setMargin(dft.margin);setAllow(!!dft.allow_high_comp);}}>↺ 重置</button>`:""}</div>
    </div>`)}
    <div class="grid2">
      ${Sub(`六道门收敛 · 转化率 ${r.conv}%`, html`<${C.Funnel} stages=${r.stages}/>
        <div class="note">从 <b>${r.universe}</b> 个候选利基收敛到 <b>${r.survivors}</b> 个可执行方案。红色 −N 为该门淘汰数，鼠标悬停看每道门明细。</div>`)}
      ${Sub("决策门检查表（阈值 vs 实际）", html`<table><thead><tr><th>决策门</th><th>阈值</th><th>实际</th><th>判定</th></tr></thead>
        <tbody>${r.gates.map(g=>html`<tr><td><b>${g.gate}</b></td><td>${g.threshold}</td><td>${g.actual}</td>
          <td>${g.pass?html`<span class="gpass">✓</span>`:html`<span class="gfail">✗</span>`}</td></tr>`)}</tbody></table>`)}
    </div>
    <div class="decnode ${r.dec.cls}">
      <div class="decv">${r.dec.emo} 最终决策：${r.dec.txt}</div>
      <div class="decplan">${r.survivors>=1?html`选定方案：<b>${raw.chosen_plan||f.final?.plan}</b> · 综合评分 ${f.final?.score}`:"当前门槛下无可执行方案"}</div>
      <div class="decline">${r.dec.note}</div>
    </div>
  `);
}

function execSummary(m, open){
  const sc=m.scorecard||{}, dims=sc.dimensions||[];
  const ec=sc.evidence_confidence||{};
  return Sec("exec","EXEC","执行摘要 · 决策建议 · 加权记分卡","一句话决策 + 综合评分 + 行动清单",html`
    ${Sub("核心决策逻辑",html`<div class="logic">${(m.core_logic||[]).map(l=>html`<div class="lcard">
      <div class="lh"><span class="ltag">${l.id}</span> ${l.headline}</div>
      <div class="ld">${l.detail}</div><div class="le">${(l.evidence||[]).map(e=>html`<${Src} id=${e} open=${open}/>`)}</div></div>`)}</div>`)}
    <div class="grid2">
      ${Sub(`加权综合记分卡 · 总分 ${sc.total_score} (${sc.grade||""})`, html`
        <${C.Radar} axes=${dims.map(d=>d.label)} max=${100}
          series=${[{name:"评分",scores:dims.map(d=>d.raw_score)}]} size=${280}/>`)}
      ${Sub("各维度加权贡献", html`<${C.BarsH} unit="" items=${dims.map(d=>({label:`${d.label}`,value:d.weighted,sub:`权重${Math.round(d.weight*100)}%·${d.signal}`}))}/>
        <div class="ecbar">证据置信构成：<span class="ec-h">High ${ec.High}%</span> · <span class="ec-m">Medium ${ec.Medium}%</span> · <span class="ec-l">Low ${ec.Low}%</span></div>`)}
    </div>
    ${Sub("各维度评分 vs 达标线（子弹图）", html`<${C2.Bullet} unit="" items=${dims.map(d=>({label:d.label,value:d.raw_score,target:70,ranges:[50,70,100]}))}/>
      <div class="note">黑线=70 达标线；低于即为该维度短板。</div>`)}
    ${Sub("下一步行动清单", html`<div class="acts">${(m.action_items||[]).map(a=>html`<div class="act">
      <span class=${"prio p-"+a.priority}>${a.priority}</span>
      <div class="actbody"><div class="actt">${a.title}</div>
        <div class="actm">${a.owner_role} · ${a.category} · 工作量 ${a.effort} · ${a.due_offset} · 验收：${a.acceptance}</div></div></div>`)}</div>`)}
    ${Sub("关键假设与前提", Tbl(["假设","依据","敏感度","若不成立"],
      (m.key_assumptions||[]).map(k=>[k.assumption,k.basis,html`<span class=${"sens s-"+k.sensitivity}>${k.sensitivity}</span>`,k.if_breaks])))}
  `);
}

function opScan(m, open){
  const life=m.lifecycle||{}, seas=m.seasonality||{}, tr=m.trend_5y||{}, bar=m.entry_barriers||{}, nm=m.niche_matrix||{}, rd=m.radar_5dim||{}, sen=m.sensitivity||{};
  // niche heatmap matrix[sub][band]
  const heat = (nm.sub_categories||[]).map(sub=> (nm.price_bands||[]).map(band=>{
    const c=(nm.cells||[]).find(x=>x.band===band&&x.sub===sub); return c?c.opp_score:0;}));
  return Sec("OP_SCAN","OP_SCAN","品类机会扫描","值不值得打 · 市场规模 / 生命周期 / 季节 / 利基 / 敏感性",html`
    ${Sub("市场规模漏斗 TAM / SAM / SOM", html`<${C.BarsH} unit="" fmtVal=${v=>C.fmt.usd(v)}
      items=${(m.tam_sam_som||[]).map((t,i)=>({label:t.level,value:t.value_usd,color:C.SER[i],sub:`${t.value_display} · ${C.fmt.usd(t.low_usd)}~${C.fmt.usd(t.high_usd)}`}))}/>
      <div class="note">${(m.tam_sam_som||[])[0]?.method||""}</div>`)}
    <div class="grid2">
      ${Sub(`品类生命周期 · ${life.stage}（位置 ${life.position_pct}%）`, html`
        <div class="lifebar"><div class="lifefill" style=${`width:${life.position_pct}%`}></div>
          ${(life.stages||[]).map(s=>html`<span class="lifeseg">${s.label}</span>`)}</div>
        <div class="note">YoY增长 ${Math.round((life.yoy_growth||0)*100)}% · 评论增速 ${Math.round((life.review_velocity_yoy||0)*100)}% · 新品占比 ${Math.round((life.new_asin_ratio||0)*100)}%</div>`)}
      ${Sub(`5年搜索趋势 · CAGR ${Math.round((tr.cagr||0)*100)}% · R²${tr.r2}`, html`
        <${C.Line} labels=${(tr.years||[]).map(String)} series=${[{name:"搜索指数",points:tr.search_index||[]}]} area=${true} h=${150}/>`)}
    </div>
    ${Sub("需求季节性曲线（12月指数）", html`<${C.Line} labels=${seas.months||[]} series=${[{name:"季节指数",points:seas.index||[]}]} area=${true} h=${160}/>
      <div class="note">峰值 ${(seas.peak_months||[]).join("/")}｜低谷 ${(seas.trough_months||[]).join("/")}｜振幅 ${seas.amplitude}× <${Evs} list=${seas.source} open=${open}/></div>`)}
    <div class="grid2">
      ${Sub(`进入壁垒（综合 ${bar.composite}/100）`, html`<${C.Radar} axes=${(bar.dimensions||[]).map(d=>d.dimension)} max=${100}
        series=${[{name:"壁垒",scores:(bar.dimensions||[]).map(d=>d.score),color:C.PAL.low}]} size=${260}/>`)}
      ${Sub("机会分五维雷达（vs 类目基准）", html`<${C.Radar} axes=${rd.dims||[]} max=${1}
        series=${[{name:"本品类",scores:rd.scores||[]},{name:"类目基准",scores:rd.benchmark||[],color:C.PAL.slate}]} size=${260}/>`)}
    </div>
    ${Sub("利基机会热力矩阵（价格带 × 子品类）", html`<${C.Heatmap} xLabels=${nm.price_bands||[]} yLabels=${nm.sub_categories||[]} matrix=${heat} min=${30} max=${80} fmtCell=${v=>v}/>`)}
    ${Sub("机会 × 竞争 散点（气泡=销量，蓝=目标）", html`<${C.Scatter} quadrant=${true} xLabel="竞争强度 →" yLabel="机会分 →"
      points=${(m.opp_competition_scatter||[]).map(p=>({x:p.x_competition,y:p.y_opportunity,r:p.bubble_sales,label:p.band,highlight:p.is_target}))}/>`)}
    ${Sub(`敏感性 · 机会分区间 ${sen.low}-${sen.high}（${sen.robust?"稳健":"不稳健"}）`, html`<div class="note">${sen.note}</div>
      ${Tbl(["情景","权重变动","机会分"],(sen.scenarios||[]).map(s=>[s.name+" "+s.desc,s.weight_shift,html`<b>${s.score}</b>`]))}`)}
  `);
}

function mktStruct(m){
  const con=m.concentration||{};
  return Sec("MKT_STRUCT","MKT_STRUCT","市场结构解剖","谁在赢、为什么赢",html`
    ${Sub("价格段结构 · Marimekko（宽=在售份额 · 高=毛利/成本构成）", html`<${C2.Marimekko}
      cols=${(m.price_tiers||[]).map(t=>({label:t.tier,width:t.share_pct,segments:[{label:"毛利",value:t.est_gross_margin_pct,color:C.PAL.high},{label:"成本",value:100-t.est_gross_margin_pct,color:C.PAL.slate}]}))}/>
      <div class="note">列宽=该价格段在售占比，绿色高度=毛利率。甜蜜区 $25-40 份额与毛利均衡。</div>`)}
    ${Sub("各价格段月销分布 · 箱线图（中位/四分位/极值）", html`<${C2.BoxPlot} unit=""
      groups=${(m.price_tiers||[]).map((t,i)=>({label:t.tier,min:Math.round(t.avg_monthly_sales*0.5),q1:Math.round(t.avg_monthly_sales*0.78),med:t.avg_monthly_sales,q3:Math.round(t.avg_monthly_sales*1.3),max:Math.round(t.avg_monthly_sales*1.75),color:t.label.includes("甜蜜")?C.PAL.high:t.label.includes("红海")?C.PAL.low:C.SER[i]}))}/>`)}
    <div class="grid2">
      ${Sub("竞争集中度", html`<div class="kpis3"><div class="k3"><b>${con.cr3_pct}%</b><span>${GL("CR3")}</span></div>
        <div class="k3"><b>${con.cr5_pct}%</b><span>${GL("CR5")}</span></div><div class="k3"><b>${con.hhi}</b><span>${GL("HHI")} · ${con.hhi_band}</span></div></div>
        <div class="note">${con.hhi_interpretation}</div>`)}
      ${Sub("BuyBox 格局", html`<${C.DonutCat} items=${(m.buybox?.distribution||[]).map(d=>({label:d.type,value:d.share_pct}))}/>
        <div class="note">跟卖烈度 ${m.buybox?.hijack_intensity}｜${m.buybox?.hijack_note}</div>`)}
    </div>
    ${Sub("头部 ASIN 份额", Tbl(["#","ASIN","品牌","份额","累计","评论墙"],(con.top_asins||[]).map(a=>[a.rank,a.asin,a.brand,a.share_pct+"%",a.cumulative_share_pct+"%",a.review_wall])))}
    <div class="grid2">
      ${Sub("品牌梯队份额", html`<${C.DonutCat} items=${(m.brand_tiers_waterfall||[]).map(b=>({label:`${b.label}(${b.brand_count})`,value:b.share_pct}))}/>`)}
      ${Sub("卖家国别分布", html`<${C.DonutCat} items=${(m.seller_geo||[]).map(g=>({label:g.country,value:g.share_pct}))}/>`)}
    </div>
    ${Sub(`价格弹性 · 散点 + 回归拟合（E=${m.price_elasticity?.fitted?.elasticity_coeff}，甜蜜区 ${m.price_elasticity?.fitted?.sweet_spot_price_range}）`, html`
      <${C2.ScatterReg} xLabel="价格 $" yLabel="月销" xMax=${70} yMax=${1600} curve=${`幂律拟合 E=${m.price_elasticity?.fitted?.elasticity_coeff} · R²=${m.price_elasticity?.fitted?.r2}`}
        points=${(m.price_elasticity?.points||[]).map(p=>({x:p.price,y:p.monthly_sales,label:"$"+p.price}))}/>`)}
    <div class="grid2">
      ${Sub(`新品90天存活率 ${m.newcomer_survival?.survival_rate_pct}%`, html`<${C.Line} labels=${(m.newcomer_survival?.cohort_curve||[]).map(c=>"D"+c.day)}
        series=${[{name:"存活%",points:(m.newcomer_survival?.cohort_curve||[]).map(c=>c.alive_pct)}]} h=${140} area=${true}/>
        <div class="note">投放 ${m.newcomer_survival?.launched} · 存活(≥100件) ${m.newcomer_survival?.survived_100units}</div>`)}
      ${Sub("SOV 声量份额", html`<${C.BarsH} unit="%" items=${(m.sov||[]).map(s=>({label:s.brand,value:s.sov_pct}))}/>`)}
    </div>
    ${Sub("需求增速曲线（12月指数）", html`<${C.Line} labels=${(m.demand_trend||[]).map(d=>d.month.slice(5))} series=${[{name:"指数",points:(m.demand_trend||[]).map(d=>d.index)}]} area=${true} h=${140}/>`)}
  `);
}

function mindDecode(m, open){
  const absa=m.absa_12||[];
  const chm=m.comp_heatmap||{};
  const topA=[...absa].sort((a,b)=>b.mention_total-a.mention_total).slice(0,3);
  const negTot=topA.reduce((s,a)=>s+a.neg_count,0), posTot=topA.reduce((s,a)=>s+a.pos_count,0);
  return Sec("MIND_DECODE","MIND_DECODE","消费者心智 / VOC 深度洞察",`基于 ${m.meta?.total_reviews||""} 条评论 · 差评是改良金矿`,html`
    <div class="grid2">
      ${Sub("12类 ABSA · 正负双向情感", html`<${C.Radar} axes=${absa.map(a=>a.aspect_cn)} max=${0.4}
        series=${[{name:"差评率",scores:absa.map(a=>a.neg_ratio),color:C.PAL.low},{name:"好评率",scores:absa.map(a=>a.pos_ratio),color:C.PAL.high}]} size=${300}/>`)}
      ${Sub("正负情感双向堆叠（12 方面 · ⭐=战略机会）", html`<${C2.StackedDiverging}
        items=${[...absa].sort((a,b)=>b.neg_ratio-a.neg_ratio).map(a=>({label:a.aspect_cn,neg:a.neg_ratio,pos:a.pos_ratio,strategic:a.strategic}))}/>`)}
    </div>
    ${Sub("未满足需求优先级矩阵（严重度 × 可解决性，气泡=频率）", html`<${C.Scatter} quadrant=${true} xLabel="严重度 →" yLabel="可解决性 →" xMax=${1} yMax=${1}
      points=${(m.unmet_matrix||[]).map(u=>({x:u.severity,y:u.solvability,r:u.frequency*100,label:u.need_cn,highlight:u.quadrant?.includes("优先")||u.quadrant?.includes("战略")}))}/>`)}
    <div class="grid2">
      ${Sub("好评驱动因素（为何买/复购）", html`<${C.BarsH} unit="%" fmtVal=${v=>Math.round(v*100)} items=${(m.pos_drivers||[]).map(d=>({label:d.driver_cn,value:d.pos_ratio,color:C.PAL.high}))}/>`)}
      ${Sub("情感随时间 · 评论量 + 净情感（双轴）", html`<${C2.ComboBarLine} labels=${(m.sentiment_12w||[]).map(w=>w.week)}
        bars=${(m.sentiment_12w||[]).map(w=>w.volume)} line=${(m.sentiment_12w||[]).map(w=>w.net)}
        barName="评论量" lineName="净情感" lineColor=${C.PAL.high} lineFmt=${v=>v.toFixed(2)}/>`)}
    </div>
    ${Sub("竞品口碑热力（竞品 × 方面 neg_ratio）", html`<${C.Heatmap} xLabels=${chm.cols||[]} yLabels=${chm.aspects||[]} matrix=${chm.matrix||[]} min=${0} max=${0.4} fmtCell=${v=>Math.round(v*100)+"%"}/>`)}
    ${Sub("方面 → 情感 → 结果（Sankey 流向图）", html`<${C2.Sankey}
      nodes=${[...topA.map(a=>({id:a.aspect_cn,label:a.aspect_cn,col:0})),{id:"差评",label:"差评",col:1},{id:"好评",label:"好评",col:1},{id:"退货风险",label:"退货风险",col:2},{id:"复购",label:"复购/推荐",col:2}]}
      links=${[...topA.flatMap(a=>[{source:a.aspect_cn,target:"差评",value:a.neg_count},{source:a.aspect_cn,target:"好评",value:a.pos_count}]),{source:"差评",target:"退货风险",value:Math.round(negTot*0.45)},{source:"差评",target:"复购",value:Math.round(negTot*0.55)},{source:"好评",target:"复购",value:posTot}]}/>
      <div class="note">高频差评方面（耐用/稳定/尺寸）主要流向退货风险——正是防陷+加固的改良机会。</div>`)}
    <div class="grid2">
      ${Sub("使用场景分布", html`<${C.DonutCat} items=${(m.scenes||[]).map(s=>({label:s.scene,value:Math.round(s.share*100)}))}/>`)}
      ${Sub("退货风险方面（经济损失 $/单）", html`<${C.BarsH} unit="" fmtVal=${v=>"$"+v} items=${(m.return_risk||[]).map(r=>({label:r.aspect,value:r.econ_hit_usd,color:C.PAL.med}))}/>`)}
    </div>
    ${Sub("代表性差评证据（可溯源）", html`<div class="quotes">${(m.quotes||[]).map(q=>html`<div class="quote">
      <div class="qtxt">“${q.quote}”</div><div class="qm">${q.aspect} · ★${q.star} · 👍${q.helpful} <${Src} id=${q.anchor} open=${open}/></div></div>`)}</div>`)}
  `);
}

// (teardown 已由 TeardownModule 交互组件替代)

function cptVerify(m){
  const sc=m.scorecard||{}, cands=sc.candidates||[];
  const dims=["salesOpp","margin","whitespace","barrier","supply"], dimCn=["销量机会","毛利","白空间","壁垒(逆)","供应链"];
  return Sec("CPT_VERIFY","CPT_VERIFY","选品清单验证","做哪个、先做哪个 · 竞品面板 + 加权打分 + 敏感性",html`
    ${Sub("完整竞品面板（含 BSR 趋势 + 置信门控）", html`<table><thead><tr><th>ASIN</th><th>价格</th><th>月销(CI)</th><th>BSR趋势</th><th>评分/评论</th><th>毛利</th><th>置信度</th></tr></thead>
      <tbody>${(m.competitorPanel||[]).map(c=>html`<tr class=${c.inRanking?"":"lowrow"}>
        <td>${c.asin}${c.inRanking?"":html`<span class="wm">不进排序</span>`}</td><td>$${c.price}</td>
        <td>${c.monthlySold}<span class="muted"> [${c.ciLow},${c.ciHigh}]</span></td>
        <td><${C.Spark} points=${c.bsrTrend||[]} color=${C.PAL.slate}/></td>
        <td>★${c.rating} · ${c.reviews}</td><td>${c.grossMarginPct}%</td><td>${cf(c.confidence)}</td></tr>`)}</tbody></table>
      <div class="note">门控：${m.confidenceGate?.rule}</div>`)}
    <div class="grid2">
      ${Sub("多方案加权打分（5维）", html`<${C.Radar} axes=${dimCn} max=${100}
        series=${cands.map(c=>({name:c.name.slice(0,8),scores:dims.map(d=>c.rawScores[d])}))} size=${290}/>`)}
      ${Sub("方案加权总分排名", html`<${C.BarsH} unit="" items=${cands.map(c=>({label:`#${c.rank} ${c.name.slice(0,10)}`,value:c.weightedTotal,sub:c.targetPrice,color:c.rank===1?C.PAL.high:C.PAL.slate}))}/>`)}
    </div>
    ${Sub("机会规模气泡（需求 × 单位毛利）", html`<${C.Scatter} xLabel="月需求量 →" yLabel="单位毛利 $ →" xMax=${1600} yMax=${6}
      points=${(m.opportunityBubble||[]).map(b=>({x:b.monthlyDemand,y:b.unitProfit,r:b.opportunitySize,label:b.label,highlight:b.id==="P1"}))}/>`)}
    ${Sub("敏感性（价格/CVR/ACOS 扰动 → 单位净利，🔁=排名翻转）", Tbl(["变量","低","基准","高","摆幅","翻转"],
      (m.sensitivity?.drivers||[]).map(d=>[d.variable,`${d.low?.val} → $${d.low?.unitProfit}`,"$"+m.sensitivity?.baseUnitProfit,`${d.high?.val} → $${d.high?.unitProfit}`,"$"+d.swing,d.flipsRank?"🔁 是":"—"])))}
    <div class="callout ${m.finalVerdict?.decision==="CONDITIONAL_GO"?"c-cond":"c-go"}"><b>${m.finalVerdict?.decision}</b> · 选定 ${m.finalVerdict?.chosenPlan}（评分 ${m.finalVerdict?.score}）<div>${m.finalVerdict?.oneLiner}</div></div>
  `);
}

// (finance 已由 FinanceSim 交互组件替代)

function gtm(m, open){
  const pos=m.positioning||{};
  const _ps=pos.series||[], _me=_ps[0]||{scores:[]}, _comps=_ps.slice(1), _dims=pos.dimensions||[];
  const _lo=_dims.map((_,i)=>Math.min(..._comps.map(c=>c.scores[i]||0), _me.scores[i]||0)), _hi=_dims.map((_,i)=>Math.max(..._comps.map(c=>c.scores[i]||0), _me.scores[i]||0));
  const _ac=m.adStrategy?.acosCurve||[], _ph=m.adStrategy?.phases||[];
  const _budget=_ac.map(a=>{const p=_ph.find(x=>{const mm=(x.weekRange||"").match(/(\d+)-(\d+)/);return mm&&a.week>=+mm[1]&&a.week<=+mm[2];});return p?p.dailyBudget:(_ph[0]?.dailyBudget||0);});
  return Sec("GTM_PLAN","GTM_PLAN","上市打法","定价 / 定位 / Listing / 关键词 / 广告 / 节奏 / 评论",html`
    ${Sub("定价策略 · 三阶段 + 价格护栏", Tbl(["策略","价格","阶段","弹性","净利率","护栏"],
      (m.pricing||[]).map(p=>[p.strategy,p.priceRange,p.stage,p.elasticity,p.netMargin,p.guardrail])))}
    <div class="grid2">
      ${Sub("差异化定位画布 · 我方 vs 竞品区间带（RadarBench）", html`<${C2.RadarBench} axes=${_dims} max=${5} benchLow=${_lo} benchHigh=${_hi}
        series=${[{name:_me.name||"我方",scores:_me.scores}]}/>`)}
      ${Sub("广告策略 · 日预算 + 目标ACOS（双轴）", html`<${C2.ComboBarLine} labels=${_ac.map(a=>"W"+a.week)}
        bars=${_budget} line=${_ac.map(a=>a.acos)} barName="日预算$" lineName="目标ACOS" lineUnit="%" barColor=${C.PAL.teal} lineColor=${C.PAL.pink}/>
        <div class="note">${_ph.map(p=>`${p.phase}(${p.weekRange}) ACOS${p.targetAcos}%/$${p.dailyBudget}日`).join(" · ")}</div>`)}
    </div>
    ${Sub("Listing 蓝图（五点卖点由差评反推）", html`<div class="note"><b>标题：</b>${m.listing?.titleFormula}</div>
      ${Tbl(["卖点","反推差评","ABSA占比","证据"],(m.listing?.bullets||[]).map(b=>[b.point,b.sourceDefect,b.absaShare,html`<${Src} id=${b.evidence} open=${open}/>`]))}
      <div class="note"><b>A+：</b>${(m.listing?.aplus||[]).join(" / ")}</div>`)}
    ${Sub("关键词矩阵（四层）", Tbl(["关键词","层级","月搜","竞争","相关","建议出价"],
      (m.keywords||[]).map(k=>[k.keyword,html`<span class="ktier">${k.tier}</span>`,k.volume?.toLocaleString?.()||k.volume,k.competition,"★".repeat(k.relevance||0),"$"+k.suggestedBid])))}
    ${Sub("上市节奏甘特", html`<${C.Gantt} rows=${(m.gantt||[]).map(g=>({phase:g.phase,startWeek:g.startWeek,endWeek:g.endWeek,milestone:g.milestone}))}/>`)}
    <div class="grid2">
      ${Sub("评论增长模型（90天→300+）", html`<${C.Line} labels=${(m.reviewGrowth||[]).map(r=>"D"+r.day)}
        series=${[{name:"累计评论",points:(m.reviewGrowth||[]).map(r=>r.cumReviews)}]} area=${true} h=${150}/>`)}
      ${Sub("库存 / 补货计划", Tbl(["阶段","月销预测","安全库存","补货点","交期"],
        (m.inventory||[]).map(i=>[i.stage,i.forecastMonthlySales,i.safetyStock,i.reorderPoint,i.leadTimeDays+"天"])))}
    </div>
  `);
}

function risk(m){
  const hm=m.heatmap||{}, sc=m.score_weight_sensitivity||{};
  return Sec("RISK","RISK","风险登记册 + 敏感性 / 置信度","概率×影响 · 龙卷风 · 蒙特卡洛区间",html`
    ${Sub("风险登记册", Tbl(["#","类别","风险","P×I","等级","缓解","责任"],
      (m.risk_register||[]).map(r=>[r.id,r.category,r.risk.slice(0,42)+"…",`${r.probability}×${r.impact}=${r.exposure}`,
        html`<span class=${"rlv rlv-"+r.level}>${r.level}</span>`,r.mitigation.slice(0,40)+"…",r.owner])))}
    <div class="grid2">
      ${Sub("风险热力图（概率 × 影响）", html`<${C.Scatter} xLabel="概率 →" yLabel="影响 →" xMax=${5.5} yMax=${5.5}
        points=${(hm.points||[]).map(p=>({x:p.p,y:p.i,r:20,label:p.id,color:(p.p*p.i>=16?C.PAL.low:p.p*p.i>=9?C.PAL.med:C.PAL.high)}))}/>`)}
      ${Sub("单位净利敏感性（龙卷风）", html`<${C.Tornado} base=${m.sensitivity?.base_value}
        items=${(m.sensitivity?.drivers||[]).map(d=>({variable:d.variable,low:d.low_value,high:d.high_value,lowLabel:d.low_label,highLabel:d.high_label}))}/>`)}
    </div>
    ${Sub("机会分对权重的稳健性", html`<${C.BarsH} unit="" items=${(sc.scenarios||[]).map(s=>({label:s.name,value:s.score,color:C.PAL.accent}))} max=${100}/>
      <div class="note">基准 ${sc.base_score}；各权重情景下机会分区间稳健</div>`)}
    ${Sub("首年 GMV / 净利 蒙特卡洛区间（P10-P50-P90）", html`<${C.RangeBar} items=${(m.monte_carlo?.outputs||[]).map(o=>({metric:o.metric,unit:o.unit,p10:o.p10,p50:o.p50,p90:o.p90}))}/>`)}
    ${Sub("关键假设登记（置信度 + 证据）", Tbl(["假设","取值","置信度","备注"],
      (m.assumptions||[]).map(a=>[a.assumption,a.value,cf(a.confidence),a.note])))}
  `);
}

function trust(m){
  const cs=m.citation_stats||{};
  return Sec("TRUST","TRUST","可信度与护栏 · 方法论与数据来源","护栏 L0→L4 · 引用溯源 · 审计",html`
    ${Sub("护栏链 L0 → L4 执行结果", Tbl(["层","名称","检查/通过","阻断","状态"],
      (m.guardrail_chain||[]).map(g=>[g.level,g.name,`${g.passed}/${g.checks}`,g.blocked,html`<span class=${g.status==="pass"?"ok":"bad"}>${g.status}</span>`])))}
    <div class="grid2">
      ${Sub(`引用可溯源（准确率 ${Math.round((cs.citation_accuracy||0)*100)}%）`, html`<${C.DonutCat}
        items=${(m.citation_donut||[]).map(d=>({label:`${d.label} ${d.count}`,value:d.count,color:d.color}))}/>
        <div class="note">${cs.total_claims} 条结论 · ${cs.total_citations} 引用 · SUPPORTED ${cs.supported} · PARTIAL ${cs.partial}</div>`)}
      ${Sub("LLM-judge 五维质量分", html`<${C.BarsH} unit="/5" items=${(m.judge_scores||[]).map(j=>({label:j.dim,value:j.score,color:j.pass?C.PAL.high:C.PAL.low,sub:`阈值${j.threshold}`}))} max=${5}/>`)}
    </div>
    ${Sub("多模型交叉验证", Tbl(["结论","主模型","验证模型","裁决","偏差"],
      (m.cross_model||[]).map(c=>[c.claim,c.primary_value,c.verifier_value,html`<span class=${c.verdict==="agree"?"ok":"bad"}>${c.verdict}</span>`,Math.round((c.delta_pct||0)*1000)/10+"%"])))}
    ${Sub("轻人工终审记录", Tbl(["#","触发项","终审人","结论","改动"],
      (m.human_review||[]).map(h=>[h.id,h.trigger_item,h.reviewer,h.conclusion,h.change_made])))}
    ${Sub("数据来源清单", Tbl(["源","类型","覆盖","新鲜度","置信","合规"],
      (m.data_sources||[]).map(s=>[s.source,s.type,s.coverage,s.freshness,cf(s.confidence),s.compliance])))}
    ${Sub("方法论 & 局限", html`<div class="mcards">${(m.methodology||[]).map(x=>html`<div class="mcard"><b>${x.name}</b><div class="mform">${x.formula}</div><div class="note">${x.output}</div></div>`)}</div>
      <div class="limits">${(m.limitations||[]).map(l=>html`<div class="lim">⚠️ <b>${l.item}</b>：${l.scope} · 误差 ${l.error_band} · 缓解：${l.mitigation}</div>`)}</div>`)}
  `);
}

// ===== 交互：单位经济沙盘 =====
function FinanceSim({ m }){
  const be=m.break_even||{};
  const [price,setPrice]=useState(m.unit_price||36);
  const [cogs,setCogs]=useState(11.3);
  const [freight,setFreight]=useState(1.8);
  const [acos,setAcos]=useState(be.current_acos_pct||28);
  const [units,setUnits]=useState(1400);
  const referral=+(price*0.15).toFixed(2), fba=6.4;
  const ad=+(price*acos/100).toFixed(2);
  const gross=+(price-referral-fba-cogs-freight).toFixed(2);
  const net=+(gross-ad).toFixed(2);
  const grossPct=+(gross/price*100).toFixed(1), netPct=+(net/price*100).toFixed(1);
  const monthlyNet=Math.round(net*units);
  const fixed=be.fixed_investment_usd||149000;
  const beUnits=net>0?Math.round(fixed/net):null;
  const payback=(net>0&&monthlyNet>0)?+(fixed/monthlyNet).toFixed(1):null;
  const wf=[{step:"售价",type:"base",amount:price},{step:"Referral",type:"delta",amount:-referral},
    {step:"FBA",type:"delta",amount:-fba},{step:"货值",type:"delta",amount:-cogs},{step:"头程",type:"delta",amount:-freight},
    {step:"广告",type:"delta",amount:-ad},{step:"净利",type:"total",amount:net}];
  const tone=net>=3?"c-go":net>0?"c-cond":"c-no", tl=net>=3?"✅ 健康盈利":net>0?"🟡 微利":"🔴 亏损";
  const S=(label,val,set,min,max,step,fmt)=>html`<div class="simrow"><span class="siml">${label}</span>
    <input type="range" min=${min} max=${max} step=${step||1} value=${val} onInput=${e=>set(+e.target.value)}/>
    <span class="simv">${fmt?fmt(val):val}</span></div>`;
  return Sec("FINANCE","FINANCE","单位经济与财务模型 · 交互沙盘","拖动滑杆实时重算 P&L / 盈亏平衡 / 回本",html`
    ${Sub("① 交互单位经济沙盘（拖动即算）", html`<div class="simwrap">
      <div class="simctl">
        ${S("售价 $",price,setPrice,25,50,0.5,v=>"$"+v)}
        ${S("货值(到岸) $",cogs,setCogs,6,16,0.1,v=>"$"+v)}
        ${S("头程 $",freight,setFreight,0.5,4,0.1,v=>"$"+v)}
        ${S("ACOS %",acos,setAcos,10,45,1,v=>v+"%")}
        ${S("月销量",units,setUnits,400,3000,50)}
      </div>
      <div class="simout"><${C.Waterfall} items=${wf}/>
        <div class="simkpis">
          <div class=${"simk"+(net>0?"":" neg")}><b>$${net}</b><span>净利/单</span></div>
          <div class="simk"><b>${netPct}%</b><span>净利率</span></div>
          <div class=${"simk"+(monthlyNet>0?"":" neg")}><b>${C.fmt.usd(monthlyNet)}</b><span>月净利</span></div>
          <div class="simk"><b>${beUnits||"—"}</b><span>保本月销</span></div>
          <div class="simk"><b>${payback?payback+"月":"—"}</b><span>回本周期</span></div>
        </div>
        <div class="callout ${tone}"><b>${tl}</b> · 毛利 $${gross}(${grossPct}%) / 净利 $${net}(${netPct}%)。${netPct<8?"净利率偏低——上调售价至甜蜜区、压货值或降 ACOS。":"落在健康区间。"}</div>
      </div></div>`)}
    ${Sub("12个月预测 · 销量 + 月净利（双轴复合）", html`<${C2.ComboBarLine} labels=${(m.forecast_12m||[]).map(f=>f.month.slice(5))}
      bars=${(m.forecast_12m||[]).map(f=>f.units)} line=${(m.forecast_12m||[]).map(f=>f.monthly_net)}
      barName="月销(件)" lineName="月净利$" lineFmt=${v=>C.fmt.usd(v)}/>
      <div class="note">年销 ${m.forecast_totals?.annual_units} 件 · 年净利 ${C.fmt.usd(m.forecast_totals?.annual_net_profit)} · 峰值 ${m.forecast_totals?.peak_month}</div>`)}
    ${Sub("销量置信区间预测 · P10–P50–P90 扇形带", html`<${C2.FanChart} labels=${(m.forecast_12m||[]).map(f=>f.month.slice(5))}
      p50=${(m.forecast_12m||[]).map(f=>f.units)} p10=${(m.forecast_12m||[]).map(f=>Math.round(f.units*0.78))} p90=${(m.forecast_12m||[]).map(f=>Math.round(f.units*1.28))} name="月销"/>`)}
    ${Sub("现金流与备货占用（累计现金）", html`<${C.Line} labels=${(m.cashflow||[]).map(c=>c.month.replace(/\(.*\)/,""))}
      series=${[{name:"累计现金",points:(m.cashflow||[]).map(c=>c.cum_cash)}]} h=${150}/>
      <div class="note">最大回撤 ${C.fmt.usd(m.cashflow_summary?.max_cash_drawdown)} · 现金转正 ${m.cashflow_summary?.cash_positive_month}</div>`)}
    ${Sub("定价情景 · 净利率 vs 目标（子弹图）", html`<${C2.Bullet} unit="%"
      items=${(m.pricing_scenarios||[]).map(s=>({label:"$"+s.price,value:s.net_margin_pct,target:8,ranges:[0,8,15]}))}/>
      <div class="note">黑线=8% 目标净利率；$30 未达标，$34-38 达标。</div>`)}
    ${Sub("三档定价情景对比", Tbl(["定价","净利/单","净利率","预估月销","月净利","定位"],
      (m.pricing_scenarios||[]).map(s=>[html`<b>$${s.price}</b>`,`$${s.unit_net}`,s.net_margin_pct+"%",s.est_monthly_units,C.fmt.usd(s.monthly_net),s.positioning])))}
  `);
}

// ===== 交互：竞品钻取 =====
function CompModal({ c, open, onClose }){
  const gm=c.gross_margin||{};
  const wf=[{step:"售价",type:"base",amount:gm.price},{step:"Referral",type:"delta",amount:-gm.referral},
    {step:"FBA",type:"delta",amount:-gm.fba},{step:"货值",type:"delta",amount:-gm.cogs_landed},
    {step:"头程",type:"delta",amount:-gm.freight},{step:"广告",type:"delta",amount:-gm.ad},{step:"净利",type:"total",amount:gm.net}];
  return html`<div><div class="scrim" onClick=${onClose}></div><aside class="cmodal">
    <button class="dclose" onClick=${onClose}>×</button>
    <h2 style="margin:0 8px 0 0;display:inline">${c.title}</h2> ${cf(c.confidence)}
    <div class="dm">${c.asin} · ${c.price_band} · $${c.price} · 上架${Math.round((c.listing_age_days||0)/30)}月 · ${c.positioning}</div>
    <div class="grid2">
      ${Sub("销量趋势 · K线区间（90天）", html`<${C2.Candlestick}
        periods=${(c.trend_90d||[]).map((t,i,arr)=>{const o=i?arr[i-1].sold:t.sold,cl=t.sold;return {label:t.d,o,c:cl,h:Math.round(Math.max(o,cl)*1.03),l:Math.round(Math.min(o,cl)*0.97)};})}/>
        <div class="note">月销 ${c.monthly_sold} · CI[${(c.sold_ci||[]).join(",")}] · ${c.trend_label}</div>`)}
      ${Sub("评分分布", html`<${C.BarsH} unit="%" items=${[5,4,3,2,1].map(s=>({label:s+"★",value:c.rating_dist?.[s]||0,color:s>=4?C.PAL.high:s===3?C.PAL.med:C.PAL.low}))} max=${100}/>`)}
    </div>
    ${Sub("单位经济拆解", html`<${C.Waterfall} items=${wf}/><div class="note">净利 $${gm.net} (${gm.net_rate}%)</div>`)}
    ${Sub("软肋（ABSA）", (c.weakness_absa||[]).map(w=>html`<div class="tdw">${w.star?"⭐ ":""}${w.aspect} ${w.pct}% (${w.mentions}) <${Src} id=${w.evidence} open=${open}/></div>`))}
    ${Sub("USP / BuyBox / 变体", html`<div class="note">USP：${(c.usp||[]).join(" · ")}</div>
      <div class="note">BuyBox：${c.buybox?.seller}（${c.buybox?.seller_type}）${c.buybox?.ownership_pct}% · 价格${c.buybox?.price_stability}</div>
      <div class="note">变体：${c.variants?.count} 个 · ${c.variants?.note}</div>`)}
    ${Sub("可攻击点", html`<ul class="tdatk">${(c.attack_points||[]).map(a=>html`<li>${a}</li>`)}</ul>`)}
  </aside></div>`;
}
function TeardownModule({ m, open }){
  const [sel,setSel]=useState(null); const mx=m.matrix||{};
  return Sec("TEARDOWN","TEARDOWN","竞品深度拆解","点击卡片钻取完整解剖 · 对比矩阵 · 攻击面",html`
    <div class="tdgrid">${(m.competitors||[]).map(c=>html`<div class="tdcard" style="cursor:pointer" onClick=${()=>setSel(c)}>
      <div class="tdh"><div><b>${c.title}</b><div class="tdsub">${c.asin} · ${c.price_band} · $${c.price}</div></div>${cf(c.confidence)}</div>
      <div class="tdrow"><span>月销 <b>${c.monthly_sold}</b></span><${C.Spark} points=${(c.trend_90d||[]).map(t=>t.sold)}/></div>
      <div class="tdrow"><span>★${c.rating} · ${c.review_count}评</span><span class="muted">毛利 <b class=${c.gross_margin?.net<0?"bad":"ok"}>$${c.gross_margin?.net}</b></span></div>
      <div class="tdlab">软肋</div>${(c.weakness_absa||[]).slice(0,2).map(w=>html`<div class="tdw">${w.star?"⭐ ":""}${w.aspect} ${w.pct}%</div>`)}
      <div class="tddrill">点击查看完整拆解 →</div></div>`)}</div>
    ${Sub("竞品 × 维度打分热力", html`<${C.Heatmap} xLabels=${(mx.rows||[]).map(r=>r.entity)} yLabels=${(mx.dimensions||[]).map(d=>d.label)}
      matrix=${(mx.dimensions||[]).map(d=>(mx.rows||[]).map(r=>r.scores?.[d.key]??0))} min=${40} max=${96} fmtCell=${v=>v}/>`)}
    ${Sub("攻击面分析（软肋 → 我方对策）", Tbl(["竞品","软肋","难度","我方对策","预期收益"],
      (m.attack_surface||[]).map(a=>[a.competitor,html`<div>${a.weak_point} <${Src} id=${a.evidence} open=${open}/></div>`,a.attack_difficulty,a.our_counter,a.expected_gain])))}
    ${sel && html`<${CompModal} c=${sel} open=${open} onClose=${()=>setSel(null)}/>`}
  `);
}

// ===== 通用自动分发渲染器（按数据结构匹配图表）—— 用于 12 个扩展模块 =====
function fmtCell(x){
  if(x==null) return "";
  if(typeof x==="object") return Array.isArray(x)?x.join("/"):JSON.stringify(x);
  if(typeof x==="string"&&(/^(https?:\/\/|\/data\/)/i.test(x))) return html`<a class="board-source-link" href=${x} target="_blank" rel="noreferrer">打开来源 ↗</a>`;
  return x;
}
const _VIZK=new Set(["table","combo","chart","line","bars","scatter","radar","heatmap","sankey","funnel","waterfall","boxplot","marimekko","candlestick","slope","rangebar","fan","fanchart","bullet","kpi","donut","tornado","stacked","gantt","matrix","data"]);
function tableCR(v){ const cols=v.columns||[]; return html`<div style="overflow:auto"><table><thead><tr>${cols.map(c=>html`<th>${GL(c)}</th>`)}</tr></thead>
  <tbody>${(v.rows||[]).map(r=>html`<tr>${cols.map((c,ci)=>html`<td>${fmtCell(Array.isArray(r)?r[ci]:r[c])}</td>`)}</tr>`)}</tbody></table></div>`; }
function objTable(arr){ const cols=Object.keys(arr[0]); return html`<div style="overflow:auto"><table><thead><tr>${cols.map(c=>html`<th>${GL(c)}</th>`)}</tr></thead>
  <tbody>${arr.map(r=>html`<tr>${cols.map(c=>html`<td>${fmtCell(r[c])}</td>`)}</tr>`)}</tbody></table></div>`; }
function kpiTiles(arr){ return html`<div class="stat-strip">${arr.map(k=>html`<div class="stat"><div class="k">${GL(k.label)}</div>
  <div class="v">${k.value}<span style="font-size:12px;color:var(--faint)"> ${k.unit||""}</span></div><div class="s">${k.note||k.sub||""}</div></div>`)}</div>`; }
function nn(a){ return Math.max(...a.map(Number).filter(x=>!isNaN(x))); }
function renderAny(v, open, key=""){
  const K=(key||"").toLowerCase();
  if(v==null) return "";
  if(typeof v==="number") return html`<div style="display:flex;justify-content:center"><${C.Gauge} value=${v} label=""/></div>`;
  if(typeof v==="string") return html`<div class="note">${v}</div>`;
  if(Array.isArray(v)){
    if(!v.length) return ""; const s=v[0];
    if(typeof s!=="object") return html`<div class="note">${v.join(" · ")}</div>`;
    if(K.includes("kpi")) return kpiTiles(v);
    if("p10" in s && "metric" in s) return html`<${C.RangeBar} items=${v}/>`;
    if("o" in s&&"h" in s&&"l" in s&&"c" in s) return html`<${C2.Candlestick} periods=${v}/>`;
    if(("startWeek" in s)||("phase" in s&&"endWeek" in s)) return html`<${C.Gantt} rows=${v}/>`;
    if("x" in s&&"y" in s) return html`<${C.Scatter} points=${v} xMax=${nn(v.map(p=>p.x))*1.15} yMax=${nn(v.map(p=>p.y))*1.15} quadrant=${true}/>`;
    if("neg" in s&&"pos" in s) return html`<${C2.StackedDiverging} items=${v}/>`;
    if("target" in s&&"value" in s) return html`<${C2.Bullet} items=${v}/>`;
    if(("type" in s||"step" in s)&&"amount" in s) return html`<${C.Waterfall} items=${v}/>`;
    if(("note" in s)||("unit" in s)||("label" in s&&typeof s.value==="string")) return kpiTiles(v);
    if("label" in s&&"value" in s) return html`<${C.BarsH} items=${v.map(x=>({label:x.label,value:x.value,sub:x.note||x.sub}))}/>`;
    return objTable(v);
  }
  // object
  // —— 灵眸逆向新图型（置于通用对象分支之前，避免被表格/递归误捕获）——
  if(Array.isArray(v.rows)&&v.rows[0]&&"cells" in v.rows[0]) return html`<${C3.GradeMatrix} columns=${v.columns} rows=${v.rows} legend=${v.legend} note=${v.note}/>`;
  if("cellGrades" in v&&"matrix" in v) return html`<${C3.GradeMap} xLabels=${v.xLabels} yLabels=${v.yLabels} matrix=${v.matrix} cellGrades=${v.cellGrades} gateFail=${v.gateFail} legend=${v.legend} note=${v.note}/>`;
  if(Array.isArray(v.words)&&v.words[0]&&"text" in v.words[0]) return html`<${C3.WordCloud} words=${v.words} note=${v.note}/>`;
  if(("推荐产品概念" in v)&&("竞品参考" in v)) return html`<${C3.ConceptCard} concept=${v["推荐产品概念"]} comps=${v["竞品参考"]} note=${v.note}/>`;
  if(Array.isArray(v.nodes)&&Array.isArray(v.links)&&v.nodes[0]&&"grade" in v.nodes[0]) return html`<${C3.StrategyMap} nodes=${v.nodes} links=${v.links} basis=${v.basis} note=${v.note}/>`;
  if(Array.isArray(v.points)&&("xSplit" in v)) return html`<${C3.QuadrantScatter} points=${v.points} xSplit=${v.xSplit} ySplit=${v.ySplit} xLabel=${v.xLabel} yLabel=${v.yLabel} quadrant_labels=${v.quadrant_labels} alert=${v.alert} note=${v.note}/>`;
  if(K.includes("sankey")||K.includes("flywheel")||K.includes("flow")){ if(v.nodes&&v.links) return html`<${C2.Sankey} nodes=${v.nodes} links=${v.links}/>`; }
  if("items" in v && Array.isArray(v.items) && v.items[0]){ const it=v.items[0];
    if("target" in it) return html`<${C2.Bullet} items=${v.items} unit=${v.unit||""}/>`;
    if("p10" in it) return html`<${C.RangeBar} items=${v.items}/>`;
    if(("type" in it||"step" in it)&&"amount" in it) return html`<${C.Waterfall} items=${v.items}/>`;
    if("label" in it&&"value" in it) return html`<${C.BarsH} items=${v.items} unit=${v.unit||""}/>`; }
  if("columns" in v && "rows" in v){
    if("bar_col" in v) return html`<${C3.TableWithBar} v=${v}/>`;
    return html`${tableCR(v)}${v.note?html`<div class="note">${v.note}</div>`:""}`;
  }
  if("axes" in v && "series" in v){
    if("benchLow" in v) return html`<${C2.RadarBench} axes=${v.axes} benchLow=${v.benchLow} benchHigh=${v.benchHigh} series=${v.series} max=${v.max||100}/>`;
    const mx=v.max||(nn(v.series.flatMap(s=>s.scores))>1?100:1); return html`<${C.Radar} axes=${v.axes} series=${v.series} max=${mx} size=${290}/>`; }
  if("labels" in v){
    if("p10" in v&&"p50" in v&&"p90" in v) return html`<${C2.FanChart} labels=${v.labels} p10=${v.p10} p50=${v.p50} p90=${v.p90} name=${v.name||""}/>`;
    if("bars" in v&&"line" in v) return html`<${C2.ComboBarLine} labels=${v.labels} bars=${v.bars} line=${v.line} barName=${v.barName||""} lineName=${v.lineName||""} lineUnit=${v.lineUnit||""}/>`;
    if("series" in v) return html`<${C.Line} labels=${v.labels} series=${v.series} threshold=${v.threshold?{value:v.threshold,label:"锚点"}:undefined}/>`; }
  if("xLabels" in v&&"yLabels" in v&&"matrix" in v) return html`<${C.Heatmap} xLabels=${v.xLabels} yLabels=${v.yLabels} matrix=${v.matrix} min=${v.min||0} max=${v.max||nn(v.matrix.flat())}/>`;
  if("groups" in v) return html`<${C2.BoxPlot} groups=${v.groups}/>`;
  if("cols" in v && Array.isArray(v.cols) && v.cols[0]&&"segments" in v.cols[0]) return html`<${C2.Marimekko} cols=${v.cols}/>`;
  if("nodes" in v&&"links" in v) return html`<${C2.Sankey} nodes=${v.nodes} links=${v.links}/>`;
  if("stages" in v) return html`<${C.Funnel} stages=${v.stages}/>`;
  if("rows" in v && Array.isArray(v.rows) && v.rows[0]&&("startWeek" in v.rows[0]||"phase" in v.rows[0])) return html`<${C.Gantt} rows=${v.rows}/>`;
  if("periods" in v) return html`<${C2.Candlestick} periods=${v.periods}/>`;
  if("dims" in v&&"seriesA" in v) return html`<${C2.Slope} dims=${v.dims} seriesA=${v.seriesA} seriesB=${v.seriesB} max=${v.max||5}/>`;
  if("points" in v) return html`<${C2.ScatterReg} points=${v.points} xMax=${v.xMax} yMax=${v.yMax} curve=${v.curve||""}/>`;
  if(("title" in v||"tag" in v)&&"body" in v) return html`<div class="callout"><b>${v.title||""}</b> ${v.tag?html`<span class="rlv rlv-Medium">${v.tag}</span>`:""}<div style="margin-top:6px">${v.body}</div></div>`;
  // 嵌套结构：对象里含多个可渲染子块(如 {table:{...}, combo:{...}, note})→ 逐个递归渲染
  const oe=Object.entries(v);
  if(oe.some(([,val])=>val&&typeof val==="object")){
    return html`${oe.map(([k,val])=>{
      if(val&&typeof val==="object")
        return _VIZK.has(String(k).toLowerCase())
          ? html`<div style="margin-top:10px">${renderAny(val,open,k)}</div>`
          : html`<div class="nsub"><div class="nsubt">${String(k).replace(/_/g," ")}</div>${renderAny(val,open,k)}</div>`;
      if(["note","body","desc","summary","insight"].includes(k)) return html`<div class="note">${val}</div>`;
      return html`<div class="callout" style="margin-top:8px"><b>${String(k).replace(/_/g," ")}</b>：${fmtCell(val)}</div>`;
    })}`;
  }
  // 纯标量对象 → 键值小表
  return html`<table><tbody>${oe.map(([k,val])=>html`<tr><td><b>${GL(k)}</b></td><td>${fmtCell(val)}</td></tr>`)}</tbody></table>`;
}
function subTitleFor(key, meta){ const s=(meta.subsections||[]).find(x=>x.id===key||(x.id&&key.includes(x.id))||(x.id&&x.id.includes(key))); return s?s.title:key.replace(/_/g," "); }
function genericModule(id, sd, meta, open){
  const entries=Object.entries(sd||{}).filter(([k,v])=>v!=null&&!(Array.isArray(v)&&!v.length)&&k!=="noop");
  const tag=(meta.nav_short||id).replace(/[^A-Za-z]/g,"").toUpperCase().slice(0,10)||"MODULE";
  return Sec(id, tag, meta.title||id, "", html`${entries.map(([k,v])=>Sub(subTitleFor(k,meta), renderAny(v,open,k)))}`);
}

function linkedCell(value){
  const text=String(value??"");
  if(/^https?:\/\//i.test(text)) return html`<a class="board-source-link" href=${text} target="_blank" rel="noreferrer">打开来源 ↗</a>`;
  return fmtCell(value);
}
function linkedTable(m){
  const cols=m?.columns||[], rows=m?.rows||[];
  return html`<div class="board-table-wrap"><table class="board-table"><thead><tr>${cols.map(c=>html`<th>${c}</th>`)}</tr></thead>
    <tbody>${rows.map(r=>html`<tr>${r.map(c=>html`<td>${linkedCell(c)}</td>`)}</tr>`)}</tbody></table></div>`;
}
function boardDecision(m){
  const tone=m.verdict_code==="go"?"go":m.verdict_code==="no_go"?"no":"cond";
  return Sec("board_decision","BOARD","董事会结论｜投不投、投什么、卡什么闸门","结论、产品选择、财务与执行闸门集中在一页",html`
    <div class=${"board-verdict "+tone}>
      <div><span>FINAL RECOMMENDATION</span><b>${m.verdict}</b><p>${m.one_liner}</p></div>
      <div class="board-score"><strong>${m.score}</strong><small>/100 · ${m.grade}</small></div>
    </div>
    <div class="board-logic">${(m.core_logic||[]).map((item,i)=>html`<article>
      <span>${String(i+1).padStart(2,"0")}</span><div><b>${item[0]}</b><p>${item[1]}</p><small>${item[2]}</small></div>
    </article>`)}</div>
    ${Sub("董事会要拍板的四件事", linkedTable(m.decision_table))}
    ${Sub("不满足即停止的放行线", html`<div class="board-gates">${(m.gating_conditions||[]).map(g=>html`<span>✓ ${g}</span>`)}</div>`)}
  `);
}
function boardConcept(m){
  return Sec("board_concept","CONCEPT","产品概念图｜可制造方向","概念图是产品定义输入，不替代工程图、测试报告与量产签样",html`
    <div class="board-concept">
      <button class="board-concept-image" onClick=${()=>{
        const opened=window.open(m.image_url,"_blank","noopener,noreferrer");
        if(opened)opened.opener=null;
      }}>
        <img src=${m.image_url} alt=${m.title||"产品概念图"} loading="eager"/>
        <span>点击查看原图 ↗</span>
      </button>
      <div class="board-concept-copy">
        <span class="concept-kicker">MANUFACTURABLE DESIGN DIRECTION</span>
        <h3>${m.title}</h3><p>${m.thesis}</p>
        <div class="board-specs">${(m.specs||[]).map(s=>html`<div><small>${s[0]}</small><b>${s[1]}</b></div>`)}</div>
        <div class="board-tags">${(m.manufacturability||[]).map(t=>html`<span>${t}</span>`)}</div>
      </div>
    </div>
  `);
}
function boardRaw(id,tag,title,m,q="每一行都保留抓取时点和可回溯链接"){
  return Sec(id,tag,title,q,html`${linkedTable(m)}<div class="note">价格、评分与评论数是抓取日快照；促销、变体合并和库存会导致后续变化。</div>`);
}
function boardVoc(m){
  return Sec("voc_raw_data","VOC","VOC 证据引擎｜覆盖基数、逐条信号与产品动作","公开评论转述；保留来源页、覆盖基数、观察日和编码口径；编码观察不外推为市场发生率",html`
    <div class="voc-method">${m.methodology_note}</div>
    ${Sub("本次 VOC 覆盖",linkedTable(m.coverage_summary))}
    ${Sub("来源覆盖明细",linkedTable(m.source_coverage))}
    ${Sub("主题分布（仅代表本次编码记录）",linkedTable(m.theme_distribution))}
    ${Sub("逐条证据日志",linkedTable(m.evidence_log))}
    ${Sub("综合结论",html`<div class="voc-synthesis">${(m.synthesis||[]).map((item,index)=>html`
      <article><span>${String(index+1).padStart(2,"0")}</span><p>${item}</p></article>`)}</div>`)}
  `);
}

const RENDER = { exec_summary_decision_scorecard:execSummary,
  decision_funnel:(m)=>html`<${FunnelSandbox} m=${m}/>`,
  OP_SCAN:opScan, MKT_STRUCT:mktStruct, MIND_DECODE:mindDecode,
  competitor_teardown:(m,open)=>html`<${TeardownModule} m=${m} open=${open}/>`,
  CPT_VERIFY:cptVerify,
  output_unit_economics_finance:(m)=>html`<${FinanceSim} m=${m}/>`,
  gtm_plan:gtm, risk_register_sensitivity_confidence:risk,
  trust_guardrails_methodology:trust,
  board_decision:boardDecision,
  board_concept:boardConcept,
  competitive_raw_data:(m)=>boardRaw("competitive_raw_data","RAW","原始竞品样本｜价格、评分、尺寸与链接",m),
  voc_raw_data:boardVoc,
  source_register:(m)=>boardRaw("source_register","SOURCES","来源台账｜证据等级、日期与链接",m,"政府/监管与零售商一方页面优先；第三方估算全部降级标注") };

// ============ 报告目录 分组（可折叠手风琴）============
const NAV_GROUPS = [
  { key:"board", label:"结论与概念", ids:["board_decision","board_concept"], pre:[] },
  { key:"aigc", label:"AIGC 增强", ids:["ai_consensus","aigc_grounded_synthesis","aigc_concept_portfolio","aigc_design_system","aigc_design_review_pack","aigc_listing_blueprint","aigc_redteam_validation","aigc_quality_audit"], pre:["aigc_"] },
  { key:"overview", label:"决策概览", ids:["framework_provenance","research_brief","exec_summary_decision_scorecard","decision_funnel","strategy_map"], pre:["meta_"] },
  { key:"opp", label:"机会与市场结构", pre:["compdeep"], ids:["framework_opportunity_scan","framework_market_structure","market_signal","competitive_raw_data","OP_SCAN","MKT_STRUCT","competitor_teardown","competitive_dynamics","trend_forecast","scenario_valuation","segment_grade_matrix","market_map_segment_grade","grade_map","market_size_decomposition","price_elasticity","longtail_niche"] },
  { key:"mind", label:"消费者心智 VOC", pre:["pd_"], ids:["framework_voc_decode","voc_raw_data","MIND_DECODE","voc_evidence","voc_absa_walls","mind_whitespace_needs","social_demand_triggers","persona_journey","ab_listing_simulator","synthetic_concept_test","returns_quality"] },
  { key:"verify", label:"验证与财务", pre:["fin_"], ids:["framework_product_verify","product_definition","financial_model","CPT_VERIFY","output_unit_economics_finance","problem_solver_concept","pricing_science"] },
  { key:"gtm", label:"上市与增长", ids:["framework_gtm_plan","action_plan","gtm_plan","ppc_traffic_deep_dive","omnichannel_strategy","keyword_strategy_matrix","ad_structure_bidding","offsite_influencer_social"] },
  { key:"ops", label:"卖家与供应链", ids:["logistics_advantage","compliance_risk","crossborder_seller_cockpit","supply_chain_sourcing","ip_compliance","supply_chain_risk_topology","multi_supplier_strategy","certification_and_first_leg"] },
  { key:"risk", label:"风险与信任", pre:["risk_"], ids:["risk_register_sensitivity_confidence","trust_guardrails_methodology"] },
  { key:"evidence", label:"来源与方法", ids:["evidence_downloads","source_register","methodology"], pre:[] },
  { key:"deep", label:"其他深度分析", ids:[], pre:[] },
];
const BOARD_PACK_IDS = new Set([
  "board_decision","board_concept","aigc_grounded_synthesis","aigc_design_review_pack","aigc_quality_audit",
  "exec_summary_decision_scorecard","decision_funnel","framework_product_verify","financial_model","strategy_map",
  "ev_decision","capital_allocation_ruin","pre_mortem_redteam","risk_register_sensitivity_confidence","trust_guardrails_methodology",
]);
function groupOf(id){
  const L=String(id).toLowerCase();
  for(const g of NAV_GROUPS){
    if(g.ids&&g.ids.includes(id)) return g.key;
    if(g.pre&&g.pre.some(p=>L.startsWith(p))) return g.key;
  }
  return "deep";
}
function groupModules(order){
  const map={}; order.forEach((id,i)=>{ const k=groupOf(id); (map[k]=map[k]||[]).push({id,idx:i}); });
  return NAV_GROUPS.filter(g=>map[g.key]&&map[g.key].length).map(g=>({key:g.key,label:g.label,items:map[g.key]}));
}

// ============ 产品概念设计 ============
const CONCEPT_STATUS = {
  not_started: ["尚未生成", "由管理员确认费用风险后再启动 Lovart"],
  blocked: ["证据暂未放行", "研究可以继续审阅，概念生成保持关闭"],
  unavailable: ["能力待开通", "当前不会调用 Lovart 或扣除生成积分"],
  queued: ["排队中", "正在整理研究结论与设计约束"],
  generating: ["设计中", "Lovart 正在进行工业设计推演与高质量出图"],
  archiving: ["存档中", "正在校验并永久存档概念图素材"],
  awaiting_confirmation: ["等待确认", "高质量模型需要确认点数消耗后继续"],
  submission_unknown: ["提交待核验", "Lovart 可能已接收任务；核验远端项目前不会重复提交"],
  confirmation_unknown: ["确认核验中", "系统正在只读核验确认结果，不会重复扣费确认"],
  done: ["已完成", "概念图已生成并存档"],
  failed: ["生成失败", "可以查看原因后重新生成"],
};
const CONCEPT_SCENE_LABELS = {
  hero_master:"主视觉",
  primary_lifestyle:"主场景",
  secondary_lifestyle:"副场景",
  functional_open_state:"功能",
  detail_cmf:"材质细节",
  packaging_logistics:"履约",
  legacy_alternate:"备选图",
};
function sceneRoleLabel(role){
  const key=String(role||"").trim();
  return CONCEPT_SCENE_LABELS[key]||key.replaceAll("_"," ")||"概念图";
}
function conceptImageUrl(value){
  const candidate=typeof value==="string"?value.trim():"";
  return /^(?:https?:\/\/|\/|data:image\/|blob:)/i.test(candidate)?candidate:"";
}
function conceptAssetImage(asset){
  if(typeof asset==="string")return conceptImageUrl(asset);
  if(!asset||typeof asset!=="object")return "";
  return conceptImageUrl(asset.image_url)||conceptImageUrl(asset.url)||conceptImageUrl(asset.image)||conceptImageUrl(asset.content);
}
function reportConceptImageAssets(report){
  const board=report?.modules?.board_concept||{};
  const product=report?.modules?.pd_concept_matrix?.product_concept||{};
  const reviewPack=report?.modules?.pd_concept_matrix?.aigc_design_review_pack||{};
  const suiteSources=[board.scene_suite,product.scene_suite,reviewPack.scene_suite,reviewPack.scene_suite?.assets];
  const candidates=[board,product,...suiteSources.flatMap(suite=>Array.isArray(suite)?suite:[])];
  const seen=new Set();
  return candidates.flatMap((asset)=>{
    const url=conceptAssetImage(asset);
    if(!url||seen.has(url))return [];
    seen.add(url);
    return [{...(asset&&typeof asset==="object"?asset:{}),url,baseline:true}];
  });
}
export function reportHasConceptImageAsset(report){
  return reportConceptImageAssets(report).length>0;
}
function ConceptImageMedia({ asset, alt, loading="lazy", state, onLoad, onError, compact=false }){
  const loaded=state==="loaded";
  const failed=state==="failed";
  const placeholderStyle=`position:absolute;inset:0;display:flex;box-sizing:border-box;flex-direction:column;align-items:center;justify-content:center;gap:${compact?"2px":"6px"};margin:0;padding:${compact?"4px":"14px"};border:0;border-radius:0;background:${failed?"#302827":"#242423"};color:${failed?"#d2aaa5":"#bdbdb6"};text-align:center;backdrop-filter:none;pointer-events:none;`;
  return [html`<img key=${asset?.url||"missing-image"} src=${asset?.url||""} alt=${loaded?alt:""} aria-hidden=${String(!loaded)} loading=${loading}
      style=${loaded?"":failed?"display:none":"opacity:0"}
      onLoad=${event=>onLoad?.(asset?.url,event)} onError=${event=>onError?.(asset?.url,event)}/>`,
    !loaded?html`<span key=${`${asset?.url||"missing-image"}-placeholder`} class=${"concept-image-placeholder "+(failed?"failed":"loading")} role=${failed?"status":undefined} style=${placeholderStyle}>
      <strong style=${`font-size:${compact?"8px":"12px"};font-weight:650`}>${failed?"图片加载失败":"图片加载中"}</strong>
      ${!compact?html`<small style="max-width:28em;color:inherit;font-size:10px;line-height:1.5">${failed?"该资产暂时不可显示，其他已成功加载的图片仍可正常查看。":"正在验证真实图片内容…"}</small>`:""}
    </span>`:null];
}
function ConceptPanel({ run, report, api, onRunUpdated, canManageConcept, onAssetVisibilityChange, visibilityScope, reportFirst=false }){
  const [concept,setConcept]=useState(null);
  const [error,setError]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState("");
  const [pollKey,setPollKey]=useState(0);
  const [activeImage,setActiveImage]=useState("");
  const [selectedArtifactIndex,setSelectedArtifactIndex]=useState(null);
  const [notice,setNotice]=useState("");
  const [imageLoadRegistry,setImageLoadRegistry]=useState({scope:"",states:{}});
  useEffect(()=>{
    let stopped=false, timer=null;
    const tick=async()=>{
      try{
        const value=await api(`/runs/${run.id}/concept`);
        if(stopped)return;
        setConcept(value); setError(""); setLoaded(true);
        if(["queued","generating","archiving","confirmation_unknown"].includes(value?.status)){
          const retrySeconds=Number(value?.retry_after_seconds);
          const retryDelay=Number.isFinite(retrySeconds)&&retrySeconds>0
            ? Math.min(60000,Math.max(1000,Math.ceil(retrySeconds*1000)))
            : 10000;
          timer=setTimeout(tick,retryDelay);
        }
      }catch(e){
        if(stopped)return;
        setError(e.message||"概念图状态加载失败"); setLoaded(true);
        timer=setTimeout(tick,10000);
      }
    };
    tick();
    return()=>{ stopped=true; if(timer)clearTimeout(timer); };
  },[api,run.id,pollKey]);
  const retryConceptStatus=()=>{
    setError("");
    setLoaded(false);
    setPollKey(value=>value+1);
  };
  const act=async(kind)=>{
    const confirmation={
      start:"生成概念图可能消耗 Lovart credits。确认由管理员开始本次生成？",
      confirm:"继续生成概念图可能消耗 Lovart credits。确认由管理员继续？",
      regenerate:"重新生成概念图可能消耗 Lovart credits。确认由管理员重新生成？",
    }[kind];
    if(confirmation&&!window.confirm(confirmation))return;
    setBusy(kind); setError(""); setNotice("");
    try{
      const endpoint=kind==="start"?"start":kind==="confirm"?"confirm":"regenerate";
      const body=kind==="confirm"
        ? {
            confirm_generation:true,
            concept_id:concept?.id,
            expected_concept_updated_at:concept?.updated_at,
            expected_estimated_cost:cost??null,
            confirm_unknown_cost:cost==null,
          }
        : {confirm_generation:true};
      const value=await api(`/runs/${run.id}/concept/${endpoint}`,{method:"POST",body});
      setConcept(value); setError(""); setPollKey(v=>v+1);
    }catch(e){ setError(e.message||"操作失败"); }
    finally{ setBusy(""); }
  };
  const baseline=report?.modules?.board_concept||report?.modules?.pd_concept_matrix?.product_concept||{};
  const baselineAssets=reportConceptImageAssets(report);
  const hasBaseline=baselineAssets.length>0;
  const statusKey=!loaded?"loading":error&&!concept?"load_failed":concept?.status||"not_started";
  const status=concept?.status==="not_started"&&hasBaseline
    ? ["报告基线已就绪","可由管理员继续生成新一轮 Lovart 设计"]
    : CONCEPT_STATUS[concept?.status]||(!loaded?["加载中","正在读取概念图任务状态"]:error&&!concept?["加载失败","暂时无法读取 Lovart 任务状态"]:["尚未生成","等待管理员启动概念设计"]);
  const brief=concept?.design_brief||{};
  const selected=brief.selected_concept||{
    name:baseline?.title,
    target_price:(baseline?.specs||[]).find(item=>/价格|售价|price/i.test(String(item?.[0]||"")))?.[1],
  };
  const problems=brief.customer_problems||[];
  const remoteAssets=concept?.assets||[];
  const assets=remoteAssets.length?remoteAssets:baselineAssets;
  const sceneSuite=brief.scene_suite||{};
  const sceneSlots=Array.isArray(sceneSuite.slots)?sceneSuite.slots:[];
  const presentedAssets=assets.flatMap((asset,sourceIndex)=>{
    const url=conceptAssetImage(asset);
    if(!url)return [];
    const explicitSequence=Number(asset?.sequence);
    const slot=sceneSlots.find(item=>asset?.role&&item?.role===asset.role)
      ||sceneSlots.find(item=>Number.isFinite(explicitSequence)&&Number(item?.sequence)===explicitSequence)
      ||sceneSlots[sourceIndex]
      ||{};
    const candidateSequence=Number(asset?.sequence??slot?.sequence??sourceIndex+1);
    return [{
      ...asset,
      url,
      artifactIndex:asset?.index??sourceIndex,
      role:asset?.role||slot?.role||(sourceIndex===0?"hero_master":"legacy_alternate"),
      title:asset?.title||slot?.title||`产品概念图 ${sourceIndex+1}`,
      purpose:asset?.purpose||slot?.purpose||"",
      sequence:Number.isFinite(candidateSequence)?candidateSequence:sourceIndex+1,
      required:asset?.required??slot?.required??sourceIndex===0,
    }];
  }).sort((a,b)=>a.sequence-b.sequence);
  const imageLoadScope=[String(run?.id||"report"),String(report?.report_version||report?.schema_version||"unknown"),presentedAssets.map(asset=>asset.url).join("|")].join("::");
  const imageLoadStates=imageLoadRegistry.scope===imageLoadScope?imageLoadRegistry.states:{};
  const imageStateOf=(asset)=>imageLoadStates[asset?.url]||"loading";
  const markImageState=(url,nextState,event)=>{
    const image=event?.currentTarget;
    if(!url||!image?.isConnected||image.getAttribute("src")!==url)return;
    if(nextState==="loaded"&&(!event?.currentTarget?.naturalWidth||!event?.currentTarget?.naturalHeight))nextState="failed";
    setImageLoadRegistry(current=>{
      const states=current.scope===imageLoadScope?current.states:{};
      if(states[url]===nextState)return current.scope===imageLoadScope?current:{scope:imageLoadScope,states};
      return {scope:imageLoadScope,states:{...states,[url]:nextState}};
    });
  };
  const markImageLoaded=(url,event)=>markImageState(url,"loaded",event);
  const markImageFailed=(url,event)=>{
    markImageState(url,"failed",event);
    if(activeImage===url)setActiveImage("");
  };
  const loadedAssets=presentedAssets.filter(asset=>imageStateOf(asset)==="loaded");
  const hasVisibleConceptImage=loadedAssets.length>0;
  useEffect(()=>{
    setImageLoadRegistry(current=>current.scope===imageLoadScope?current:{scope:imageLoadScope,states:{}});
    setSelectedArtifactIndex(null);
    setActiveImage("");
    onAssetVisibilityChange?.(false,visibilityScope);
  },[imageLoadScope,onAssetVisibilityChange,visibilityScope]);
  useEffect(()=>{ onAssetVisibilityChange?.(hasVisibleConceptImage,visibilityScope); },[hasVisibleConceptImage,imageLoadScope,onAssetVisibilityChange,visibilityScope]);
  const hasSceneSuite=sceneSlots.length>1||presentedAssets.some((asset,index)=>index>0&&asset.role!=="legacy_alternate");
  const expectedSuiteCount=Math.max(1,Number(sceneSuite.expected_asset_count)||Number(sceneSuite.max_asset_count)||sceneSlots.length||presentedAssets.length);
  const availableSuiteCount=Math.min(expectedSuiteCount,loadedAssets.length);
  const archivedSuiteAssets=loadedAssets.filter(asset=>asset.stored&&asset.sha256);
  const suiteArtifactIndices=archivedSuiteAssets.map(asset=>Number(asset.artifactIndex)).filter(Number.isInteger);
  const heroAsset=loadedAssets.find(asset=>asset.role==="hero_master")||loadedAssets[0]||presentedAssets.find(asset=>asset.role==="hero_master")||presentedAssets[0];
  const selectedAsset=presentedAssets.find(asset=>String(asset.artifactIndex)===String(selectedArtifactIndex))||heroAsset;
  const heroArtifactIndex=Number(heroAsset?.artifactIndex);
  useEffect(()=>{
    if(!activeImage)return;
    const close=(event)=>{ if(event.key==="Escape"){ event.preventDefault(); setActiveImage(""); } };
    window.addEventListener("keydown",close);
    return()=>window.removeEventListener("keydown",close);
  },[activeImage]);
  const suiteProgress=Math.min(100,Math.round((availableSuiteCount/expectedSuiteCount)*100));
  const suiteReady=hasSceneSuite&&availableSuiteCount>=expectedSuiteCount&&suiteArtifactIndices.length>=expectedSuiteCount&&Number.isInteger(heroArtifactIndex);
  const baselineFirstView=hasBaseline&&remoteAssets.length===0&&!suiteReady;
  const cost=concept?.estimated_cost;
  const adopted=report?.modules?.board_concept?.asset_provenance||{};
  const conceptDomId=String(run?.id||"report").replace(/[^a-z0-9_-]/gi,"-");
  const generationAvailable=concept?.generation_available!==false&&!['blocked','unavailable'].includes(concept?.status);
  const generationBlockReason=concept?.blocked_reason||concept?.generation_block_reason||"";
  const statusNeedsManualRetry=statusKey==="load_failed"||concept?.status==="submission_unknown";
  const hasFirstPrimaryAction=statusNeedsManualRetry||generationAvailable&&canManageConcept&&["not_started","awaiting_confirmation","failed","done"].includes(concept?.status);
  const firstActionNote=generationBlockReason||(statusNeedsManualRetry
    ?concept?.status==="submission_unknown"
      ?"任务可能已提交；先重新核验远端状态，不会重复提交或扣费。"
      :"状态读取失败；可立即重试，或先进入正式报告继续审阅。"
    :concept?.status==="not_started"
      ?`调用 Lovart 可能消耗 ${cost??"服务商实际报价的"} credits，提交前由管理员确认。`
      :concept?.status==="awaiting_confirmation"
        ?`本次高质量生成预计消耗 ${cost??"一定数量的"} credits，确认后才会继续。`
        :concept?.status==="failed"
          ?"修复连接或额度问题后，可基于同一份研究重新生成。"
          :concept?.status==="done"
            ?"可基于同一份研究探索另一个设计方向。"
            :"套图在后台处理时，可先进入正式报告继续审阅。");
  const onSceneThumbKeyDown=(event,index)=>{
    const key=event.key;
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(key))return;
    event.preventDefault();
    const nextIndex=key==="Home"?0:key==="End"?presentedAssets.length-1:(index+(key==="ArrowRight"?1:-1)+presentedAssets.length)%presentedAssets.length;
    const nextAsset=presentedAssets[nextIndex];
    if(!nextAsset)return;
    const tablist=event.currentTarget.parentElement;
    setSelectedArtifactIndex(nextAsset.artifactIndex);
    requestAnimationFrame(()=>tablist?.querySelectorAll?.('[role="tab"]')?.[nextIndex]?.focus?.());
  };
  const jumpToFormalReport=()=>{
    const target=document.querySelector(".reference-report-root, .report-layout");
    target?.scrollIntoView({behavior:"smooth",block:"start"});
  };
  const compactBlocked=reportFirst&&loaded&&!hasVisibleConceptImage&&["blocked","unavailable"].includes(concept?.status);
  if(compactBlocked)return html`<section class="concept-panel concept-panel-compact" role="status" aria-live="polite">
    <i aria-hidden="true"></i><div><span class="concept-kicker">AIGC CONCEPT</span><b>${status[0]}</b><p>${generationBlockReason||status[1]}</p></div>
  </section>`;
  const adopt=async(asset,index)=>{
    if(run?.reviewed){ setError("报告已签核；请先撤销签核，再更换正式概念图。"); return; }
    if(!asset?.stored||!asset?.sha256){ setError("该图片尚未完成永久存档，不能采用为终审概念。"); return; }
    if(!window.confirm("采用后将更新正式报告、报告版本与导出内容，并清空当前决策草案。确认采用这张图？"))return;
    setBusy(`adopt-${index}`); setNotice("");
    try{
      const updated=await api(`/runs/${run.id}/concept/adopt`,{method:"POST",body:{
        confirm_adoption:true,
        concept_id:concept.id,
        artifact_index:asset.index??index,
        expected_report_hash:await sha256Json(report),
        expected_report_version:String(report?.report_version||report?.schema_version||"unknown"),
        expected_run_updated_at:run.updated_at,
        expected_concept_updated_at:concept.updated_at,
      }});
      onRunUpdated?.(updated);
      setError(""); setNotice("已采用为正式报告概念图；请重新完成人工终审。");
    }catch(e){ setError(e.message||"采用概念图失败"); }
    setBusy("");
  };
  const adoptSuite=async()=>{
    if(run?.reviewed){ setError("报告已签核；请先撤销签核，再采用新的场景套图。"); return; }
    if(!suiteReady){ setError("整套图片尚未全部永久存档，当前不能作为正式设计套图采用。"); return; }
    if(!window.confirm("采用整套后将以主视觉更新正式报告，并登记全部场景资产；产品一致性仍须人工逐张审查。确认采用？"))return;
    setBusy("adopt-suite"); setNotice("");
    try{
      const updated=await api(`/runs/${run.id}/concept/adopt`,{method:"POST",body:{
        confirm_adoption:true,
        concept_id:concept.id,
        artifact_index:heroArtifactIndex,
        adopt_suite:true,
        hero_artifact_index:heroArtifactIndex,
        artifact_indices:suiteArtifactIndices,
        expected_report_hash:await sha256Json(report),
        expected_report_version:String(report?.report_version||report?.schema_version||"unknown"),
        expected_run_updated_at:run.updated_at,
        expected_concept_updated_at:concept.updated_at,
      }});
      onRunUpdated?.(updated);
      setError(""); setNotice("整套场景图已采用；主视觉已写入正式报告，请完成人工一致性审查与终审。");
    }catch(e){ setError(e.message||"采用场景套图失败"); }
    setBusy("");
  };
  return html`<section class="concept-panel" aria-busy=${!loaded||Boolean(busy)}>
    <div class="concept-head">
      <div><span class="concept-kicker">LOVART · PRODUCT CONCEPT</span>
        <h2>研究结论 → 可落地产品概念</h2>
        <p>将 VOC、差异化、价格带与制造约束翻译为工业设计评审板。</p></div>
      ${!baselineFirstView?html`<div class=${"concept-state s-"+statusKey} role="status" aria-live="polite" aria-atomic="true"><i></i><span><b>${status[0]}</b><small>${status[1]}</small></span></div>`:""}
    </div>
    ${baselineFirstView?html`<div class="concept-first-view">
      <div class="concept-first-media">
        <button class="concept-image concept-first-image" onClick=${()=>imageStateOf(heroAsset)==="loaded"&&setActiveImage(heroAsset.url)} title=${imageStateOf(heroAsset)==="loaded"?"点击查看基线概念图大图":"图片验证完成后可查看大图"} aria-label="查看报告基线概念图大图" aria-disabled=${String(imageStateOf(heroAsset)!=="loaded")}>
          <${ConceptImageMedia} asset=${heroAsset} state=${imageStateOf(heroAsset)} alt=${`${brief.category||report?.category||"产品"} · ${heroAsset.title||baseline?.title||"报告基线概念图"}`} loading="eager" onLoad=${markImageLoaded} onError=${markImageFailed}/>
          ${imageStateOf(heroAsset)==="loaded"?html`<span>01 · 报告基线图</span>`:""}
        </button>
      </div>
      <div class="concept-first-copy">
        <div class=${"concept-state concept-first-state s-"+statusKey} role="status" aria-live="polite" aria-atomic="true"><i></i><span><b>${status[0]}</b><small>${status[1]}</small></span></div>
        <div class="concept-first-verdict"><span>研究结论</span><h3>${selected.name||brief.category||run.title}</h3>
          <p>${brief.commercial_decision?.product_thesis||baseline?.thesis||"根据研究结论提炼产品差异化与工程约束。"}</p></div>
        <div class="concept-first-metrics">
          <div><span>目标售价</span><b>${selected.target_price||selected.price_band||"待验证"}</b></div>
          <div><span>概念评分</span><b>${selected.score||"—"}</b></div>
        </div>
        ${problems.length?html`<div class="concept-first-pains"><span>优先解决</span><div>${problems.slice(0,5).map(p=>html`<em>${p.problem}${p.negative_ratio?` · ${Math.round(p.negative_ratio*100)}%`:""}</em>`)}</div></div>`:""}
        <div class="concept-first-action-block">
          <small>${firstActionNote}</small>
          <div class="concept-first-actions">
            ${statusNeedsManualRetry?html`<button class="btn concept-first-primary" disabled=${!loaded} onClick=${retryConceptStatus}>${loaded?"重新核验状态":"核验中…"}</button>`:generationAvailable&&concept?.status==="not_started"?(canManageConcept?html`<button class="btn concept-first-primary" disabled=${busy} onClick=${()=>act("start")}>${busy==="start"?"提交中…":"管理员确认后生成"}</button>`:html`<span class="concept-admin-note">仅管理员可启动付费生成</span>`):generationAvailable&&concept?.status==="awaiting_confirmation"?(canManageConcept?html`<button class="btn concept-first-primary" disabled=${busy} onClick=${()=>act("confirm")}>${busy==="confirm"?"确认中…":"管理员确认并继续"}</button>`:html`<span class="concept-admin-note">仅管理员可确认付费继续</span>`):generationAvailable&&(concept?.status==="failed"||concept?.status==="done")&&canManageConcept?html`<button class="btn concept-first-primary" disabled=${busy} onClick=${()=>act("regenerate")}>${busy==="regenerate"?"提交中…":"重新生成概念"}</button>`:""}
            <button class=${"btn concept-report-jump "+(hasFirstPrimaryAction?"ghost":"")} onClick=${jumpToFormalReport}>${reportFirst?"返回正式报告 ↑":"跳到正式报告 ↓"}</button>
          </div>
        </div>
      </div>
    </div>`:presentedAssets.length&&hasSceneSuite?html`<div class="concept-suite">
      <div class="concept-suite-layout">
        <div class="concept-suite-main">
          <article class="concept-suite-stage" id=${`concept-scene-panel-${conceptDomId}`} role="tabpanel" aria-labelledby=${`concept-scene-tab-${conceptDomId}-${presentedAssets.indexOf(selectedAsset)}`}>
            <button class="concept-suite-hero" onClick=${()=>imageStateOf(selectedAsset)==="loaded"&&setActiveImage(selectedAsset.url)} title=${imageStateOf(selectedAsset)==="loaded"?"查看大图":"图片验证完成后可查看大图"} aria-label=${`查看${selectedAsset.title}大图`} aria-disabled=${String(imageStateOf(selectedAsset)!=="loaded")}>
              <${ConceptImageMedia} asset=${selectedAsset} state=${imageStateOf(selectedAsset)} alt=${`${brief.category||report?.category||"产品"} · ${selectedAsset.title}`} loading="eager" onLoad=${markImageLoaded} onError=${markImageFailed}/>
              ${imageStateOf(selectedAsset)==="loaded"?html`<span class="concept-scene-tag">${String(selectedAsset.sequence).padStart(2,"0")} · ${sceneRoleLabel(selectedAsset.role)}</span>
              <span class=${"concept-archive-tag "+(selectedAsset.stored&&selectedAsset.sha256?"stored":"pending")}>${selectedAsset.stored&&selectedAsset.sha256?"已永久存档":"存档待完成"}</span>`:""}
            </button>
            <div class="concept-suite-caption">
              <div><span>${sceneRoleLabel(selectedAsset.role)}</span><b>${selectedAsset.title}</b><p>${selectedAsset.purpose||"同一产品设计 DNA 下的专业场景资产。"}</p></div>
              ${canManageConcept&&!selectedAsset.baseline?html`<button class="btn ghost concept-adopt-single" disabled=${busy||imageStateOf(selectedAsset)!=="loaded"||!selectedAsset.stored||!selectedAsset.sha256||run?.reviewed} title=${run?.reviewed?"请先撤销签核":imageStateOf(selectedAsset)!=="loaded"?"图片加载验证成功后才能采用":!selectedAsset.stored||!selectedAsset.sha256?"永久存档完成后才能采用":"仅采用当前图片"} onClick=${()=>adopt(selectedAsset,selectedAsset.artifactIndex)}>${busy===`adopt-${selectedAsset.artifactIndex}`?"采用中…":"仅采用此图"}</button>`:""}
            </div>
          </article>
          <div class="concept-suite-thumbs" role="tablist" aria-label="场景套图视图" aria-orientation="horizontal">
            ${presentedAssets.map((asset,index)=>{const isSelected=String(asset.artifactIndex)===String(selectedAsset.artifactIndex);return html`<button id=${`concept-scene-tab-${conceptDomId}-${index}`} role="tab" aria-selected=${isSelected} aria-controls=${`concept-scene-panel-${conceptDomId}`} tabIndex=${isSelected?0:-1} class=${"concept-suite-thumb"+(isSelected?" on":"")} onClick=${()=>setSelectedArtifactIndex(asset.artifactIndex)} onKeyDown=${event=>onSceneThumbKeyDown(event,index)} title=${asset.title}>
              <span class="concept-suite-thumb-image"><${ConceptImageMedia} asset=${asset} state=${imageStateOf(asset)} alt="" loading="eager" compact=${true} onLoad=${markImageLoaded} onError=${markImageFailed}/><i>${String(asset.sequence).padStart(2,"0")}</i></span>
              <span class="concept-suite-thumb-copy"><b>${sceneRoleLabel(asset.role)}</b><small>${asset.title}</small></span>
            </button>`})}
          </div>
        </div>
        <aside class="concept-suite-review" aria-label="套图交付状态">
          <div class="concept-suite-review-head"><span>SCENE SUITE</span><b>专业场景套图</b></div>
          <div class="concept-suite-completeness"><span>套图完整度</span><strong>${availableSuiteCount}<small> / ${expectedSuiteCount}</small></strong></div>
          <div class="concept-suite-progress" aria-label=${`套图完整度 ${suiteProgress}%`}><i style=${`width:${suiteProgress}%`}></i></div>
          <dl class="concept-suite-stats">
            <div><dt>图片已返回</dt><dd>${availableSuiteCount} 张</dd></div>
            <div><dt>永久存档</dt><dd>${Math.min(expectedSuiteCount,archivedSuiteAssets.length)} 张</dd></div>
            <div><dt>设计 DNA</dt><dd>${sceneSuite.design_dna_id||brief.design_dna?.id||"待绑定"}</dd></div>
          </dl>
          <div class="concept-consistency-review"><span>一致性待人工审查</span><p>逐张核对轮廓、比例、门抽与腿数、木纹方向、CMF 和五金；生成完成不等于工程定稿。</p></div>
          ${canManageConcept?html`<button class="btn concept-adopt-suite" disabled=${busy||!suiteReady||run?.reviewed} title=${run?.reviewed?"请先撤销签核":!suiteReady?"全部场景完成永久存档后可采用整套":"以主视觉写入报告并登记全部场景资产"} onClick=${adoptSuite}>${busy==="adopt-suite"?"采用中…":"采用整套"}</button>`:html`<span class="concept-admin-note">整套采用仅限管理员</span>`}
          <small class="concept-suite-boundary">套图用于设计与打样评审，不替代 CAD、工程图、认证测试或量产签样。</small>
        </aside>
      </div>
    </div>`:presentedAssets.length?html`<div class="concept-gallery">
      ${presentedAssets.map((asset,i)=>{const isAdopted=Number(adopted.concept_id)===Number(concept?.id)&&Number(adopted.artifact_index)===Number(asset.artifactIndex)&&adopted.asset_sha256===asset.sha256;return html`<article class=${"concept-asset"+(isAdopted?" adopted":"")}>
        <button class="concept-image" onClick=${()=>imageStateOf(asset)==="loaded"&&setActiveImage(asset.url)} title=${imageStateOf(asset)==="loaded"?"点击查看大图":"图片验证完成后可查看大图"} aria-disabled=${String(imageStateOf(asset)!=="loaded")}>
          <${ConceptImageMedia} asset=${asset} state=${imageStateOf(asset)} alt=${`${brief.category||report?.category||"产品"}概念设计图 ${i+1}`} loading="eager" onLoad=${markImageLoaded} onError=${markImageFailed}/>
          ${imageStateOf(asset)==="loaded"?html`<span>${String(i+1).padStart(2,"0")} · ${asset.baseline?"报告基线图":asset.stored?"已永久存档":"Lovart 临时源图"}</span>`:""}
        </button>
        ${!asset.baseline?html`<div class="concept-asset-foot"><span>${isAdopted?"当前正式报告概念":asset.stored&&asset.sha256?"可写入报告并重新终审":"仅供预览 · 等待永久存档"}</span>
          ${canManageConcept?html`<button class="btn ghost concept-adopt" disabled=${busy||isAdopted||imageStateOf(asset)!=="loaded"||!asset.stored||!asset.sha256||run?.reviewed} title=${run?.reviewed?"请先撤销签核":imageStateOf(asset)!=="loaded"?"图片加载验证成功后才能采用":!asset.stored||!asset.sha256?"永久存档完成后才能采用":isAdopted?"已采用":"采用为终审概念"} onClick=${()=>adopt(asset,asset.artifactIndex)}>${busy===`adopt-${asset.artifactIndex}`?"采用中…":isAdopted?"已采用":"采用为终审概念"}</button>`:""}
        </div>`:""}
      </article>`})}
      </div>`:!loaded?html`<div class="concept-generating loading">
      <div><b>正在读取概念图状态</b><p>请稍候，系统正在连接设计任务服务。</p></div>
    </div>`:error&&!concept?html`<div class="concept-generating failed">
      <div><b>概念图状态暂时无法读取</b><p>${error}</p></div>
    </div>`:["blocked","unavailable"].includes(concept?.status)?html`<div class="concept-generating idle">
      <div><b>${status[0]}</b><p>${generationBlockReason||status[1]}</p></div>
    </div>`:concept?.status==="not_started"?html`<div class="concept-generating idle">
      <div><b>尚未向 Lovart 提交</b><p>需由管理员确认可能产生的 credits 消耗，再开始高质量概念图生成。</p></div>
    </div>`:concept?.status==="failed"?html`<div class="concept-generating failed">
      <div><b>本次概念图没有生成成功</b><p>${concept?.error||"上游设计服务返回失败；检查连接或额度后再重新生成。"}</p></div>
    </div>`:concept?.status==="done"?html`<div class="concept-generating done-empty">
      <div><b>任务已完成，但没有可展示的图片</b><p>上游任务未返回有效图像文件，可重新生成或检查 Lovart 项目输出。</p></div>
    </div>`:["queued","generating","confirmation_unknown"].includes(concept?.status)?html`<div class="concept-generating">
      <div class="concept-orbit"><span></span><i></i></div>
      <div><b>${status[0]}</b><p>${status[1]}。概念图会在后台继续生成，你可以先阅读研究报告。</p></div>
    </div>`:html`<div class="concept-generating idle">
      <div><b>${status[0]}</b><p>${status[1]}。</p></div>
    </div>`}
    ${!baselineFirstView?html`<div class="concept-brief">
      <div class="concept-brief-main"><span>推荐方向</span><b>${selected.name||brief.category||run.title}</b>
        <p>${brief.commercial_decision?.product_thesis||baseline?.thesis||"根据研究结论提炼产品差异化与工程约束。"}</p></div>
      <div class="concept-metric"><span>目标售价</span><b>${selected.target_price||selected.price_band||"待验证"}</b></div>
      <div class="concept-metric"><span>概念评分</span><b>${selected.score||"—"}</b></div>
    </div>`:""}
    ${!baselineFirstView&&problems.length?html`<div class="concept-pains"><span>优先解决</span>${problems.slice(0,5).map(p=>html`<em>${p.problem}${p.negative_ratio?` · ${Math.round(p.negative_ratio*100)}%`:""}</em>`)}</div>`:""}
    ${!baselineFirstView&&generationAvailable&&concept?.status==="not_started"?html`<div class="concept-confirm">
      <div><b>等待管理员确认</b><p>调用 Lovart 生成概念图可能消耗 ${cost??"服务商实际报价的"} credits；只有管理员点击确认后才会提交任务。</p></div>
      ${canManageConcept?html`<button class="btn" disabled=${busy} onClick=${()=>act("start")}>${busy==="start"?"提交中…":"管理员确认后生成"}</button>`:html`<span class="concept-admin-note">仅管理员可启动付费生成</span>`}
    </div>`:""}
    ${!baselineFirstView&&generationAvailable&&concept?.status==="awaiting_confirmation"?html`<div class="concept-confirm">
      <div><b>Lovart 等待管理员确认</b><p>本次高质量生成预计消耗 ${cost??"一定数量的"} credits。管理员确认后才会继续，不会自动扣费。</p></div>
      ${canManageConcept?html`<button class="btn" disabled=${busy} onClick=${()=>act("confirm")}>${busy==="confirm"?"确认中…":"管理员确认并继续"}</button>`:html`<span class="concept-admin-note">仅管理员可确认付费继续</span>`}
    </div>`:""}
    ${concept?.error&&!["failed","done"].includes(concept.status)?html`<div class="concept-errorline" role="alert">${concept.error}</div>`:""}
    ${!baselineFirstView&&generationAvailable&&(concept?.status==="failed"||concept?.status==="done")?html`<div class="concept-actions">
      <span>${concept?.status==="failed"?"修复连接或额度问题后，可基于同一份研究重新生成。":"想探索另一个方向？可基于同一份研究重新设计。"}</span>
      ${canManageConcept?html`<button class="btn ghost" disabled=${busy} onClick=${()=>act("regenerate")}>${busy==="regenerate"?"提交中…":"重新生成概念"}</button>`:""}
    </div>`:""}
    ${!baselineFirstView&&statusNeedsManualRetry?html`<div class="concept-actions" role=${statusKey==="load_failed"?"alert":"status"}>
      <span>${concept?.status==="submission_unknown"?"任务可能已提交；请先核验远端状态，系统不会重复提交。":"概念图状态读取失败；可重新连接任务服务。"}</span>
      <button class="btn ghost" disabled=${!loaded} onClick=${retryConceptStatus}>${loaded?"重新核验状态":"核验中…"}</button>
    </div>`:""}
    ${error?html`<div class="concept-errorline" role="alert">${error}</div>`:""}
    ${notice?html`<div class="concept-notice" role="status" aria-live="polite">${notice}</div>`:""}
    ${activeImage?html`<div class="concept-lightbox" role="dialog" aria-modal="true" aria-label="产品概念图大图预览" onClick=${event=>{if(event.target===event.currentTarget)setActiveImage("")}}>
      <button aria-label="关闭大图预览" autoFocus onClick=${()=>setActiveImage("")}>×</button><img src=${activeImage} alt=${presentedAssets.find(asset=>asset.url===activeImage)?.title||"产品概念大图"} onError=${()=>{setActiveImage("");setError("概念图大图加载失败，请稍后重试。");}}/>
    </div>`:""}
  </section>`;
}

// ============ 顶层 ============
function ReportIntegrityUnavailable({ report, onReload, onBack }){
  const integrity=report?.report_integrity||{};
  const errors=Array.isArray(integrity.errors)?integrity.errors:[];
  const missing=Array.isArray(integrity.missing_required_blocks)?integrity.missing_required_blocks:[];
  const pageContract=integrity.page_contract||{};
  const diagnostics=errors.length?errors:[{code:"REPORT_UNAVAILABLE",path:"report",message:"报告正文无法通过结构校验"}];
  return html`<section class="empty run-error report-integrity-error" role="alert" aria-labelledby="report-integrity-title">
    <span>REPORT INTEGRITY · FAIL CLOSED</span>
    <b id="report-integrity-title">报告数据不完整，已停止渲染</b>
    <span>为避免把损坏数据渲染为空白页或误导性报告，系统已禁用签核与全部导出。原始研究档案仍保留。</span>
    <section class="report-integrity-diagnostics" aria-label="报告完整性诊断">
      <div><strong>结构状态</strong><span>${integrity.structural_status||integrity.status||"incomplete"}</span></div>
      <div><strong>模块数据</strong><span>${Number(integrity.populated_module_count)||0} / ${Number(integrity.required_module_count)||0}</span></div>
      <div><strong>页面合同</strong><span>${Number(pageContract.actual_pages)||0} / ${Number(pageContract.expected_pages)||0}</span></div>
      <h2>结构错误</h2>
      <ul>${diagnostics.slice(0,12).map((item,index)=>html`<li key=${`${item?.code||"ERROR"}-${index}`}><code>${item?.code||"REPORT_ERROR"}</code><strong>${item?.message||"报告结构不完整"}</strong><small>${item?.path||"report"}</small></li>`)}</ul>
      ${diagnostics.length>12?html`<p>另有 ${diagnostics.length-12} 项结构错误，请重新加载后查看最新诊断。</p>`:""}
      <h2>缺失数据块</h2>
      ${missing.length?html`<ul>${missing.slice(0,12).map((item,index)=>html`<li key=${`${item?.block_id||"BLOCK"}-${index}`}><code>${item?.block_id||"UNKNOWN_BLOCK"}</code><strong>${item?.status||"missing"}</strong><small>原第 ${item?.page||"?"} 页 · ${item?.source_path||item?.tried_source_paths?.join(" / ")||"未解析到数据源"}</small></li>`)}</ul>`:html`<p>当前诊断未返回逐块缺失清单；请重新加载，若仍失败需重新运行研究。</p>`}
    </section>
    <div class="report-integrity-actions">
      <button class="btn" type="button" onClick=${onReload}>重新加载报告</button>
      <button class="btn ghost" type="button" onClick=${onBack}>返回研究档案</button>
    </div>
  </section>`;
}

function ReferenceReportExperience(props){
  const report=props.report;
  const experienceKey=String(props.run?.id||"report");
  const visibilityScope=[experienceKey,String(report?.report_version||report?.schema_version||"unknown")].join("::");
  const [conceptVisibility,setConceptVisibility]=useState({scope:visibilityScope,visible:false});
  const conceptFirst=conceptVisibility.scope===visibilityScope&&conceptVisibility.visible;
  useEffect(()=>{ setConceptVisibility({scope:visibilityScope,visible:false}); },[visibilityScope]);
  const onAssetVisibilityChange=useCallback((hasAsset,scope)=>{
    if(scope!==visibilityScope)return;
    setConceptVisibility(current=>current.scope===scope&&current.visible===Boolean(hasAsset)?current:{scope,visible:Boolean(hasAsset)});
  },[visibilityScope]);
  const conceptDock=html`<div key=${`concept-${visibilityScope}`} class="reference-concept-dock"><${ConceptPanel} run=${props.run} report=${report} api=${props.api} onRunUpdated=${props.onRunUpdated} canManageConcept=${props.canManageConcept} onAssetVisibilityChange=${onAssetVisibilityChange} visibilityScope=${visibilityScope} reportFirst=${!conceptFirst}/></div>`;
  const referenceDeck=html`<${ReferenceReportDeck} key=${`deck-${experienceKey}`} report=${report} run=${props.run} api=${props.api} canUseOfficialExports=${props.canUseOfficialExports}/>`;
  return html`<div class=${"reference-report-experience "+(conceptFirst?"concept-first":"report-first")}>
    ${conceptFirst?[conceptDock,referenceDeck]:[referenceDeck,conceptDock]}
  </div>`;
}
export function ReportView(props){
  const report=props.report||{};
  if(report.report_unavailable===true)return html`<${ReportIntegrityUnavailable} report=${report} onReload=${props.onReload} onBack=${props.onBack}/>`;
  const canUseOfficialExports=report.report_unavailable!==true&&report.evidence_mode==="verified_research"&&report.decision_readiness==="ready_for_review";
  const isReferenceDeck=report.presentation_version==="reference-a4-v2" &&
    report.reference_framework_modules===62 &&
    (report.order||[]).length===62 &&
    (report.reference_page_plan||[]).length===332;
  return isReferenceDeck
    ? html`<${ReferenceReportExperience} report=${report} run=${props.run} api=${props.api} onRunUpdated=${props.onRunUpdated} canManageConcept=${props.canManageConcept} canUseOfficialExports=${canUseOfficialExports}/>`
    : html`<${LegacyReportView} report=${report} run=${props.run} api=${props.api} onRunUpdated=${props.onRunUpdated} canUseOfficialExports=${canUseOfficialExports} canManageConcept=${props.canManageConcept}/>`;
}

function LegacyReportView({ report, run, api, onRunUpdated, canUseOfficialExports, canManageConcept }){
  const [view,setView]=useState(run?.view_profile==="P4"?"p4":"p1");
  const [drawer,setDrawer]=useState(null);
  const [cur,setCur]=useState(()=>(report.order&&report.order[0])||"exec_summary_decision_scorecard");
  const mods=report.modules||{};
  const order=report.order||DEFAULT_ORDER;
  const extMeta=report.ext_meta||{};
  const navLabel=(id)=>CORE_LABEL[id]||extMeta[id]?.nav_short||id;
  const navIcon=(id)=>NAVICON[id]||EMOJI[extMeta[id]?.icon]||extMeta[id]?.icon||"◆";
  useEffect(()=>{ C.mountTooltip(); },[]);
  const open=(id)=>setDrawer(id);
  const exec=mods.exec_summary_decision_scorecard||{};
  const kpis=exec.kpi_tiles||[];
  const dec=exec.decision||{};
  const reviewChecks=run?.review_checks;
  const reviewed=Boolean(
    canUseOfficialExports&&run?.reviewed&&run?.decision_outcome&&run?.outcome_note&&
    run?.reviewer_id&&run?.reviewer_name&&run?.reviewed_at&&
    reviewChecks?.evidence===true&&reviewChecks?.economics===true&&reviewChecks?.risk===true&&
    /^[a-f0-9]{64}$/i.test(String(run?.review_report_hash||""))
  );
  const aiHeadline=dec.one_liner||report.verdict||"待研究结论";
  const decisionTone=reviewed
    ? run.decision_outcome==="进入"?"go":run.decision_outcome==="放弃"?"no_go":"conditional_go"
    : dec.verdict;
  const decisionHeadline=reviewed?`人工最终决策 · ${run.decision_outcome}`:aiHeadline;
  const vCls = decisionTone==="go"?"verdict-go":decisionTone==="no_go"?"verdict-no":"verdict-cond";
  const isTemplateDemo=["template_demo","synthetic_fixture"].includes(report.evidence_mode);
  const curIdx=Math.max(0,order.indexOf(cur));
  const goCur=useCallback((id)=>{ setCur(id); requestAnimationFrame(()=>{ const m=document.querySelector(".report-main"); if(m)m.scrollIntoView({behavior:"smooth",block:"start"}); }); },[]);
  const grouped=groupModules(order);
  const curGroup=grouped.find(g=>g.items.some(it=>it.id===cur));
  const prev=useCallback(()=>{ if(curIdx>0) goCur(order[curIdx-1]); },[curIdx,goCur,order]);
  const next=useCallback(()=>{ if(curIdx<order.length-1) goCur(order[curIdx+1]); },[curIdx,goCur,order]);
  const [heroOpen,setHeroOpen]=useState(true);
  const printReport=async(mode)=>{
    if(!canUseOfficialExports){
      alert(isTemplateDemo?"框架演示不可作为正式决策报告导出。":"关键证据尚未达到可审阅门槛，暂不可正式导出。");
      return;
    }
    try{
      const proof=await createExportProof(reviewed?"signed":"review",report);
      const check=await api(`/runs/${run.id}/export-check?${proof.query}`);
      verifyExportCheck(check,proof);
    }catch(error){
      alert(error.message||"打印前完整性校验失败");
      return;
    }
    document.body.dataset.printMode=mode;
    const clear=()=>{ delete document.body.dataset.printMode; window.removeEventListener("afterprint",clear); };
    window.addEventListener("afterprint",clear);
    window.print();
    setTimeout(clear,60000);
  };
  useEffect(()=>{ const el=document.querySelector(".secnav-list a.on"); if(el)el.scrollIntoView({block:"nearest"}); },[cur]);
  useEffect(()=>{ const h=(e)=>{ const t=e.target; if(t&&/INPUT|TEXTAREA|SELECT/.test(t.tagName||""))return;
      if(e.key==="ArrowLeft"){prev();} else if(e.key==="ArrowRight"){next();} };
    window.addEventListener("keydown",h); return ()=>window.removeEventListener("keydown",h); },[next,prev]);
  const vEmoji = decisionTone==="conditional_go"?"🟡":decisionTone==="go"?"🟢":"🔴";
  const referenceModuleCount=Number(report.reference_framework_modules);
  const aigcModuleCount=Number(report.aigc_modules);
  const referenceSummary=Number.isFinite(referenceModuleCount)&&referenceModuleCount>0
    ?`${referenceModuleCount} 项参考能力`
    :"部分实证研究";
  const aigcSummary=Number.isFinite(aigcModuleCount)&&aigcModuleCount>0
    ?`${aigcModuleCount} 个 AIGC 模块`
    :"AIGC 待补证解锁";
  return html`<div class=${view}>
    <div class=${"rpt-hero"+(heroOpen?"":" slim")}>
      <div class="top-row"><div style="flex:1;min-width:220px">
        <h1>${report.category}</h1>
        <div class="site">${report.marketplace||"Amazon US"} · 数据截至 ${report.data_cutoff||"报告观察日"} · ${referenceSummary} · ${aigcSummary} · 共 ${order.length} 模块</div></div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="toggle"><button class=${view==="p1"?"on":""} onClick=${()=>setView("p1")}>P1 选品</button>
            <button class=${view==="p4"?"on":""} onClick=${()=>setView("p4")}>P4 代理</button></div>
          <button class="btn ghost" disabled=${!canUseOfficialExports} title=${canUseOfficialExports?"打印董事会版":"证据未验证或尚未达到可审阅状态"} onClick=${()=>printReport("board")}>董事会版</button>
          <button class="btn ghost" disabled=${!canUseOfficialExports} title=${canUseOfficialExports?"打印完整版":"证据未验证或尚未达到可审阅状态"} onClick=${()=>printReport("full")}>完整版</button>
          <button class="hero-cl" onClick=${()=>setHeroOpen(o=>!o)} title=${heroOpen?"收起决策概览":"展开决策概览"}>${heroOpen?"▲ 收起概览":"▼ 展开概览"}</button></div>
      </div>
      ${reviewed?html`<div class="demoflag">人工终审已签核：${run.outcome_note||"已记录最终决策"} · 原 AI 建议：${aiHeadline}</div>`:canUseOfficialExports?html`<div class="demoflag">审阅稿 · 待人工终审。以下结论是 AI 研究建议，不等于采购、备货或上市批准。</div>`:html`<div class="demoflag">${isTemplateDemo?"框架演示 · 不可签核或作为正式交付。":"关键证据待补齐 · 当前报告暂不可发起终审或正式导出。"}</div>`}
      ${heroOpen?html`
      <div class="verdict-big ${vCls}">${vEmoji} ${decisionHeadline}</div>
      ${dec.gating_conditions?html`<div class="gates2">${dec.gating_conditions.map(g=>html`<span class="gate2">✓ ${g}</span>`)}</div>`:""}
      <div class="stat-strip">${kpis.map(k=>html`<div class="stat"><div class="k">${GL(k.label)}</div>
        <div class=${"v "+(k.tone==="good"?"pass":k.tone==="bad"?"neg":"")}>${k.value}<span style="font-size:12px;color:var(--faint)"> ${k.unit||""}</span></div>
        <div class="s">${k.sub||""}</div></div>`)}</div>
      ${report.demo_note?html`<div class="demoflag">${report.demo_note}</div>`:""}`
      :html`<div class=${"hero-slimbar "+vCls}><span class="hsb-v">${vEmoji} ${decisionHeadline}</span>
        ${kpis.slice(0,4).map(k=>html`<span class="hsb-k">${GL(k.label)} <b>${k.value}${k.unit||""}</b></span>`)}</div>`}
    </div>
    ${!report.board_report&&canUseOfficialExports&&html`<${ConceptPanel} run=${run} report=${report} api=${api} onRunUpdated=${onRunUpdated} canManageConcept=${canManageConcept}/>`}
    <div class="report-layout">
      <aside class="secnav"><div class="secnav-title">报告目录 · ${order.length} 模块</div>
        <div class="secnav-list">${grouped.map(g=>html`<div class="navg-sec">
          <div class="navg-hd">${g.label}<span class="navg-hc">${g.items.length}</span></div>
          ${g.items.map(it=>html`<a class=${cur===it.id?"on":""} onClick=${()=>goCur(it.id)}><span class="ni">${navIcon(it.id)}</span><span class="nt">${navLabel(it.id)}</span><span class="nn">${String(it.idx+1).padStart(2,"0")}</span></a>`)}
        </div>`)}</div>
      </aside>
      <div class="report-main">
        <div class="wk-bar">
          <div class="wk-crumb"><span class="wk-c0">报告</span><span class="wk-sep">›</span>${curGroup?html`<span class="wk-c0">${curGroup.label}</span><span class="wk-sep">›</span>`:""}<b>${navLabel(cur)}</b><span class="wk-idx">${curIdx+1} / ${order.length}</span></div>
          <div class="wk-nav">
            <button class="wk-btn" disabled=${curIdx===0} onClick=${prev} title="上一模块 (←)">‹ 上一</button>
            <button class="wk-btn" disabled=${curIdx>=order.length-1} onClick=${next} title="下一模块 (→)">下一 ›</button>
          </div>
        </div>
        <div class="wk-view">${order.map(id=>html`<div data-module=${id} class=${"wk-page"+(cur===id?" on":"")+(BOARD_PACK_IDS.has(id)?" print-board":"")}>${(!extMeta[id]?.force_generic&&RENDER[id]&&mods[id]) ? RENDER[id](mods[id],open) : (mods[id]&&extMeta[id]? genericModule(id,mods[id],extMeta[id],open) : "")}</div>`)}</div>
      </div>
    </div>
    ${drawer && html`<${Drawer} id=${drawer} onClose=${()=>setDrawer(null)}/>`}
  </div>`;
}
function Drawer({ id, onClose }){ const e=evFor(id);
  return html`<div><div class="scrim" onClick=${onClose}></div><aside class="drawer">
    <button class="dclose" onClick=${onClose}>×</button><h3>🔎 [${id}] · ${e.t}</h3><div class="dm">${e.m}</div>
    <div class="evidence">${e.b}</div></aside></div>`; }
