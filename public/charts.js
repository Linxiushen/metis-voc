// 高端内联 SVG 图表库（渐变 · 自定义浮层 tooltip · 悬停 · 阴影）—— 供 report10x 使用
import htm, { h } from "./vendor/metis-vendor.js";
const html = htm.bind(h);

// CSS-variable-backed neutrals keep inline SVG labels readable on screen and
// let the print stylesheet switch the same charts back to a light-paper palette.
export const PAL = { accent:"#10a37f", ind2:"#3b82f6", high:"#10a37f", med:"#d97706",
  low:"#ef4444", star:"#d97706", teal:"#0e8c6d", pink:"#db2777", cyan:"#0891b2",
  slate:"#7f8fa3",
  line:"var(--chart-line,#575751)", line2:"var(--chart-line2,#41413d)",
  ink:"var(--chart-ink,#e5e5df)", muted:"var(--chart-muted,#b6b6af)",
  faint:"var(--chart-faint,#979790)", point:"var(--chart-point,#292928)" };
export const SER = ["#10a37f","#2563eb","#64748b","#d97706","#0891b2","#7c3aed","#ef4444"];
const usd = (n)=> (Math.abs(n)>=1e6?`$${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${n}`);
const num = (n)=> (typeof n==="number"? n.toLocaleString():n);
export const fmt = { usd, num, pct:(n)=>`${Math.round(n*100)}%`, k:(n)=>n>=1e3?`${(n/1e3).toFixed(1)}k`:n };
const P = (cx,cy,r,deg)=>{const a=(deg-90)*Math.PI/180;return [cx+r*Math.cos(a), cy+r*Math.sin(a)];};
let _g=0; const uid=()=>"cg"+(++_g);
// 竖向渐变（顶部浓→底部淡）
function VGrad(id,color,o1=1,o2=0.5){return html`<linearGradient id=${id} x1="0" x2="0" y1="0" y2="1">
  <stop offset="0%" stop-color=${color} stop-opacity=${o1}/><stop offset="100%" stop-color=${color} stop-opacity=${o2}/></linearGradient>`;}

// 全局自定义 tooltip（一次挂载，事件委托读取 data-tip）
export function mountTooltip(){
  if (window.__chartTip) return;
  const tip=document.createElement("div"); tip.className="chart-tip"; tip.style.display="none";
  document.body.appendChild(tip); window.__chartTip=tip;
  document.addEventListener("mouseover",e=>{const el=e.target.closest&&e.target.closest("[data-tip]");
    if(el){tip.textContent=String(el.getAttribute("data-tip")||"").replace(/<[^>]*>/g,"");tip.style.display="block";}});
  document.addEventListener("mousemove",e=>{if(tip.style.display==="block"){
    let x=e.clientX+14,y=e.clientY+14; if(x+220>innerWidth)x=e.clientX-220; tip.style.left=x+"px";tip.style.top=y+"px";}});
  document.addEventListener("mouseout",e=>{const el=e.target.closest&&e.target.closest("[data-tip]"); if(el)tip.style.display="none";});
}

