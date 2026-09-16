import htm, { h, useEffect, useRef, useState } from "./vendor/metis-vendor.js";
import { SELLER } from "./seller_spec.js";
import { calculateUnitEconomics, evaluateBriefReadiness } from "./brief-model.js";
const html = htm.bind(h);
// Authentication and research requests stay on this deployment's origin.
const apiUrl = (path) => path;

// —— Excel 模板 值序列化/反序列化 助手 ——
const splitList = (v) => String(v == null ? "" : v).split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
const yesish = (v) => /^(是|y|yes|true|1|✓|✔|on)/i.test(String(v == null ? "" : v).trim());
const yn = (b) => (b ? "是" : "否");
const profFmt = (f, v) => f.type === "pills" ? (Array.isArray(v) ? v.join("、") : (v || "")) : f.type === "toggle" ? yn(!!v) : (v == null ? "" : v);
const profParse = (f, v) => f.type === "pills" ? splitList(v) : f.type === "toggle" ? yesish(v) : f.type === "number" ? (v === "" || v == null ? "" : +v) : String(v == null ? "" : v);

const EXAMPLES = [["猫窝","cat bed"],["折叠露营椅","folding camping chair"],["瑜伽垫","yoga mat"],["宠物饮水机","dog water fountain"],["LED 美容仪","LED face mask"],["电动红酒开瓶器","electric wine opener"]];
const MARKETS = [["US","🇺🇸"],["UK","🇬🇧"],["DE","🇩🇪"],["FR","🇫🇷"],["IT","🇮🇹"],["ES","🇪🇸"],["JP","🇯🇵"],["CA","🇨🇦"],["MX","🇲🇽"],["AU","🇦🇺"]];
const PRESETS = { standard:[.25,.20,.20,.20,.15], seasonal:[.30,.22,.20,.18,.10], gift:[.28,.18,.24,.18,.12], durable:[.22,.16,.22,.28,.12] };
const WNAMES = ["市场需求","增长趋势","竞争强度","盈利空间","季节稳定性"];
const SOURCE_OPTIONS = [["spapi","SP-API"],["keepa","Keepa"],["keepamore","KeepaMore"],["dataforseo","DataForSEO"],["aba","ABA"],["helium","Helium10"]];
const DEFAULT_SOURCES = {spapi:false,keepa:false,keepamore:false,dataforseo:false,aba:false,helium:false};
const KEEPAMORE_CAT_BED_SAMPLE = {category:"cat bed",marketplace:"US",currency:"USD"};

function readBriefSeed() {
  try {
    const raw = localStorage.getItem("metis_brief_seed");
    localStorage.removeItem("metis_brief_seed");
    if (!raw) return null;
    const seed = JSON.parse(raw);
    if (!seed || Date.now() - Number(seed.created_at || 0) > 24 * 60 * 60 * 1000) return null;
    if (!['category_keyword','asin_list'].includes(seed.mode)) return null;
    return seed;
  } catch {
    return null;
  }
}

const BRIEF_DRAFT_VERSION = 1;
const draftStorageKey = (ownerKey) => `metis_brief_draft_v1:${String(ownerKey || "workspace").slice(0, 160)}`;
const fromDraft = (draft, key, fallback) => draft && Object.prototype.hasOwnProperty.call(draft, key)
  ? draft[key]
  : fallback;

function readBriefDraft(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    if (
      envelope?.version !== BRIEF_DRAFT_VERSION ||
      !envelope.values ||
      Date.now() - Number(envelope.saved_at || 0) > 24 * 60 * 60 * 1000
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
}

function Pills({ value, onChange, placeholder, label, inputId, fieldId, invalid = false, describedBy }) {
  const [cur, setCur] = useState("");
  const add = (t) => { const ps = t.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean); if(ps.length) onChange(Array.from(new Set([...value,...ps]))); setCur(""); };
  const accessibleLabel=label||placeholder||"添加项目";
  return html`<div data-brief-field=${fieldId}><input id=${inputId} value=${cur} onInput=${e=>setCur(e.target.value)}
      onKeyDown=${e=>{if(["Enter",","," "].includes(e.key)){e.preventDefault();add(cur);}}}
      onBlur=${()=>cur&&add(cur)} placeholder=${placeholder} aria-label=${accessibleLabel}
      aria-invalid=${invalid} aria-describedby=${describedBy}/>
    <div class="pills">${value.map(v=>html`<span class="pill">${v} <button type="button" aria-label=${`移除${accessibleLabel}：${v}`} style="padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer" onClick=${()=>onChange(value.filter(x=>x!==v))}>×</button></span>`)}
      ${value.length===0&&html`<span class="exlabel">回车/逗号添加</span>`}</div></div>`;
}
function Bsec(n, title, sub, body, expanded, onToggle, presentation){
  const headingId=`brief-step-${n}-heading`, bodyId=`brief-step-${n}-body`;
  const {track="高级可选",status="可选",tone="optional"}=presentation||{};
  return html`<details class="briefsec" id=${`brief-step-${n}`} open=${expanded} onToggle=${event=>onToggle(event.currentTarget.open)}><summary class="bshead" id=${headingId} aria-expanded=${expanded} aria-controls=${bodyId}><span class="bsn">${n}</span><div><div class="bst">${title}</div><div class="bss">${sub}</div></div><span class="briefsec-meta"><em>${track}</em><strong class=${`briefsec-status ${tone}`}>${status}</strong></span><i class="briefsec-caret" aria-hidden="true">⌄</i></summary><div class="briefsec-body" id=${bodyId} role="region" aria-labelledby=${headingId}>${body}</div></details>`;
}

function EditableTable({ columns, rows, onChange, addLabel, invalid = false, describedBy }){
  const setCell=(i,k,v)=>onChange(rows.map((x,j)=>j===i?{...x,[k]:v}:x));
  const addRow=()=>onChange([...rows, Object.fromEntries(columns.map(c=>[c.key,""]))]);
  const del=(i)=>onChange(rows.filter((_,j)=>j!==i));
  return html`<div class="etbl"><table><thead><tr>${columns.map(c=>html`<th>${c.label}</th>`)}<th class="etx"></th></tr></thead>
    <tbody>${rows.map((r,i)=>html`<tr>${columns.map((c,columnIndex)=>html`<td data-label=${c.label}><input class="etin" type=${c.type||"text"} value=${r[c.key]??""} placeholder=${c.ph||""} aria-invalid=${invalid&&i===0&&columnIndex===0} aria-describedby=${invalid&&i===0&&columnIndex===0?describedBy:undefined} onInput=${e=>setCell(i,c.key,e.target.value)}/></td>`)}
      <td class="etx"><button class="etdel" type="button" onClick=${()=>del(i)} title="删除行">×</button></td></tr>`)}</tbody></table>
    <button class="etadd" type="button" onClick=${addRow}>＋ ${addLabel||"添加一行"}</button></div>`;
}