// ---- Gauge ----
export function Gauge({ value, max=100, label, sub, color, size=132 }) {
  const r=(size-24)/2, c=2*Math.PI*r, pct=Math.max(0,Math.min(1,value/max));
  const col = color || (pct>=0.7?PAL.high:pct>=0.45?PAL.star:PAL.low);
  return html`<div class="donut gsvg" style=${`width:${size}px;height:${size}px`}>
    <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`}>
      <circle cx=${size/2} cy=${size/2} r=${r} fill="none" stroke=${PAL.line2} stroke-width="12"/>
      <circle class="mk" cx=${size/2} cy=${size/2} r=${r} fill="none" stroke=${col} stroke-width="12" stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c*(1-pct)} transform=${`rotate(-90 ${size/2} ${size/2})`} data-tip=${`${label||""}: <b>${value}</b>`}/>
    </svg><div class="lbl"><b>${typeof value==="number"&&value%1?value.toFixed(1):value}</b><span>${label||""}</span></div>
    ${sub?html`<div style="text-align:center;font-size:11px;color:var(--muted);margin-top:2px">${sub}</div>`:""}</div>`;
}

// ---- Radar ----
export function Radar({ axes, series, max=1, size=260 }) {
  const cx=size/2, cy=size/2+6, R=size/2-46, n=axes.length, rings=[.25,.5,.75,1];
  const ids=series.map(()=>uid());
  return html`<svg width=${size} height=${size+8} viewBox=${`0 0 ${size} ${size+8}`} style="max-width:100%">
    <defs>${series.map((s,i)=>VGrad(ids[i],s.color||SER[i%SER.length],0.28,0.05))}</defs>
    ${rings.map(g=>html`<polygon points=${axes.map((_,i)=>P(cx,cy,R*g,i*360/n).join(",")).join(" ")} fill="none" stroke=${PAL.line} stroke-width="1"/>`)}
    ${axes.map((ax,i)=>{const [x,y]=P(cx,cy,R,i*360/n),[lx,ly]=P(cx,cy,R+22,i*360/n);
      return html`<g><line x1=${cx} y1=${cy} x2=${x} y2=${y} stroke=${PAL.line}/>
        <text x=${lx} y=${ly} font-size="10.5" fill=${PAL.muted} text-anchor="middle" dominant-baseline="middle">${ax}</text></g>`;})}
    ${series.map((s,si)=>{const col=s.color||SER[si%SER.length];
      const pts=s.scores.map((v,i)=>P(cx,cy,R*Math.max(0,Math.min(1,v/max)),i*360/n).join(",")).join(" ");
      return html`<g><polygon points=${pts} fill=${`url(#${ids[si]})`} stroke=${col} stroke-width="2"/>
        ${s.scores.map((v,i)=>{const[x,y]=P(cx,cy,R*Math.max(0,Math.min(1,v/max)),i*360/n);
          return html`<circle class="mk" cx=${x} cy=${y} r="3" fill=${col} data-tip=${`${axes[i]} · ${s.name}: <b>${v}</b>`}/>`;})}</g>`;})}
    ${series.length>1?html`<g>${series.map((s,si)=>html`<g><rect x=${10} y=${10+si*16} width="10" height="10" rx="2" fill=${s.color||SER[si%SER.length]}/>
      <text x=${24} y=${19+si*16} font-size="10.5" fill=${PAL.ink}>${s.name}</text></g>`)}</g>`:""}
  </svg>`;
}

// ---- Horizontal bars ----
export function BarsH({ items, max, unit="", color, height=26, fmtVal, target }) {
  const mx = max || Math.max(...items.map(i=>Math.abs(i.value)))*1.05 || 1;
  return html`<div class="hbars">${items.map((it,idx)=>{
    const col = it.color || color || SER[idx%SER.length];
    const w = Math.max(1, Math.abs(it.value)/mx*100);
    return html`<div class="hbar" style=${`height:${height}px`} data-tip=${`${it.label}: <b>${fmtVal?fmtVal(it.value):it.value}${unit}</b>${it.sub?" · "+it.sub:""}`}>
      <div class="hbl">${it.label}</div>
      <div class="hbt"><div class="hbf" style=${`width:${w}%;background:linear-gradient(90deg,${col},${col}b0)`}></div>${target!=null?html`<div class="hbt-line" style=${`left:${target/mx*100}%`}></div>`:""}</div>
      <div class="hbv">${fmtVal?fmtVal(it.value):it.value}${unit}${it.sub?html`<span class="hbs"> ${it.sub}</span>`:""}</div>
    </div>`;})}</div>`;
}

// ---- Line ----
export function Line({ labels, series, w=520, h=190, min, max, area=false, yfmt, unit="", threshold }) {
  const pad={l:42,r:14,t:16,b:28}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const all=series.flatMap(s=>s.points).concat(threshold?[threshold.value]:[]);
  const mn = min!=null?min:Math.min(...all), mx = max!=null?max:Math.max(...all);
  const X=(i)=>pad.l+ (labels.length<2?iw/2:i/(labels.length-1)*iw), Y=(v)=>pad.t+ ih-(v-mn)/((mx-mn)||1)*ih;
  const yv=(g)=>{const val=mn+(mx-mn)*g; return yfmt?yfmt(val):(Math.abs(val)>=1000?fmt.num(Math.round(val)):Math.round(val*10)/10);};
  const ids=series.map(()=>uid());
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    <defs>${series.map((s,i)=>VGrad(ids[i],s.color||SER[i%SER.length],0.22,0.02))}</defs>
    ${[0,.25,.5,.75,1].map(g=>{const y=pad.t+ih*(1-g);return html`<g><line x1=${pad.l} y1=${y} x2=${w-pad.r} y2=${y} stroke=${g===0?PAL.line:PAL.line2}/>
      <text x=${pad.l-6} y=${y+3} font-size="9.5" fill=${PAL.faint} text-anchor="end">${yv(g)}${unit&&g===1?unit:""}</text></g>`;})}
    ${labels.map((l,i)=> i%Math.ceil(labels.length/9||1)===0 ? html`<text x=${X(i)} y=${h-8} font-size="9" fill=${PAL.muted} text-anchor="middle">${l}</text>`:"")}
    ${threshold?html`<g><line x1=${pad.l} y1=${Y(threshold.value)} x2=${w-pad.r} y2=${Y(threshold.value)} stroke=${threshold.color||PAL.low} stroke-width="1.4" stroke-dasharray="5 3"/>
      <text x=${w-pad.r} y=${Y(threshold.value)-4} font-size="9.5" fill=${threshold.color||PAL.low} text-anchor="end">${threshold.label||""}</text></g>`:""}
    ${series.map((s,si)=>{const col=s.color||SER[si%SER.length], d=s.points.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`).join(" ");
      return html`<g>${area?html`<path d=${d+`L${X(s.points.length-1)},${pad.t+ih}L${X(0)},${pad.t+ih}Z`} fill=${`url(#${ids[si]})`}/>`:""}
        <path d=${d} fill="none" stroke=${col} stroke-width="2.4" stroke-linejoin="round"/>
        ${s.points.map((v,i)=>html`<circle class="mk" cx=${X(i)} cy=${Y(v)} r="3" fill=${PAL.point} stroke=${col} stroke-width="2" data-tip=${`${labels[i]}${series.length>1?" · "+s.name:""}: <b>${v}</b>`}/>`)}</g>`;})}
    ${series.length>1?html`<g>${series.map((s,si)=>html`<g><rect x=${pad.l+si*92} y=${2} width="9" height="9" rx="2" fill=${s.color||SER[si%SER.length]}/>
      <text x=${pad.l+si*92+13} y=${10} font-size="9.5" fill=${PAL.ink}>${s.name}</text></g>`)}</g>`:""}
  </svg>`;
}

// ---- Scatter / Bubble ----
export function Scatter({ points, w=520, h=310, xLabel, yLabel, xMax=100, yMax=100, quadrant, quadLabels }) {
  const pad={l:46,r:16,t:16,b:38}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const X=(v)=>pad.l+v/xMax*iw, Y=(v)=>pad.t+ih-v/yMax*ih, rMax=Math.max(...points.map(p=>p.r||0))||1;
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    ${[0,.5,1].map(g=>html`<g><line x1=${X(xMax*g)} y1=${pad.t} x2=${X(xMax*g)} y2=${pad.t+ih} stroke=${PAL.line2}/>
      <text x=${X(xMax*g)} y=${pad.t+ih+13} font-size="9" fill=${PAL.faint} text-anchor="middle">${Math.round(xMax*g)}</text>
      <line x1=${pad.l} y1=${Y(yMax*g)} x2=${w-pad.r} y2=${Y(yMax*g)} stroke=${PAL.line2}/>
      <text x=${pad.l-5} y=${Y(yMax*g)+3} font-size="9" fill=${PAL.faint} text-anchor="end">${Math.round(yMax*g)}</text></g>`)}
    ${quadrant?html`<g><line x1=${X(xMax/2)} y1=${pad.t} x2=${X(xMax/2)} y2=${pad.t+ih} stroke=${PAL.slate} stroke-dasharray="4 3" opacity="0.45"/>
      <line x1=${pad.l} y1=${Y(yMax/2)} x2=${w-pad.r} y2=${Y(yMax/2)} stroke=${PAL.slate} stroke-dasharray="4 3" opacity="0.45"/>
      ${(quadLabels||[]).map((q,i)=>html`<text x=${[X(xMax*0.75),X(xMax*0.25),X(xMax*0.25),X(xMax*0.75)][i]} y=${[Y(yMax*0.92),Y(yMax*0.92),Y(yMax*0.08),Y(yMax*0.08)][i]} font-size="9.5" fill=${PAL.faint} text-anchor="middle">${q}</text>`)}</g>`:""}
    <line x1=${pad.l} y1=${pad.t} x2=${pad.l} y2=${pad.t+ih} stroke=${PAL.line}/>
    <line x1=${pad.l} y1=${pad.t+ih} x2=${w-pad.r} y2=${pad.t+ih} stroke=${PAL.line}/>
    ${points.map((p)=>{const r=p.r?6+ (p.r/rMax)*22:6, col=p.highlight?PAL.accent:(p.color||PAL.slate);
      return html`<g><circle class="mk" cx=${X(p.x)} cy=${Y(p.y)} r=${r} fill=${col} fill-opacity=${p.highlight?0.9:0.5} stroke=${col} stroke-width=${p.highlight?2:1}
        data-tip=${`<b>${p.label||""}</b><br/>${xLabel||"x"}: ${p.x} · ${yLabel||"y"}: ${p.y}${p.r?`<br/>规模: ${p.r}`:""}`}/>
        <text x=${X(p.x)} y=${Y(p.y)-r-3} font-size="9" fill=${PAL.ink} text-anchor="middle">${p.label||""}</text></g>`;})}
    <text x=${pad.l+iw/2} y=${h-3} font-size="10" fill=${PAL.muted} text-anchor="middle">${xLabel||""}</text>
    <text x=${13} y=${pad.t+ih/2} font-size="10" fill=${PAL.muted} text-anchor="middle" transform=${`rotate(-90 13 ${pad.t+ih/2})`}>${yLabel||""}</text>
  </svg>`;
}

// ---- Heatmap ----
export function Heatmap({ xLabels, yLabels, matrix, min=0, max=1, fmtCell, colorFor }) {
  const cw=Math.max(52, Math.min(90, 520/xLabels.length));
  const color = colorFor || ((v)=>{const t=(v-min)/((max-min)||1);
    const r=Math.round(18+t*(240-18)), g=Math.round(183-t*(183-68)), b=Math.round(106-t*(106-56));return `rgb(${r},${g},${b})`;});
  return html`<div style="overflow:auto"><table class="heat"><thead><tr><th></th>${xLabels.map(x=>html`<th>${x}</th>`)}</tr></thead>
    <tbody>${matrix.map((row,ri)=>html`<tr><td class="hy">${yLabels[ri]}</td>
      ${row.map((v,ci)=>html`<td class="hc mk" style=${`background:${color(v)};width:${cw}px`} data-tip=${`${yLabels[ri]} × ${xLabels[ci]}: <b>${fmtCell?fmtCell(v):v}</b>`}>${fmtCell?fmtCell(v):v}</td>`)}</tr>`)}</tbody></table></div>`;
}

// ---- Waterfall ----
export function Waterfall({ items, w=560, h=240, unit="$" }) {
  const pad={l:8,r:8,t:18,b:46}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  let bal=0; const bars=[]; let maxTop=0;
  items.forEach((it)=>{const isTot=it.type==="base"||it.type==="total"; const start=isTot?0:bal, end=isTot?it.amount:bal+it.amount;
    bars.push({...it, start, end, isTot}); bal=end; maxTop=Math.max(maxTop,Math.abs(start),Math.abs(end),Math.abs(it.amount));});
  const mx=maxTop*1.12||1, bw=iw/items.length*0.6, gap=iw/items.length, Y=(v)=>pad.t+ih-(v/mx)*ih;
  const gP=uid(),gN=uid(),gT=uid();
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    <defs>${VGrad(gP,PAL.high,0.95,0.6)}${VGrad(gN,PAL.low,0.95,0.6)}${VGrad(gT,PAL.accent,0.95,0.6)}</defs>
    <line x1=${pad.l} y1=${Y(0)} x2=${w-pad.r} y2=${Y(0)} stroke=${PAL.line}/>
    ${bars.map((b,i)=>{const x=pad.l+i*gap+(gap-bw)/2, top=Y(Math.max(b.start,b.end)), bot=Y(Math.min(b.start,b.end));
      const fill=b.isTot?`url(#${gT})`:(b.amount>=0?`url(#${gP})`:`url(#${gN})`);
      const conn = i<bars.length-1 ? html`<line x1=${x+bw} y1=${Y(b.end)} x2=${pad.l+(i+1)*gap+(gap-bw)/2} y2=${Y(b.end)} stroke=${PAL.faint} stroke-dasharray="3 2"/>` : "";
      return html`<g><rect class="mk" x=${x} y=${top} width=${bw} height=${Math.max(2,bot-top)} rx="3" fill=${fill} data-tip=${`${b.step||b.label}: <b>${b.amount>=0?"+":""}${unit}${b.amount}</b> · 余额 ${unit}${Math.round(b.end)}`}/>
        ${conn}<text x=${x+bw/2} y=${top-4} font-size="9.5" fill=${PAL.ink} text-anchor="middle">${b.amount>=0||b.isTot?"":"−"}${unit}${Math.abs(b.amount)}</text>
        <text x=${x+bw/2} y=${h-30} font-size="8.8" fill=${PAL.muted} text-anchor="middle">${(b.step||b.label||"").slice(0,7)}</text>
        <text x=${x+bw/2} y=${h-18} font-size="8.5" fill=${PAL.faint} text-anchor="middle">${unit}${Math.round(b.end)}</text></g>`;})}
  </svg>`;
}

// ---- Gantt ----
export function Gantt({ rows, maxWeek, w=560 }) {
  const mx=maxWeek||Math.max(...rows.map(r=>r.endWeek||r.end||0)), rowH=34, labelW=96, iw=w-labelW-12, X=(wk)=>labelW+ (wk/mx)*iw;
  return html`<svg viewBox=${`0 0 ${w} ${rows.length*rowH+24}`} width="100%" style="max-width:100%">
    ${Array.from({length:mx+1}).map((_,wk)=> wk%2===0?html`<g><line x1=${X(wk)} y1=${16} x2=${X(wk)} y2=${rows.length*rowH+16} stroke=${PAL.line2}/>
      <text x=${X(wk)} y=${12} font-size="8.5" fill=${PAL.muted} text-anchor="middle">W${wk}</text></g>`:"")}
    ${rows.map((r,i)=>{const s=r.startWeek??r.start, e=r.endWeek??r.end, y=24+i*rowH;
      return html`<g><text x=${4} y=${y+13} font-size="10.5" fill=${PAL.ink}>${r.phase}</text>
        <rect class="mk" x=${X(s)} y=${y+4} width=${Math.max(6,X(e)-X(s))} height="16" rx="5" fill=${SER[i%SER.length]} fill-opacity="0.9" data-tip=${`${r.phase} · W${s}-W${e}<br/>${r.milestone||""}`}/>
        <text x=${X(s)+5} y=${y+16} font-size="9" fill="#fff">${r.milestone||""}</text></g>`;})}
  </svg>`;
}

// ---- Range ----
export function RangeBar({ items }) {
  const mx=Math.max(...items.map(i=>i.p90))*1.05||1;
  return html`<div class="ranges">${items.map(it=>html`<div class="rangerow">
    <div class="rl">${it.metric}${it.unit?` (${it.unit})`:""}</div>
    <div class="rt" data-tip=${`P10 ${it.p10} · <b>P50 ${it.p50}</b> · P90 ${it.p90}`}>
      <div class="rspan" style=${`left:${it.p10/mx*100}%;right:${100-it.p90/mx*100}%`}></div>
      <div class="rp10" style=${`left:${it.p10/mx*100}%`}></div><div class="rp50" style=${`left:${it.p50/mx*100}%`}></div>
      <div class="rp90" style=${`left:${it.p90/mx*100}%`}></div></div>
    <div class="rv">P10 ${it.p10} · <b>P50 ${it.p50}</b> · P90 ${it.p90}</div></div>`)}</div>`;
}

// ---- Tornado ----
export function Tornado({ items, base=0, w=520 }) {
  const mx=Math.max(...items.flatMap(i=>[Math.abs(i.low-base),Math.abs(i.high-base)]))*1.1||1, rowH=30, cx=w/2;
  return html`<svg viewBox=${`0 0 ${w} ${items.length*rowH+20}`} width="100%" style="max-width:100%">
    <line x1=${cx} y1=${10} x2=${cx} y2=${items.length*rowH+10} stroke=${PAL.line}/>
    ${items.map((it,i)=>{const y=14+i*rowH, lo=it.low-base, hi=it.high-base, x1=cx+Math.min(lo,hi)/mx*(w/2-10), x2=cx+Math.max(lo,hi)/mx*(w/2-10);
      return html`<g><rect class="mk" x=${Math.min(x1,cx)} y=${y} width=${Math.abs(cx-x1)} height="18" rx="2" fill=${PAL.low} fill-opacity="0.8" data-tip=${`${it.variable} · 低: ${it.lowLabel||it.low}`}/>
        <rect class="mk" x=${cx} y=${y} width=${Math.abs(x2-cx)} height="18" rx="2" fill=${PAL.high} fill-opacity="0.8" data-tip=${`${it.variable} · 高: ${it.highLabel||it.high}`}/>
        <text x=${8} y=${y+13} font-size="10" fill=${PAL.ink}>${it.variable}</text>
        <text x=${x1-4} y=${y+13} font-size="9" fill=${PAL.muted} text-anchor="end">${it.lowLabel||it.low}</text>
        <text x=${x2+4} y=${y+13} font-size="9" fill=${PAL.muted}>${it.highLabel||it.high}</text></g>`;})}
  </svg>`;
}

// ---- Sparkline ----
export function Spark({ points, w=70, h=22, color=PAL.accent }) {
  const mn=Math.min(...points), mx=Math.max(...points), X=(i)=>i/(points.length-1)*w, Y=(v)=>h-2-(v-mn)/((mx-mn)||1)*(h-4);
  return html`<svg width=${w} height=${h} style="vertical-align:middle" data-tip=${points.join(" · ")}>
    <path d=${points.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`).join(" ")} fill="none" stroke=${color} stroke-width="1.8"/></svg>`;
}

// ---- Donut ----
export function DonutCat({ items, size=140, thick=22 }) {
  const total=items.reduce((s,i)=>s+i.value,0)||1, r=size/2-2, cx=size/2, cy=size/2; let acc=0;
  const segs=items.map((it,idx)=>{const frac=it.value/total, a0=acc*360, a1=(acc+frac)*360; acc+=frac;
    const [x0,y0]=P(cx,cy,r,a0),[x1,y1]=P(cx,cy,r,a1), large=frac>0.5?1:0;
    return {d:`M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`, col:it.color||SER[idx%SER.length], label:it.label, pct:Math.round(frac*100)};});
  return html`<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <svg class="gsvg" width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`}>
      ${segs.map(s=>html`<path class="mk" d=${s.d} fill="none" stroke=${s.col} stroke-width=${thick} stroke-linecap="round" data-tip=${`${s.label}: <b>${s.pct}%</b>`}/>`)}</svg>
    <div>${items.map((it,idx)=>html`<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;margin:3px 0">
      <span style=${`width:10px;height:10px;border-radius:3px;background:${it.color||SER[idx%SER.length]};display:inline-block`}></span>
      ${it.label} <b style="margin-left:auto">${Math.round(it.value/total*100)}%</b></div>`)}</div></div>`;
}

// ---- Funnel ----
export function Funnel({ stages, w=620, unit="" }) {
  const maxC=Math.max(...stages.map(s=>s.in??s.out??0),...stages.map(s=>s.out??0))||1;
  const rowH=62, labelW=158, fW=w-labelW-96, cx=labelW+fW/2, H=stages.length*rowH+12, wOf=(c)=>Math.max(34,(c/maxC)*fW);
  const ids=stages.map(()=>uid());
  return html`<svg viewBox=${`0 0 ${w} ${H}`} width="100%" style="max-width:100%">
    <defs>${stages.map((s,i)=>VGrad(ids[i],SER[i%SER.length],0.95,0.7))}</defs>
    ${stages.map((s,i)=>{const y=8+i*rowH, hh=rowH-14, tw=wOf(s.in??s.out), bw=wOf(s.out);
      const pts=`${cx-tw/2},${y} ${cx+tw/2},${y} ${cx+bw/2},${y+hh} ${cx-bw/2},${y+hh}`;
      const dropped=(s.in??s.out)-s.out, passRate=s.in?Math.round(s.out/s.in*100):100;
      return html`<g>
        <text x=${labelW-12} y=${y+hh/2-2} font-size="12" fill=${PAL.ink} text-anchor="end" font-weight="700">${s.label}</text>
        ${s.threshold?html`<text x=${labelW-12} y=${y+hh/2+12} font-size="9.5" fill=${PAL.muted} text-anchor="end">${s.threshold}</text>`:""}
        <polygon class="mk fseg" points=${pts} fill=${`url(#${ids[i]})`} data-tip=${`${s.criteria||s.label}<br/>进 ${s.in??s.out} → 出 <b>${s.out}</b>${s.actual?"<br/>"+s.actual:""}`}/>
        <text x=${cx} y=${y+hh/2-1} font-size="15" fill="#fff" text-anchor="middle" font-weight="800">${s.out}${unit}</text>
        <text x=${cx} y=${y+hh/2+13} font-size="9" fill="#fff" opacity="0.92" text-anchor="middle">${i===0?"候选":passRate+"% 通过"}</text>
        ${dropped>0?html`<text x=${cx+tw/2+8} y=${y+hh/2+3} font-size="10.5" fill=${PAL.low} font-weight="700">−${dropped}</text>`:""}
        ${i<stages.length-1?html`<line x1=${cx} y1=${y+hh} x2=${cx} y2=${y+rowH-2} stroke=${PAL.faint} stroke-dasharray="2 2"/>`:""}
      </g>`;})}
  </svg>`;
}