// —— 数据驱动的字段渲染器（按卖家类型自适应）——
function Field({ f, value, onChange }) {
  const wide = ["segment", "pills", "toggle"].includes(f.type);
  const controlId=`brief-profile-${String(f.id).replace(/[^A-Za-z0-9_-]/g,"-")}`;
  const labelId=`${controlId}-label`;
  const labelFor=["number","text","select"].includes(f.type)||(f.type==="pills"&&!f.options)?controlId:undefined;
  const lbl = html`<label id=${labelId} for=${labelFor}>${f.label}${f.unit ? html` <span class="fu">${f.unit}</span>` : ""}</label>`;
  let body;
  if (f.type === "number") body = html`${lbl}<input id=${controlId} type="number" placeholder=${f.placeholder || ""} value=${value} onInput=${e => onChange(e.target.value === "" ? "" : +e.target.value)}/>`;
  else if (f.type === "text") body = html`${lbl}<input id=${controlId} placeholder=${f.placeholder || ""} value=${value} onInput=${e => onChange(e.target.value)}/>`;
  else if (f.type === "select") body = html`${lbl}<select id=${controlId} value=${value} onChange=${e => onChange(e.target.value)}>${(f.options || []).map(o => html`<option>${o}</option>`)}</select>`;
  else if (f.type === "segment") body = html`${lbl}<div class="mkts" role="group" aria-labelledby=${labelId}>${(f.options || []).map(o => html`<button type="button" class=${"mktbtn" + (value === o ? " on" : "")} aria-pressed=${value === o} aria-label=${`${f.label}：${o}`} onClick=${() => onChange(o)}>${o}</button>`)}</div>`;
  else if (f.type === "pills") body = f.options
      ? html`${lbl}<div class="chips2" role="group" aria-labelledby=${labelId}>${f.options.map(o => html`<button type="button" class=${"chip2" + ((value || []).includes(o) ? " on" : "")} aria-pressed=${(value || []).includes(o)} aria-label=${`${f.label}：${o}`} onClick=${() => onChange((value || []).includes(o) ? value.filter(x => x !== o) : [...(value || []), o])}>${o}</button>`)}</div>`
      : html`${lbl}<${Pills} value=${value || []} onChange=${onChange} placeholder=${f.placeholder || ""} label=${f.label} inputId=${controlId}/>`;
  else if (f.type === "toggle") body = html`<label for=${controlId} style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0"><input id=${controlId} type="checkbox" style="width:auto" checked=${!!value} onChange=${() => onChange(!value)}/> ${f.label}${f.unit ? html` <span class="fu">${f.unit}</span>` : ""}</label>`;
  else body = "";
  return html`<div class=${"fld" + (wide ? " fld-wide" : "")}>${body}</div>`;
}
function fieldDefault(f) {
  if (f.type === "toggle") return f.default === true || f.default === "true";
  if (f.type === "pills") return Array.isArray(f.default) ? [...f.default] : [];
  if (f.type === "number") return f.default != null ? +f.default : "";
  return f.default != null ? f.default : "";
}
function profileDefaults(t, prev) {
  const o = {};
  [...SELLER.common, ...SELLER.blocks[t]].forEach(f => { o[f.id] = fieldDefault(f); });
  if (prev) SELLER.common.forEach(f => { if (prev[f.id] !== undefined) o[f.id] = prev[f.id]; });
  return o;
}
function presetWeights(t) {
  const p = SELLER.presets[t]; if (!p) return null;
  return [p.demand, p.growth, p.competition, p.monetization, p.seasonality].map(x => (x || 0) / 100);
}

export function BriefWizard({ api, go, token, ownerKey }) {
  const [seed]=useState(readBriefSeed);
  const [draftKey]=useState(()=>draftStorageKey(ownerKey));
  const [savedEnvelope]=useState(()=>seed?null:readBriefDraft(draftKey));
  const saved=savedEnvelope?.values||null;
  const [openSteps,setOpenSteps]=useState(()=>new Set(
    Array.isArray(saved?.openSteps)
      ? saved.openSteps.map(String).filter(step=>/^[1-7]$/.test(step))
      : []
  ));
  const initialSellerType=fromDraft(saved,"sellerType","brand");
  const [mode,setMode]=useState(()=>fromDraft(saved,"mode",seed?.mode||"category_keyword"));
  const [kw,setKw]=useState(()=>fromDraft(saved,"kw",seed?.mode==="category_keyword"?String(seed.payload||""):""));
  const [asins,setAsins]=useState(()=>fromDraft(saved,"asins",seed?.mode==="asin_list"&&Array.isArray(seed.payload)?seed.payload:[]));
  const [mkts,setMkts]=useState(()=>fromDraft(saved,"mkts",[seed?.marketplace||"US"]));
  const [excl,setExcl]=useState(()=>fromDraft(saved,"excl",[]));
  const [pmin,setPmin]=useState(()=>fromDraft(saved,"pmin",15)),[pmax,setPmax]=useState(()=>fromDraft(saved,"pmax",65));
  const [bands,setBands]=useState(()=>fromDraft(saved,"bands",[
    {name:"入门",lo:15,hi:30,feat:"",scene:""},
    {name:"甜蜜区",lo:30,hi:45,feat:"",scene:""},
    {name:"溢价",lo:45,hi:65,feat:"",scene:""}]));
  const splitBands=(n)=>{ const lo=+pmin||0,hi=+pmax||0; if(hi<=lo||n<1)return;
    const step=(hi-lo)/n, L=["入门","甜蜜区","进阶","溢价","高端","小众","超高端","顶配"];
    const r=(x)=>Math.round(x*100)/100;
    setBands(Array.from({length:n},(_,i)=>({name:L[i]||("带"+(i+1)),lo:r(lo+i*step),hi:r(lo+(i+1)*step),feat:"",scene:""}))); };
  const [customCosts,setCustomCosts]=useState(()=>fromDraft(saved,"customCosts",[]));
  const [certsCustom,setCertsCustom]=useState(()=>fromDraft(saved,"certsCustom",[]));
  const [thr,setThr]=useState(()=>fromDraft(saved,"thr",{gradeA:8,gradeB:7,gradeC:6,minMargin:8,maxWall:500,betCap:30,ruinCap:15}));
  const [seasons,setSeasons]=useState(()=>fromDraft(saved,"seasons",[]));
  const [xcaps,setXcaps]=useState(()=>fromDraft(saved,"xcaps",{review_wall:2500,growth:200,star_wall:5,net_margin:35}));
  const [sourcesCustom,setSourcesCustom]=useState(()=>fromDraft(saved,"sourcesCustom",[]));
  const [alphaDims,setAlphaDims]=useState(()=>fromDraft(saved,"alphaDims",[
    {name:"成本优势",weight:"25",level:"中",evid:"报价单"},{name:"流量获取力",weight:"25",level:"弱",evid:"无"}]));
  const [vocAspects,setVocAspects]=useState(()=>fromDraft(saved,"vocAspects",[]));
  const [advOpen,setAdvOpen]=useState(()=>fromDraft(saved,"advOpen",false));
  const [sellerType,setSellerType]=useState(initialSellerType);
  const [profile,setProfile]=useState(()=>fromDraft(saved,"profile",profileDefaults(initialSellerType)));
  const setPf=(id,v)=>setProfile(p=>({...p,[id]:v}));
  const pickType=(t)=>{ setSellerType(t); setProfile(p=>profileDefaults(t,p)); const pw=presetWeights(t); if(pw)setWeights(pw); };
  const [goals,setGoals]=useState(()=>fromDraft(saved,"goals",["entry","redesign","pricing"]));
  const [haz,setHaz]=useState(()=>fromDraft(saved,"haz",{battery:false,liquid:false,fda:false,dimweight:false}));
  const [certs,setCerts]=useState(()=>fromDraft(saved,"certs",[]));
  const [seasS,setSeasS]=useState(()=>fromDraft(saved,"seasS","")),[seasE,setSeasE]=useState(()=>fromDraft(saved,"seasE",""));
  const [sources,setSources]=useState(()=>({...DEFAULT_SOURCES,...fromDraft(saved,"sources",{})}));
  const [win,setWin]=useState(()=>fromDraft(saved,"win",90)),[gate,setGate]=useState(()=>fromDraft(saved,"gate","High")),[strict,setStrict]=useState(()=>fromDraft(saved,"strict","strict"));
  const [scope,setScope]=useState(()=>fromDraft(saved,"scope","public_ok"));
  const [weights,setWeights]=useState(()=>fromDraft(saved,"weights",presetWeights(initialSellerType)||PRESETS.standard));
  const [views,setViews]=useState(()=>fromDraft(saved,"views",["P1","P4"]));
  const [busy,setBusy]=useState(false);
  const [comps,setComps]=useState(()=>fromDraft(saved,"comps",[]));
  const [cost,setCost]=useState(()=>fromDraft(saved,"cost",{fob:"",freight:"",duty:"",dutyBase:"",duty301:"",duty232:"",fba:"",acos:"",price:""}));
  const economics=calculateUnitEconomics(cost);
  const { referral, dutyAmount:dutyAmt, dutyRate, landed, advertising:ad, net, netMargin:netPct }=economics;

  const wsum = weights.reduce((a,b)=>a+b,0);
  const setW=(i,v)=>{ const w=[...weights]; w[i]=v/100; setWeights(w); };
  const toggle=(obj,set,k)=>set({...obj,[k]:!obj[k]});
  const multiToggle=(arr,set,v)=>set(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v]);

  const readiness=evaluateBriefReadiness({
    mode,keyword:kw,asins,markets:mkts,priceMin:pmin,priceMax:pmax,bands,goals,weights,views,
  });
  const readinessById=Object.fromEntries(readiness.checks.map(item=>[item.id,item]));
  const requestedSourceCount=Object.values(sources).filter(Boolean).length+sourcesCustom.length;
  const requestedSourceLabels=[
    ...SOURCE_OPTIONS.filter(([key])=>sources[key]).map(([,label])=>label),
    ...sourcesCustom,
  ];
  const checksByStep=readiness.checks.reduce((groups,item)=>{
    (groups[item.step]||(groups[item.step]=[])).push(item);
    return groups;
  },{});
  const stepPresentation=Object.fromEntries(Array.from({length:7},(_,index)=>{
    const step=String(index+1), checks=checksByStep[step]||[];
    if(!checks.length)return [step,{track:"高级可选",status:"可选",tone:"optional"}];
    const missing=checks.filter(item=>!item.ready).length;
    return [step,{
      track:"启动必填",
      status:missing?`${missing}项待补`:"已完成",
      tone:missing?"blocked":"complete",
    }];
  }));
  const deliveryCapability=scope==="private_only"
    ? {
        tone:requestedSourceCount?"pending":"limited",
        level:requestedSourceCount?"私域证据计划（待校验）":"框架演示",
        detail:requestedSourceCount
          ? "本次只允许使用已授权的私域数据。所选来源需在运行前通过权限与可用性校验，未通过的来源不会写入结论。"
          : "已限制为仅私域数据，但尚未请求任何来源；当前只能生成研究框架，不能形成实证结论。",
      }
    : requestedSourceCount
      ? {
          tone:"pending",
          level:"证据增强计划（待校验）",
          detail:"本次允许使用公共数据，并请求外部来源补强证据。运行前将逐项校验，只有实际返回的数据会进入报告。",
        }
      : {
          tone:"limited",
          level:"框架演示",
          detail:"本次允许使用公共数据，但尚未请求外部来源；可生成完整分析框架，不能把估算内容标记为真实市场证据。",
        };
  const [submitError,setSubmitError]=useState("");
  const [draftSavedAt,setDraftSavedAt]=useState(savedEnvelope?.saved_at||0);
  const [draftStatus,setDraftStatus]=useState(savedEnvelope?"restored":"saving");
  const [revealedIssues,setRevealedIssues]=useState(()=>new Set());
  const [clearDraftPending,setClearDraftPending]=useState(false);
  const submittedRef=useRef(false);
  const submitInFlightRef=useRef(false);
  const submitErrorRef=useRef();
  const clearDraftTriggerRef=useRef();
  const clearDraftConfirmRef=useRef();
  const returnClearDraftFocusRef=useRef(false);
  const autoOpenedStepRef=useRef(false);
  const draftJson=JSON.stringify({
    mode,kw,asins,mkts,excl,pmin,pmax,bands,customCosts,certsCustom,thr,seasons,xcaps,
    sourcesCustom,alphaDims,vocAspects,advOpen,sellerType,profile,goals,haz,certs,seasS,seasE,
    sources,win,gate,strict,scope,weights,views,comps,cost,openSteps:Array.from(openSteps).sort(),
  });
  const latestDraftJsonRef=useRef(draftJson);
  const lastSavedJsonRef=useRef(savedEnvelope?draftJson:"");
  const draftDirtyRef=useRef(!savedEnvelope);

  useEffect(()=>{
    if(autoOpenedStepRef.current)return;
    autoOpenedStepRef.current=true;
    if(Array.isArray(savedEnvelope?.values?.openSteps))return;
    const firstBlockingStep=readiness.blockers[0]?.step||"3";
    setOpenSteps(new Set([String(firstBlockingStep)]));
  },[savedEnvelope,readiness.blockers]);

  useEffect(()=>{
    if(!clearDraftPending&&!returnClearDraftFocusRef.current)return undefined;
    const frame=requestAnimationFrame(()=>{
      const target=clearDraftPending?clearDraftConfirmRef.current:clearDraftTriggerRef.current;
      target?.focus({preventScroll:true});
      if(!clearDraftPending)returnClearDraftFocusRef.current=false;
    });
    return()=>cancelAnimationFrame(frame);
  },[clearDraftPending]);

  useEffect(()=>{
    if(submittedRef.current)return undefined;
    latestDraftJsonRef.current=draftJson;
    draftDirtyRef.current=draftJson!==lastSavedJsonRef.current;
    if(!draftDirtyRef.current)return undefined;
    setDraftStatus("saving");
    const timer=setTimeout(()=>{
      try{
        const savedAt=Date.now();
        sessionStorage.setItem(draftKey,JSON.stringify({
          version:BRIEF_DRAFT_VERSION,saved_at:savedAt,values:JSON.parse(draftJson),
        }));
        lastSavedJsonRef.current=draftJson;
        draftDirtyRef.current=false;
        setDraftSavedAt(savedAt);
        setDraftStatus("saved");
      }catch{
        setDraftStatus("error");
      }
    },400);
    return ()=>clearTimeout(timer);
  },[draftKey,draftJson]);

  useEffect(()=>{
    const persistLatest=()=>{
      if(submittedRef.current||!draftDirtyRef.current)return true;
      try{
        const savedAt=Date.now(), serialized=latestDraftJsonRef.current;
        sessionStorage.setItem(draftKey,JSON.stringify({
          version:BRIEF_DRAFT_VERSION,saved_at:savedAt,values:JSON.parse(serialized),
        }));
        lastSavedJsonRef.current=serialized;
        draftDirtyRef.current=false;
        return true;
      }catch{
        return false;
      }
    };
    const onBeforeUnload=event=>{
      if(persistLatest())return;
      event.preventDefault();
      event.returnValue="";
    };
    addEventListener("beforeunload",onBeforeUnload);
    return ()=>{
      removeEventListener("beforeunload",onBeforeUnload);
      persistLatest();
    };
  },[draftKey]);

  const issueVisible=id=>revealedIssues.has(id)&&!readinessById[id]?.ready;
  const issueId=id=>`brief-${id}-error`;
  const fieldIssue=id=>issueVisible(id)
    ? html`<div class="note brief-field-error" id=${issueId(id)}>${readinessById[id].detail}</div>`
    : "";
  const scrollToStep=(step,fieldId="")=>{
    const element=document.getElementById(`brief-step-${step}`);
    if(element){
      element.open=true;
      setOpenSteps(current=>new Set([...current,String(step)]));
      requestAnimationFrame(()=>{
        const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        element.scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});
        const field=fieldId?element.querySelector(`[data-brief-field="${fieldId}"]`):null;
        const focusTarget=field?.matches?.("input,button,select,textarea,[tabindex]")
          ? field
          : field?.querySelector?.("input:not([type='hidden']),button,select,textarea,[tabindex]");
        (focusTarget||element.querySelector("summary"))?.focus({preventScroll:true});
      });
    }
  };
  const inspectCheck=item=>{
    if(!item.ready)setRevealedIssues(current=>new Set([...current,item.id]));
    scrollToStep(item.step,item.ready?"":item.id);
  };
  const setStepOpen=(step,open)=>setOpenSteps(current=>{
    const next=new Set(current);
    if(open)next.add(String(step));else next.delete(String(step));
    return next;
  });
  const requestClearDraft=()=>{
    returnClearDraftFocusRef.current=false;
    setClearDraftPending(true);
  };
  const cancelClearDraft=()=>{
    returnClearDraftFocusRef.current=true;
    setClearDraftPending(false);
  };
  const clearDraft=()=>{
    submittedRef.current=true;
    sessionStorage.removeItem(draftKey);
    location.reload();
  };

  // —— 输入模板 导出 / 导入 ——
  const fileRef = useRef();
  const keepaMoreFileRef = useRef();
  const [ioBusy, setIoBusy] = useState("");
  const [ioFeedback,setIoFeedback]=useState({tone:"",message:""});
  const ioInFlightRef=useRef(false);
  function briefRows(){
    const S=[], sec=(k,part,label,val,hint)=>S.push([k,part,label,val,hint]);
    sec("sellerType","1 卖家画像","卖家类型",sellerType,"factory / brand / reseller");
    [...SELLER.common, ...SELLER.blocks[sellerType]].forEach(f=>{
      const base=(f.options||[]).join(" / ") || ({number:"数字",toggle:"是/否",pills:"逗号分隔多值",text:"文本"}[f.type]||"");
      const hint=f.unit?(base+"（单位: "+f.unit+"）"):base;
      sec("profile."+f.id,"1 卖家画像",f.label+(f.unit?"（"+f.unit+"）":""),profFmt(f,profile[f.id]),hint);
    });
    sec("goals","2 研究目标","研究目标",goals.join(","),"entry,redesign,teardown,pricing,gtm");
    sec("mode","3 品类范围","输入模式",mode,"category_keyword / asin_list");
    sec("kw","3 品类范围","品类关键词",kw,"文本");
    sec("asins","3 品类范围","竞品ASIN列表",asins.join(","),"逗号分隔");
    sec("pmin","3 品类范围","价格带下限$",pmin,"数字");
    sec("pmax","3 品类范围","价格带上限$",pmax,"数字");
    sec("mkts","3 品类范围","目标站点",mkts.join(","),"US,UK,DE,JP,CA 逗号分隔");
    sec("excl","3 品类范围","排除品牌",excl.join(","),"逗号分隔");
    [["battery","带电/含磁"],["liquid","液体/易燃"],["fda","化妆品FDA"],["dimweight","抛重敏感"]].forEach(([k,l])=>
      sec("haz."+k,"4 约束合规",l,yn(haz[k]),"是/否"));
    sec("certs","4 约束合规","所需认证",certs.join(","),"逗号分隔");
    sec("certsCustom","4 约束合规","自定义认证/法规",certsCustom.join(","),"逗号分隔");
    sec("seasS","4 约束合规","主旺季起始月",seasS,"1-12");
    sec("seasE","4 约束合规","主旺季结束月",seasE,"1-12");
    sec("seasons","4 约束合规","多峰季节段",seasons.map(s=>`${s.s}-${s.e}:${s.note||""}`).join("; "),"起-止:说明; 分号分隔多峰");
    SOURCE_OPTIONS.forEach(([k,l])=>
      sec("sources."+k,"5 数据方法","数据源:"+l,yn(sources[k]),"是/否"));
    sec("sourcesCustom","5 数据方法","自定义数据源",sourcesCustom.join(","),"逗号分隔");
    sec("win","5 数据方法","数据窗口(天)",win,"30 / 60 / 90 / 180");
    sec("gate","5 数据方法","置信度门槛",gate,"Low / Medium / High");
    sec("strict","5 数据方法","终审严格度",strict,"light / standard / strict");
    sec("scope","5 数据方法","数据范围",scope,"public_ok / private_only");
    WNAMES.forEach((nm,i)=> sec("weights."+i,"6 机会分权重",nm,Math.round(weights[i]*100),"0-50 相对权重"));
    sec("views","7 交付偏好","交付视图",views.join(","),"P1,P4 逗号分隔");
    [["fob","FOB出厂价$"],["freight","头程/件$"],["dutyBase","关税MFN%"],["duty301","+301%"],["duty232","+232%"],["fba","FBA费$"],["acos","目标ACOS%"],["price","拟定售价$"]].forEach(([k,l])=>
      sec("cost."+k,"3 成本结构",l,cost[k]??"","数字"));
    sec("customCosts","3 成本结构","自定义成本项",customCosts.map(c=>`${c.item}:${c.val}:${c.unit}`).join("; "),"项:值:单位; 分号分隔");
    [["gradeA","A级阈值"],["gradeB","B级阈值"],["gradeC","C级阈值"],["minMargin","最低净利率%"],["maxWall","最大头部评论墙"],["betCap","单赛道下注上限%"],["ruinCap","破产概率阈值%"]].forEach(([k,l])=>
      sec("thr."+k,"8 高级",l,thr[k],"数字"));
    [["review_wall","评论墙cap"],["growth","增长率cap%"],["star_wall","星级cap"],["net_margin","净利率cap%"]].forEach(([k,l])=>
      sec("xcap."+k,"8 高级",l,xcaps[k],"数字"));
    sec("alphaDims","8 高级","自定义能力维",alphaDims.map(a=>`${a.name}:${a.weight}:${a.level}:${a.evid}`).join("; "),"名:权重:水平:举证; 分号分隔");
    sec("vocAspects","8 高级","关注VOC方面",vocAspects.join(","),"逗号分隔");
    return { main:S, comps_cols:["竞品ASIN","售价$","预估月销","主打卖点","备注"],
             comps_rows: comps.map(c=>[c.asin,c.price,c.sold,c.usp,c.note]),
             bands_cols:["赛道名","下限$","上限$","关键特征","场景/人群"],
             bands_rows: bands.map(b=>[b.name,b.lo,b.hi,b.feat,b.scene]) };
  }
  async function exportBrief(){
    if(ioInFlightRef.current)return;
    ioInFlightRef.current=true;
    setIoBusy("export");
    setIoFeedback({tone:"",message:""});
    try{
      const res=await fetch(apiUrl("/api/brief/export"),{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify(briefRows())});
      if(!res.ok) throw new Error("导出失败("+res.status+")");
      const blob=await res.blob(); const a=document.createElement("a");
      a.href=URL.createObjectURL(blob); a.download="Metis-研究简报模板.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),1500);
      setIoFeedback({tone:"success",message:"输入模板已导出，可继续在当前页面编辑。"});
    }catch(e){
      setIoFeedback({tone:"error",message:`导出失败：${e.message||"请稍后重试"}`});
    }
    ioInFlightRef.current=false;
    setIoBusy("");
  }
  function applyImport(res){
    const m=res.main||{}; const has=(k)=>Object.prototype.hasOwnProperty.call(m,k);
    let t=sellerType; if(has("sellerType")){ const v=String(m.sellerType).trim(); if(SELLER.blocks[v]) t=v; }
    const prof=profileDefaults(t,profile);
    [...SELLER.common, ...SELLER.blocks[t]].forEach(f=>{ const k="profile."+f.id; if(has(k)) prof[f.id]=profParse(f,m[k]); });
    setSellerType(t); setProfile(prof);
    if(has("goals")) setGoals(splitList(m.goals));
    if(has("mode")){ const v=String(m.mode).trim(); if(v==="category_keyword"||v==="asin_list") setMode(v); }
    if(has("kw")) setKw(String(m.kw));
    if(has("asins")) setAsins(splitList(m.asins));
    if(has("pmin")) setPmin(+m.pmin||0);
    if(has("pmax")) setPmax(+m.pmax||0);
    if(has("mkts")){ const v=splitList(m.mkts).map(x=>x.toUpperCase()); if(v.length) setMkts(v); }
    if(has("excl")) setExcl(splitList(m.excl));
    const nh={...haz}; ["battery","liquid","fda","dimweight"].forEach(k=>{ if(has("haz."+k)) nh[k]=yesish(m["haz."+k]); }); setHaz(nh);
    if(has("certs")) setCerts(splitList(m.certs).map(x=>x.toUpperCase()));
    if(has("seasS")) setSeasS(+m.seasS||1);
    if(has("seasE")) setSeasE(+m.seasE||12);
    const nsr={...sources}; SOURCE_OPTIONS.forEach(([k])=>{ if(has("sources."+k)) nsr[k]=yesish(m["sources."+k]); }); setSources(nsr);
    if(has("win")) setWin(+m.win||90);
    if(has("gate")){ const v=String(m.gate).trim(); if(["Low","Medium","High"].includes(v)) setGate(v); }
    if(has("strict")){ const v=String(m.strict).trim(); if(["light","standard","strict"].includes(v)) setStrict(v); }
    if(has("scope")){ const v=String(m.scope).trim(); if(["public_ok","private_only"].includes(v)) setScope(v); }
    const nw=[...weights]; WNAMES.forEach((_,i)=>{ if(has("weights."+i)) nw[i]=(+m["weights."+i]||0)/100; }); setWeights(nw);
    if(has("views")) setViews(splitList(m.views).map(x=>x.toUpperCase()));
    const nc={...cost}; ["fob","freight","duty","dutyBase","duty301","duty232","fba","acos","price"].forEach(k=>{ if(has("cost."+k)) nc[k]=+m["cost."+k]||0; }); setCost(nc);
    if(Array.isArray(res.comps)&&res.comps.length)
      setComps(res.comps.map(r=>({asin:String(r[0]??""),price:r[1]??"",sold:r[2]??"",usp:String(r[3]??""),note:String(r[4]??"")})));
    if(Array.isArray(res.bands)&&res.bands.length)
      setBands(res.bands.map(r=>({name:String(r[0]??""),lo:r[1]??"",hi:r[2]??"",feat:String(r[3]??""),scene:String(r[4]??"")})));
    // 新增自定义项
    if(has("certsCustom")) setCertsCustom(splitList(m.certsCustom));
    if(has("sourcesCustom")) setSourcesCustom(splitList(m.sourcesCustom));
    if(has("vocAspects")) setVocAspects(splitList(m.vocAspects));
    if(has("seasons")&&String(m.seasons).trim()){ const ss=String(m.seasons).split(/[;；]/).map(x=>x.trim()).filter(Boolean).map(x=>{const[a,b]=x.split(":");const[s,e]=(a||"").split("-");return{s:+s||1,e:+e||12,note:(b||"").trim()};}); if(ss.length) setSeasons(ss); }
    if(has("customCosts")&&String(m.customCosts).trim()){ const cc=String(m.customCosts).split(/[;；]/).map(x=>x.trim()).filter(Boolean).map(x=>{const[i,v,u]=x.split(":");return{item:(i||"").trim(),val:(v||"").trim(),unit:(u||"").trim()};}); if(cc.length) setCustomCosts(cc); }
    if(has("alphaDims")&&String(m.alphaDims).trim()){ const ad=String(m.alphaDims).split(/[;；]/).map(x=>x.trim()).filter(Boolean).map(x=>{const p=x.split(":");return{name:(p[0]||"").trim(),weight:(p[1]||"").trim(),level:(p[2]||"").trim(),evid:(p[3]||"").trim()};}); if(ad.length) setAlphaDims(ad); }
    const nt={...thr}; ["gradeA","gradeB","gradeC","minMargin","maxWall","betCap","ruinCap"].forEach(k=>{ if(has("thr."+k)) nt[k]=+m["thr."+k]||0; }); setThr(nt);
    const nx={...xcaps}; ["review_wall","growth","star_wall","net_margin"].forEach(k=>{ if(has("xcap."+k)) nx[k]=+m["xcap."+k]||0; }); setXcaps(nx);
  }
  async function onFile(e){
    const f=e.target.files&&e.target.files[0]; if(!f) return;
    if(ioInFlightRef.current){e.target.value="";return;}
    ioInFlightRef.current=true;
    setIoBusy("import");
    setIoFeedback({tone:"",message:""});
    try{
      const fd=new FormData(); fd.append("file",f,f.name);
      const res=await fetch(apiUrl("/api/brief/import"),{method:"POST",headers:{Authorization:"Bearer "+token},body:fd});
      if(!res.ok){ const t=await res.json().catch(()=>({})); throw new Error(t.detail||("导入失败("+res.status+")")); }
      applyImport(await res.json());
      setIoFeedback({tone:"success",message:"已从表格导入并回填研究简报，可继续微调后生成。"});
    }catch(err){
      setIoFeedback({tone:"error",message:`导入失败：${err.message||"请检查文件后重试"}`});
    }
    ioInFlightRef.current=false;
    setIoBusy(""); e.target.value="";
  }

  async function onKeepaMoreFile(e){
    const f=e.target.files&&e.target.files[0]; if(!f) return;
    if(ioInFlightRef.current){e.target.value="";return;}
    ioInFlightRef.current=true;
    setIoBusy("keepamore");
    setIoFeedback({tone:"",message:""});
    try{
      const fd=new FormData();
      fd.append("file",f,f.name);
      fd.append("category",KEEPAMORE_CAT_BED_SAMPLE.category);
      fd.append("marketplace",KEEPAMORE_CAT_BED_SAMPLE.marketplace);
      fd.append("currency",KEEPAMORE_CAT_BED_SAMPLE.currency);
      const res=await fetch(apiUrl("/api/keepamore/import"),{
        method:"POST",
        headers:{Authorization:"Bearer "+token,"Idempotency-Key":crypto.randomUUID()},
        body:fd,
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(body.detail||("导入失败("+res.status+")"));
      setIoFeedback({tone:"success",message:`猫窝示例已导入 ${body.import_summary?.accepted||0} 条商品证据，正在打开报告。`});
      submittedRef.current=true;
      sessionStorage.removeItem(draftKey);
      go("#/run/"+body.id);
    }catch(err){
      setIoFeedback({tone:"error",message:`猫窝示例导入失败：${err.message||"请检查 KeepaMore 导出文件后重试"}`});
    }
    ioInFlightRef.current=false;
    setIoBusy(""); e.target.value="";
  }

  async function submit(){
    if(submitInFlightRef.current)return;
    setSubmitError("");
    if(!readiness.ready){
      const first=readiness.blockers[0];
      setRevealedIssues(new Set(readiness.blockers.map(item=>item.id)));
      setSubmitError(`启动前请修正：${readiness.blockers.map(item=>item.label).join("、")}`);
      if(first)scrollToStep(first.step,first.id);
      return;
    }
    submitInFlightRef.current=true;
    setBusy(true);
    const payload = mode==="asin_list"?readiness.normalizedAsins:kw.trim();
    try{
      const run = await api("/runs",{method:"POST",body:{ mode, payload, marketplace:mkts[0]||"US",
        data_scope:scope, view_profile:views[0]||"P1",
        brief:{ sellerType, profile,
          margin:profile.targetMargin, spapi:!!profile.spApiAuth,
          goals,exclude:excl,priceRange:[pmin,pmax],priceSegments:bands,
          marketplaces:mkts,haz,certs:[...certs,...certsCustom],season:[seasS,seasE],seasons,
          sources,sourcesCustom,dataWindow:win,confidenceGate:gate,
          strictness:strict,weights,views, competitors:comps, cost, customCosts,
          thresholds:thr, xcaps, alphaDims, vocAspects } },
        idempotencyKey:crypto.randomUUID() });
      submittedRef.current=true;
      sessionStorage.removeItem(draftKey);
      go("#/run/"+run.id);
    }catch(e){
      submitInFlightRef.current=false;
      setSubmitError(e.message||"研究计划创建失败，请稍后重试");
      setBusy(false);
      requestAnimationFrame(()=>submitErrorRef.current?.focus());
    }
  }

  const draftStatusText={
    restored:"已恢复草稿",
    saving:"正在保存草稿…",
    saved:"草稿已保存",
    error:"草稿保存失败，请保持页面打开并稍后重试",
  }[draftStatus];

  return html`<div class="newwrap">
    <div class="newhero"><span class="brief-kicker">选品研究 · 启动配置</span><h1>新建选品研究简报</h1>
      <p>先定义公司能力、财务红线和证据门槛，再启动研究。未填写的数据会保留为待补证，不会由系统自动造数。</p>
      <div class=${`brief-boundary brief-capability ${deliveryCapability.tone}`}>
        <span>本次可交付等级</span><b>${deliveryCapability.level}</b>
        <span>${deliveryCapability.detail}</span>
        <small>数据范围：${scope==="private_only"?"仅私域":"公共数据可用"} · 请求来源：${requestedSourceLabels.length?requestedSourceLabels.join("、"):"未选择"}</small>
      </div></div>
    <div class="briefio">
      <button class="bio-btn" type="button" disabled=${!!ioBusy} aria-busy=${ioBusy==="export"} onClick=${exportBrief}>
        ${ioBusy==="export"?"⏳ 生成中…":"⭳ 导出输入模板 (Excel)"}</button>
      <button class="bio-btn ghost" type="button" disabled=${!!ioBusy} aria-busy=${ioBusy==="import"} onClick=${()=>fileRef.current&&fileRef.current.click()}>
        ${ioBusy==="import"?"⏳ 导入中…":"⭱ 导入已填表格"}</button>
      <input ref=${fileRef} type="file" accept=".xlsx" style="display:none" onChange=${onFile}/>
      <button class="bio-btn ghost" type="button" disabled=${!!ioBusy} aria-busy=${ioBusy==="keepamore"} aria-describedby="keepamore-sample-note" onClick=${()=>keepaMoreFileRef.current&&keepaMoreFileRef.current.click()}>
        ${ioBusy==="keepamore"?"⏳ 校验猫窝示例…":"⭱ 导入猫窝示例数据"}</button>
      <input ref=${keepaMoreFileRef} type="file" accept=".csv,.xlsx" style="display:none" onChange=${onKeepaMoreFile}/>
      <span class="bio-hint" id="keepamore-sample-note">独立示例入口：仅用于导入已准备的 KeepaMore 免费版美国站猫窝样本，不代表其他品类或站点已经接入数据。</span>
      ${ioFeedback.message?html`<span class=${`bio-hint brief-io-feedback ${ioFeedback.tone}`} role=${ioFeedback.tone==="error"?"alert":"status"} aria-live=${ioFeedback.tone==="error"?"assertive":"polite"}>${ioFeedback.message}</span>`:""}
    </div>
    <div class=${"brief-readiness"+(readiness.ready?" ready":"")}>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">启动准备度：${readiness.ready?"可以生成研究计划":`还需修正 ${readiness.blockers.length} 项`}，已完成 ${readiness.completed} / ${readiness.total}</span>
      <div class="brief-readiness-head">
        <div><span>启动准备度</span><b>${readiness.ready?"可以生成研究计划":`还需修正 ${readiness.blockers.length} 项`}</b></div>
        <strong>${readiness.completed}<small> / ${readiness.total}</small></strong>
      </div>
      <div class="brief-checks">${readiness.checks.map(item=>html`
        <button type="button" class=${item.ready?"is-ready":"is-blocked"} onClick=${()=>inspectCheck(item)} title=${item.detail} aria-label=${`${item.label}：${item.ready?"已完成":"需修正"}，${item.detail}`}>
          <i>${item.ready?"✓":"·"}</i><span><b>${item.label}</b><small>${item.detail}</small></span>
        </button>`)}</div>
      <div class="brief-readiness-foot">
        <div class="brief-advisories">
          <span class=${economics.complete?"ok":"pending"}>单位经济 ${economics.complete?"已完整":"待补成本"}</span>
          <span class=${requestedSourceCount?"ok":"pending"}>请求数据源 ${requestedSourceCount} 个</span>
          <span class=${comps.length?"ok":"pending"}>种子竞品 ${comps.length} 个</span>
        </div>
        <div class="brief-draft-state">
          <span role=${draftStatus==="error"?"alert":"status"} aria-live="polite">${draftStatusText}${draftSavedAt&&draftStatus!=="saving"?` · ${new Date(draftSavedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:""}</span>
          ${clearDraftPending?html`<span role="group" aria-label="确认清空草稿" onKeyDown=${event=>{if(event.key==="Escape"){event.preventDefault();cancelClearDraft();}}}><span>清空后将重置本页。</span> <button ref=${clearDraftConfirmRef} type="button" onClick=${clearDraft}>确认清空</button> <button type="button" onClick=${cancelClearDraft}>取消</button></span>`
            :html`<button ref=${clearDraftTriggerRef} type="button" onClick=${requestClearDraft}>清空草稿</button>`}
        </div>
      </div>
      <button class="btn brief-rail-submit" type="button" disabled=${busy} aria-busy=${busy} onClick=${submit}>${busy?"生成研究计划…":readiness.ready?"生成研究计划 →":`检查 ${readiness.blockers.length} 项后生成`}</button>
    </div>
    <div class="formcard">
      <div class="brief-step-legend" aria-label="步骤类型说明"><span><b>启动必填</b> 未完成会阻止生成研究计划</span><span><b>高级可选</b> 用于提高结论针对性，不影响启动</span></div>

      ${Bsec("1","企业能力画像","补充业务基础，让建议更贴合真实经营能力", html`
        <label>卖家类型</label>
        <div class="mkts">${[["factory","🏭 工厂型"],["brand","💎 品牌方"],["reseller","📦 铺货型"]].map(([v,l])=>
          html`<button type="button" class=${"mktbtn"+(sellerType===v?" on":"")} aria-pressed=${sellerType===v} aria-label=${`卖家类型：${l}`} onClick=${()=>pickType(v)}>${l}</button>`)}</div>
        <div class="typehint">🎯 ${SELLER.emphasis[sellerType]}</div>
        <div class="fldgrid">
          ${[...SELLER.common, ...SELLER.blocks[sellerType]].map(f=>
            html`<${Field} f=${f} value=${profile[f.id]} onChange=${v=>setPf(f.id,v)}/>`)}
        </div>`,openSteps.has("1"),open=>setStepOpen("1",open),stepPresentation["1"])}

      ${Bsec("2","研究目标","至少选择一个本次研究需要回答的业务问题", html`
        <div class="chips2" data-brief-field="goals" role="group" aria-label="研究目标" aria-invalid=${issueVisible("goals")} aria-describedby=${issueVisible("goals")?issueId("goals"):undefined}>${[["entry","进入决策"],["redesign","存量改款"],["teardown","竞品拆解"],["pricing","定价"],["gtm","上市策略"]].map(([v,l])=>
          html`<button type="button" class=${"chip2"+(goals.includes(v)?" on":"")} aria-pressed=${goals.includes(v)} aria-label=${`研究目标：${l}`} onClick=${()=>multiToggle(goals,setGoals,v)}>${l}</button>`)}</div>${fieldIssue("goals")}`,openSteps.has("2"),open=>setStepOpen("2",open),stepPresentation["2"])}

      ${Bsec("3","品类与研究范围","明确研究对象、主站点、价格带与细分赛道", html`
        <div class="seg"><button type="button" class=${mode==="category_keyword"?"on":""} aria-pressed=${mode==="category_keyword"} aria-label="研究模式：品类词" onClick=${()=>setMode("category_keyword")}>🔍 品类词</button>
          <button type="button" class=${mode==="asin_list"?"on":""} aria-pressed=${mode==="asin_list"} aria-label="研究模式：竞品清单" onClick=${()=>setMode("asin_list")}># 竞品清单</button></div>
        ${mode==="category_keyword"?html`<label for="brief-keyword">品类关键词</label><input id="brief-keyword" data-brief-field="subject" minlength="2" maxlength="160" value=${kw} aria-invalid=${issueVisible("subject")} aria-describedby=${issueVisible("subject")?issueId("subject"):undefined} onInput=${e=>setKw(e.target.value)}/>
          <div class="exchips">${EXAMPLES.map(([l,v])=>html`<button type="button" class="exchip" aria-pressed=${kw.trim()===v} aria-label=${`使用示例品类词：${l}`} onClick=${()=>setKw(v)}>${l}</button>`)}</div>`
          :html`<label for="brief-asins">竞品 ASIN</label><${Pills} value=${asins} onChange=${setAsins} placeholder="B0XXXXXXX" label="竞品 ASIN" inputId="brief-asins" fieldId="subject" invalid=${issueVisible("subject")} describedBy=${issueVisible("subject")?issueId("subject"):undefined}/>`}
        ${fieldIssue("subject")}
        <div class="row" data-brief-field="price"><div><label for="brief-price-min">价格带下限 $</label><input id="brief-price-min" type="number" min="0" value=${pmin} aria-invalid=${issueVisible("price")} aria-describedby=${issueVisible("price")?issueId("price"):undefined} onInput=${e=>setPmin(+e.target.value)}/></div>
          <div><label for="brief-price-max">价格带上限 $</label><input id="brief-price-max" type="number" min="0" value=${pmax} aria-invalid=${issueVisible("price")} aria-describedby=${issueVisible("price")?issueId("price"):undefined} onInput=${e=>setPmax(+e.target.value)}/></div></div>
        ${fieldIssue("price")}
        <label>细分赛道切分（可自定义 · 价格×特征×场景 · 可增删行）</label>
        <div class="bandsplit"><span>按价格均分:</span>${[3,4,5,6].map(n=>html`<button type="button" class="bsbtn" onClick=${()=>splitBands(n)}>${n} 档</button>`)}
          <span class="bandhint">每个赛道将分别评估市场机会、企业适配度与预期收益，并进入评价等级矩阵</span></div>
        <div data-brief-field="segments"><${EditableTable} rows=${bands} onChange=${setBands} addLabel="添加细分赛道" invalid=${issueVisible("segments")} describedBy=${issueVisible("segments")?issueId("segments"):undefined}
          columns=${[{key:"name",label:"赛道名",ph:"如 仿实木高端"},{key:"lo",label:"下限$",type:"number",ph:"90"},{key:"hi",label:"上限$",type:"number",ph:"120"},{key:"feat",label:"关键特征/风格",ph:"压木纹/美式做旧"},{key:"scene",label:"场景/人群",ph:"主卧/farmhouse"}]}/></div>
        ${fieldIssue("segments")}
        <label>站点范围（第一个为主分析站点，其余仅作扩展观察）</label>
        <div class="mkts" data-brief-field="market" role="group" aria-label="站点范围" aria-invalid=${issueVisible("market")} aria-describedby=${issueVisible("market")?issueId("market"):undefined}>${MARKETS.map(([m,f])=>html`<button type="button" class=${"mktbtn"+(mkts.includes(m)?" on":"")} aria-pressed=${mkts.includes(m)} aria-label=${`站点：${m}`} onClick=${()=>multiToggle(mkts,setMkts,m)}>${f} ${m}</button>`)}</div>
        ${fieldIssue("market")}
        <div class="source-contract"><b>主分析站点：${mkts[0]||"未选择"}</b><span>当前版本不会把多选站点误报为逐站完成的定量研究。</span></div>
        <label for="brief-excluded-brands">排除品牌</label><${Pills} value=${excl} onChange=${setExcl} placeholder="如 Coleman" label="排除品牌" inputId="brief-excluded-brands"/>
        <label>竞品明细表（多维数据 · 可增删行）</label>
        <${EditableTable} rows=${comps} onChange=${setComps} addLabel="添加竞品"
          columns=${[{key:"asin",label:"竞品ASIN",ph:"B0..."},{key:"price",label:"售价$",type:"number"},{key:"sold",label:"预估月销",type:"number"},{key:"usp",label:"主打卖点"},{key:"note",label:"备注"}]}/>
        <label>成本结构与单位经济（预估 · 实时算 · 关税可拆）</label>
        <div class="costgrid">
          ${[["fob","FOB出厂价$"],["freight","头程/件$"],["dutyBase","关税MFN%"],["duty301","+301%"],["duty232","+232%"],["fba","FBA费$"],["acos","目标ACOS%"],["price","拟定售价$"]].map(([k,lb])=>
            html`<div class="costcell"><span>${lb}</span><input type="number" value=${cost[k]??(k==="dutyBase"?cost.duty:"")} onInput=${e=>setCost({...cost,[k]:+e.target.value})}/></div>`)}
        </div>
        <div class=${"costout"+(economics.complete?"":" incomplete")}>${economics.complete?html`
          到岸成本 <b>$${landed}</b> ｜ 综合关税 ${dutyRate}%（$${dutyAmt}） ｜ 佣金 $${referral} ｜ 广告 $${ad} ｜ 预估单位净利 <b class=${net>0?"pos":"neg"}>$${net}（${netPct}%）</b>`:html`
          <b>单位经济待补全</b><span>请填写 FOB、头程、FBA、目标 ACOS 与拟定售价；综合关税会按 MFN + 301 + 232 计算。</span>`}</div>
        <label>自定义成本项（退货/仓储/汇率/VAT/EPR/破损/尾程… 可增删）</label>
        <${EditableTable} rows=${customCosts} onChange=${setCustomCosts} addLabel="添加成本项"
          columns=${[{key:"item",label:"成本项",ph:"如 退货率/仓储/VAT"},{key:"val",label:"数值",type:"number",ph:"5"},{key:"unit",label:"单位",ph:"% 或 $"}]}/>` ,openSteps.has("3"),open=>setStepOpen("3",open),stepPresentation["3"])}

      ${Bsec("4","约束与合规","补充运输限制、认证要求与季节波动", html`
        <div class="mkts">${[["battery","🔋 带电/含磁"],["liquid","💧 液体/易燃"],["fda","🧴 化妆品FDA"],["dimweight","📦 抛重敏感"]].map(([k,l])=>
          html`<button type="button" class=${"mktbtn"+(haz[k]?" on":"")} aria-pressed=${haz[k]} aria-label=${`约束项：${l}`} onClick=${()=>toggle(haz,setHaz,k)}>${l}</button>`)}</div>
        <label>所需认证/法规（点选常见 + 下方自定义增补）</label><div class="chips2">${["CPC","UL","CE","FDA","MSDS","FCC","CARB","TB117","Prop65","ASTM","RoHS","REACH","GPSR","EPR"].map(c=>
          html`<button type="button" class=${"chip2"+(certs.includes(c)?" on":"")} aria-pressed=${certs.includes(c)} aria-label=${`认证或法规：${c}`} onClick=${()=>multiToggle(certs,setCerts,c)}>${c}</button>`)}</div>
        <${Pills} value=${certsCustom} onChange=${setCertsCustom} placeholder="自定义认证/法规（回车添加，如 CA65/FIRA/BIFMA）" label="自定义认证或法规" inputId="brief-custom-certs"/>
        <label>季节性峰段（多峰 · 可增删行）</label>
        <${EditableTable} rows=${seasons} onChange=${setSeasons} addLabel="添加峰段"
          columns=${[{key:"s",label:"起始月",type:"number",ph:"5"},{key:"e",label:"结束月",type:"number",ph:"8"},{key:"note",label:"说明",ph:"如 换季/开学/节庆"}]}/>` ,openSteps.has("4"),open=>setStepOpen("4",open),stepPresentation["4"])}

      ${Bsec("5","数据与证据规则","选择请求来源，并设定证据窗口与审阅标准", html`
        <label>本次请求的数据源（选择不等于已连接或已使用）</label>
        <div class="mkts">${SOURCE_OPTIONS.map(([k,l])=>
          html`<button type="button" class=${"mktbtn"+(sources[k]?" on":"")} aria-pressed=${sources[k]} aria-label=${`请求数据源：${l}`} onClick=${()=>toggle(sources,setSources,k)}>${sources[k]?"✓ ":""}${l}</button>`)}</div>
        <div class="source-contract"><b>运行前校验</b><span>系统会显示可用、缺失与未验证状态；未实际参与本次运行的数据源不会写成“已接入”。</span></div>
        <${Pills} value=${sourcesCustom} onChange=${setSourcesCustom} placeholder="自定义数据源（回车添加，如 卖家精灵/JungleScout/BrightData/自有BI）" label="自定义数据源" inputId="brief-custom-sources"/>
        <div class="row">
          <div><label>数据窗口</label><div class="seg">${[30,60,90,180].map(d=>html`<button type="button" class=${win===d?"on":""} aria-pressed=${win===d} aria-label=${`数据窗口：${d}天`} onClick=${()=>setWin(d)}>${d}天</button>`)}</div></div></div>
        <div class="row">
          <div><label>置信度门槛（决定低置信度来源是否进入定量排序）</label><div class="seg">${[["Low","宽松"],["Medium","平衡"],["High","严格"]].map(([value,label])=>html`<button type="button" class=${gate===value?"on":""} aria-pressed=${gate===value} aria-label=${`置信度门槛：${label}`} onClick=${()=>setGate(value)}>${label}</button>`)}</div></div></div>
        <div class="row">
          <div><label>人工终审严格度</label><div class="seg">${[["light","轻"],["standard","标准"],["strict","严格"]].map(([v,l])=>html`<button type="button" class=${strict===v?"on":""} aria-pressed=${strict===v} aria-label=${`人工终审严格度：${l}`} onClick=${()=>setStrict(v)}>${l}</button>`)}</div></div>
          <div><label>数据范围</label><div class="seg">${[["public_ok","公共数据可用"],["private_only","仅私域（需已接入）"]].map(([v,l])=>html`<button type="button" class=${scope===v?"on":""} aria-pressed=${scope===v} aria-label=${`数据范围：${l}`} onClick=${()=>setScope(v)}>${l}</button>`)}</div></div></div>`,openSteps.has("5"),open=>setStepOpen("5",open),stepPresentation["5"])}

      ${Bsec("6","机会评分权重","选择预设或调整五项业务判断的相对权重", html`
        <div class="mkts">${Object.keys(PRESETS).map(p=>html`<button type="button" class="mktbtn" aria-label=${`应用${({standard:"标品",seasonal:"季节品",gift:"礼品",durable:"耐用品"})[p]}权重预设`} onClick=${()=>setWeights(PRESETS[p])}>${({standard:"标品",seasonal:"季节品",gift:"礼品",durable:"耐用品"})[p]}</button>`)}</div>
        ${weights.map((w,i)=>html`<div class="weightrow"><span class="wl">${WNAMES[i]}</span>
          <input type="range" min="0" max="50" value=${Math.round(w*100)} data-brief-field=${i===0?"weights":undefined} aria-label=${`机会分权重：${WNAMES[i]}`} aria-valuetext=${`${Math.round(w*100)}%`} aria-invalid=${issueVisible("weights")} aria-describedby=${issueVisible("weights")?issueId("weights"):undefined} onInput=${e=>setW(i,+e.target.value)}/>
          <span class="wv">${Math.round(w/wsum*100)}%</span></div>`)}
        <div class="note">最终占比合计 100%（当前输入合计 ${Math.round(wsum*100)}%，系统会自动换算）</div>${fieldIssue("weights")}`,openSteps.has("6"),open=>setStepOpen("6",open),stepPresentation["6"])}

      ${Bsec("7","交付偏好","选择报告面向的角色与呈现方式", html`
        <div class="chips2" data-brief-field="delivery" role="group" aria-label="交付视图" aria-invalid=${issueVisible("delivery")} aria-describedby=${issueVisible("delivery")?issueId("delivery"):undefined}>${[["P1","选品决策版"],["P4","机构白标版"]].map(([v,l])=>
          html`<button type="button" class=${"chip2"+(views.includes(v)?" on":"")} aria-pressed=${views.includes(v)} aria-label=${`交付视图：${l}`} onClick=${()=>multiToggle(views,setViews,v)}>${l}</button>`)}</div>${fieldIssue("delivery")}`,openSteps.has("7"),open=>setStepOpen("7",open),stepPresentation["7"])}

      <div class="advsec">
        <button class="advtoggle" type="button" aria-expanded=${advOpen} aria-controls="brief-advanced-panel" onClick=${()=>setAdvOpen(o=>!o)}>${advOpen?"▾":"▸"} 高级自定义（决策阈值 · 评分口径 · 企业能力 · 消费者反馈）</button>
        ${advOpen?html`<div class="advbody" id="brief-advanced-panel" role="region" aria-label="高级自定义">
          <label>决策阈值 / 风险偏好（不同风险偏好各设各的）</label>
          <div class="costgrid">
            ${[["gradeA","A级阈值"],["gradeB","B级阈值"],["gradeC","C级阈值"],["minMargin","最低净利率%"],["maxWall","最大头部评论墙"],["betCap","单赛道下注上限%"],["ruinCap","破产概率阈值%"]].map(([k,lb])=>
              html`<div class="costcell"><span>${lb}</span><input type="number" value=${thr[k]} onInput=${e=>setThr({...thr,[k]:+e.target.value})}/></div>`)}
          </div>
          <label>评分上限标定（按品类分位设置，小件与家具使用不同的评论基线）</label>
          <div class="costgrid">
            ${[["review_wall","评论数量上限"],["growth","增长率上限%"],["star_wall","星级上限"],["net_margin","净利率上限%"]].map(([k,lb])=>
              html`<div class="costcell"><span>${lb}</span><input type="number" value=${xcaps[k]} onInput=${e=>setXcaps({...xcaps,[k]:+e.target.value})}/></div>`)}
          </div>
          <label>企业能力适配维度（记录自身优势与可验证依据，可增删）</label>
          <${EditableTable} rows=${alphaDims} onChange=${setAlphaDims} addLabel="添加能力维"
            columns=${[{key:"name",label:"能力维度",ph:"如 美式涂装工艺"},{key:"weight",label:"权重%",type:"number",ph:"25"},{key:"level",label:"当前水平",ph:"强/中/弱"},{key:"evid",label:"验证依据",ph:"合同/报价/历史/无"}]}/>
          <label>重点关注的消费者反馈主题</label>
          <${Pills} value=${vocAspects} onChange=${setVocAspects} placeholder="如 抽屉滑轨/封边/涂装/异味/尺寸（回车添加）" label="消费者反馈主题" inputId="brief-voc-aspects"/>
        </div>`:""}
      </div>
      ${submitError?html`<div ref=${submitErrorRef} class="brief-submit-error" role="alert" aria-atomic="true" tabindex="-1"><b>研究计划尚未创建</b><span>${submitError}</span></div>`:""}
      <div class="cta" aria-busy=${busy}><button class="btn lg" type="button" disabled=${busy} aria-busy=${busy} aria-describedby="brief-submit-note" onClick=${submit}>${busy?"生成研究计划…":readiness.ready?"生成研究计划 →":`检查 ${readiness.blockers.length} 项后生成`}</button>
        <span class="note" id="brief-submit-note">下一步可在运行前校验中编辑研究范围并确认数据边界；未确认不会执行。</span></div>
      <div class="demoflag">可信度规则：缺少真实来源、成本或私域连接时，系统只能交付框架演示，不能输出可签核的进入或暂缓结论。</div>
    </div>
  </div>`;
}
