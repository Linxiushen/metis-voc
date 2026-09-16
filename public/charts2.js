// 高级复合图表库（多维/复合/统计图）—— 分析师级
import htm, { h } from "./vendor/metis-vendor.js";
import { PAL, SER, fmt } from "./charts.js";
const html = htm.bind(h);
const P=(cx,cy,r,d)=>{const a=(d-90)*Math.PI/180;return[cx+r*Math.cos(a),cy+r*Math.sin(a)];};
let _g=0; const uid=()=>"c2g"+(++_g);
const VGrad=(id,c,o1=.95,o2=.55)=>html`<linearGradient id=${id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color=${c} stop-opacity=${o1}/><stop offset="100%" stop-color=${c} stop-opacity=${o2}/></linearGradient>`;

// ===== 双轴复合：柱 + 线 =====
export function ComboBarLine({ labels, bars, line, w=540, h=210, barName="", lineName="", barColor=PAL.accent, lineColor=PAL.pink, lineUnit="", barFmt, lineFmt }){
  const pad={l:44,r:46,t:20,b:28}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const bMax=Math.max(...bars)*1.1||1, lMin=Math.min(...line), lMax=Math.max(...line), lPad=(lMax-lMin)*0.2||1;
  const lo=lMin-lPad, hi=lMax+lPad, n=labels.length, bw=iw/n*0.56, gap=iw/n;
  const X=(i)=>pad.l+i*gap+gap/2, YB=(v)=>pad.t+ih-v/bMax*ih, YL=(v)=>pad.t+ih-(v-lo)/((hi-lo)||1)*ih;
  const gid=uid();
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%"><defs>${VGrad(gid,barColor,.9,.45)}</defs>
    ${[0,.5,1].map(g=>{const y=pad.t+ih*(1-g);return html`<g><line x1=${pad.l} y1=${y} x2=${w-pad.r} y2=${y} stroke=${g===0?PAL.line:PAL.line2}/>
      <text x=${pad.l-5} y=${y+3} font-size="9" fill=${barColor} text-anchor="end">${Math.round(bMax*g)}</text>
      <text x=${w-pad.r+5} y=${y+3} font-size="9" fill=${lineColor}>${(lo+(hi-lo)*g).toFixed(0)}${lineUnit}</text></g>`;})}
    ${labels.map((l,i)=> i%Math.ceil(n/9||1)===0?html`<text x=${X(i)} y=${h-8} font-size="8.5" fill=${PAL.muted} text-anchor="middle">${l}</text>`:"")}
    ${bars.map((v,i)=>html`<rect class="mk" x=${X(i)-bw/2} y=${YB(v)} width=${bw} height=${pad.t+ih-YB(v)} rx="2.5" fill=${`url(#${gid})`} data-tip=${`${labels[i]} · ${barName}: <b>${barFmt?barFmt(v):v}</b>`}/>`)}
    <path d=${line.map((v,i)=>`${i?"L":"M"}${X(i)},${YL(v)}`).join(" ")} fill="none" stroke=${lineColor} stroke-width="2.4"/>
    ${line.map((v,i)=>html`<circle class="mk" cx=${X(i)} cy=${YL(v)} r="3" fill="#fff" stroke=${lineColor} stroke-width="2" data-tip=${`${labels[i]} · ${lineName}: <b>${lineFmt?lineFmt(v):v}${lineUnit}</b>`}/>`)}
    <g><rect x=${pad.l} y=${4} width="9" height="9" rx="2" fill=${barColor}/><text x=${pad.l+13} y=${12} font-size="9.5" fill=${PAL.ink}>${barName}</text>
      <rect x=${pad.l+90} y=${4} width="9" height="9" rx="2" fill=${lineColor}/><text x=${pad.l+103} y=${12} font-size="9.5" fill=${PAL.ink}>${lineName}</text></g>
  </svg>`;
}

// ===== 置信区间扇形带 =====
export function FanChart({ labels, p10, p50, p90, w=540, h=200, unit="", name="" }){
  const pad={l:44,r:14,t:16,b:26}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const mn=Math.min(...p10), mx=Math.max(...p90), n=labels.length;
  const X=(i)=>pad.l+(n<2?iw/2:i/(n-1)*iw), Y=(v)=>pad.t+ih-(v-mn)/((mx-mn)||1)*ih, gid=uid();
  const band=[...p90.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`),...p10.map((v,i)=>`L${X(n-1-i)},${Y(p10[n-1-i])}`),"Z"].join(" ");
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%"><defs>${VGrad(gid,PAL.accent,.22,.06)}</defs>
    ${[0,.5,1].map(g=>{const y=pad.t+ih*(1-g);return html`<g><line x1=${pad.l} y1=${y} x2=${w-pad.r} y2=${y} stroke=${PAL.line2}/>
      <text x=${pad.l-5} y=${y+3} font-size="9" fill=${PAL.faint} text-anchor="end">${fmt.num(Math.round(mn+(mx-mn)*g))}</text></g>`;})}
    ${labels.map((l,i)=> i%Math.ceil(n/9||1)===0?html`<text x=${X(i)} y=${h-8} font-size="8.5" fill=${PAL.muted} text-anchor="middle">${l}</text>`:"")}
    <path d=${band} fill=${`url(#${gid})`} stroke="none"/>
    <path d=${p90.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`).join(" ")} fill="none" stroke=${PAL.accent} stroke-width="1" stroke-dasharray="3 2" opacity="0.5"/>
    <path d=${p10.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`).join(" ")} fill="none" stroke=${PAL.accent} stroke-width="1" stroke-dasharray="3 2" opacity="0.5"/>
    <path d=${p50.map((v,i)=>`${i?"L":"M"}${X(i)},${Y(v)}`).join(" ")} fill="none" stroke=${PAL.accent} stroke-width="2.6"/>
    ${p50.map((v,i)=>html`<circle class="mk" cx=${X(i)} cy=${Y(v)} r="3" fill="#fff" stroke=${PAL.accent} stroke-width="2" data-tip=${`${labels[i]}<br/>P50 <b>${v}${unit}</b> · P10 ${p10[i]} · P90 ${p90[i]}`}/>`)}
    <text x=${pad.l} y=${11} font-size="9.5" fill=${PAL.muted}>${name} · 阴影=P10–P90 置信区间</text>
  </svg>`;
}

// ===== 箱线图 =====
export function BoxPlot({ groups, w=520, h=230, unit="" }){
  const pad={l:44,r:14,t:16,b:34}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const mn=Math.min(...groups.map(g=>g.min)), mx=Math.max(...groups.map(g=>g.max)), n=groups.length;
  const Y=(v)=>pad.t+ih-(v-mn)/((mx-mn)||1)*ih, gap=iw/n, bw=Math.min(46,gap*0.5);
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    ${[0,.5,1].map(g=>{const y=pad.t+ih*(1-g);return html`<g><line x1=${pad.l} y1=${y} x2=${w-pad.r} y2=${y} stroke=${PAL.line2}/>
      <text x=${pad.l-5} y=${y+3} font-size="9" fill=${PAL.faint} text-anchor="end">${Math.round(mn+(mx-mn)*g)}${unit}</text></g>`;})}
    ${groups.map((g,i)=>{const x=pad.l+i*gap+gap/2, col=g.color||SER[i%SER.length];
      return html`<g data-tip=${`${g.label}<br/>中位 <b>${g.med}</b> · Q1 ${g.q1} · Q3 ${g.q3}<br/>范围 ${g.min}–${g.max}`}>
        <line x1=${x} y1=${Y(g.max)} x2=${x} y2=${Y(g.q3)} stroke=${col}/><line x1=${x} y1=${Y(g.q1)} x2=${x} y2=${Y(g.min)} stroke=${col}/>
        <line x1=${x-bw/3} y1=${Y(g.max)} x2=${x+bw/3} y2=${Y(g.max)} stroke=${col}/><line x1=${x-bw/3} y1=${Y(g.min)} x2=${x+bw/3} y2=${Y(g.min)} stroke=${col}/>
        <rect class="mk" x=${x-bw/2} y=${Y(g.q3)} width=${bw} height=${Math.max(2,Y(g.q1)-Y(g.q3))} rx="2" fill=${col} fill-opacity="0.3" stroke=${col}/>
        <line x1=${x-bw/2} y1=${Y(g.med)} x2=${x+bw/2} y2=${Y(g.med)} stroke=${col} stroke-width="2.5"/>
        <text x=${x} y=${h-8} font-size="9" fill=${PAL.muted} text-anchor="middle">${g.label}</text></g>`;})}
  </svg>`;
}

// ===== Marimekko 变宽堆叠 =====
export function Marimekko({ cols, w=560, h=250 }){
  const pad={l:6,r:6,t:8,b:30}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const totalW=cols.reduce((s,c)=>s+c.width,0)||1; let x=pad.l;
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    ${cols.map((c)=>{const cw=c.width/totalW*iw, x0=x; x+=cw;
      const segTot=c.segments.reduce((s,g)=>s+g.value,0)||1; let y=pad.t;
      return html`<g><text x=${x0+cw/2} y=${h-16} font-size="9.5" fill=${PAL.ink} text-anchor="middle" font-weight="600">${c.label}</text>
        <text x=${x0+cw/2} y=${h-5} font-size="8.5" fill=${PAL.muted} text-anchor="middle">${Math.round(c.width/totalW*100)}%</text>
        ${c.segments.map((g,gi)=>{const sh=g.value/segTot*ih, y0=y; y+=sh;
          return html`<rect class="mk" x=${x0+1} y=${y0} width=${Math.max(1,cw-2)} height=${sh} fill=${g.color||SER[gi%SER.length]} fill-opacity="0.9"
            data-tip=${`${c.label} · ${g.label}: <b>${g.value}</b>`}/>
            ${sh>16&&cw>40?html`<text x=${x0+cw/2} y=${y0+sh/2+3} font-size="9" fill="#fff" text-anchor="middle">${g.label} ${Math.round(g.value/segTot*100)}%</text>`:""}`;})}</g>`;})}
  </svg>`;
}

// ===== 子弹图 =====
export function Bullet({ items, w=520, unit="" }){
  const rowH=34, labelW=140, iw=w-labelW-40;
  const mx=Math.max(...items.map(i=>Math.max(i.value,i.target,(i.ranges||[]).slice(-1)[0]||0)))*1.05||1;
  const X=(v)=>labelW+v/mx*iw;
  return html`<svg viewBox=${`0 0 ${w} ${items.length*rowH+6}`} width="100%" style="max-width:100%">
    ${items.map((it,i)=>{const y=6+i*rowH, rs=it.ranges||[mx*0.4,mx*0.7,mx];
      const shades=["#eef0f4","#e4e7ef","#d8dcea"];
      return html`<g data-tip=${`${it.label}: <b>${it.value}${unit}</b> / 目标 ${it.target}${unit}`}>
        ${rs.map((r,ri)=>html`<rect x=${labelW} y=${y+6} width=${X(r)-labelW} height="16" fill=${shades[ri]||"#d8dcea"}/>`).reverse()}
        <text x=${labelW-8} y=${y+18} font-size="11" fill=${PAL.ink} text-anchor="end" font-weight="600">${it.label}</text>
        <rect class="mk" x=${labelW} y=${y+10} width=${Math.max(1,X(it.value)-labelW)} height="8" rx="1" fill=${it.value>=it.target?PAL.high:PAL.med}/>
        <line x1=${X(it.target)} y1=${y+4} x2=${X(it.target)} y2=${y+24} stroke=${PAL.ink} stroke-width="2"/>
        <text x=${X(Math.max(it.value,it.target))+6} y=${y+18} font-size="10" fill=${PAL.ink}>${it.value}${unit}</text></g>`;})}
  </svg>`;
}

// ===== 斜率图 =====
export function Slope({ dims, seriesA, seriesB, max=5, w=440, h=260 }){
  const pad={t:24,b:20}, lx=140, rx=w-140, ih=h-pad.t-pad.b, Y=(v)=>pad.t+ih-(v/max)*ih;
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    <line x1=${lx} y1=${pad.t} x2=${lx} y2=${pad.t+ih} stroke=${PAL.line}/><line x1=${rx} y1=${pad.t} x2=${rx} y2=${pad.t+ih} stroke=${PAL.line}/>
    <text x=${lx} y=${14} font-size="10.5" fill=${PAL.slate} text-anchor="middle" font-weight="700">${seriesA.name}</text>
    <text x=${rx} y=${14} font-size="10.5" fill=${PAL.accent} text-anchor="middle" font-weight="700">${seriesB.name}</text>
    ${dims.map((d,i)=>{const ya=Y(seriesA.scores[i]), yb=Y(seriesB.scores[i]), up=seriesB.scores[i]>=seriesA.scores[i];
      return html`<g data-tip=${`${d}: ${seriesA.scores[i]} → <b>${seriesB.scores[i]}</b>`}>
        <line class="mk" x1=${lx} y1=${ya} x2=${rx} y2=${yb} stroke=${up?PAL.high:PAL.low} stroke-width="2"/>
        <circle cx=${lx} cy=${ya} r="3.5" fill=${PAL.slate}/><circle cx=${rx} cy=${yb} r="3.5" fill=${PAL.accent}/>
        <text x=${lx-8} y=${ya+3} font-size="10" fill=${PAL.ink} text-anchor="end">${d} ${seriesA.scores[i]}</text>
        <text x=${rx+8} y=${yb+3} font-size="10" fill=${up?PAL.high:PAL.low} font-weight="700">${seriesB.scores[i]}</text></g>`;})}
  </svg>`;
}

// ===== 桑基流向图（分层 · 专业版：颜色分列 · 渐变连线 · 标签上下分离防重叠）=====
export function Sankey({ nodes, links, w=760, h }){
  const cols=Math.max(...nodes.map(n=>n.col))+1;
  const nodeW=12, padX=18, padTop=34, padBot=30, gap=18;
  const colNodes=Array.from({length:cols},(_,c)=>nodes.filter(n=>n.col===c));
  const val=(id)=>{const out=links.filter(l=>l.source===id).reduce((s,l)=>s+l.value,0);
    const inc=links.filter(l=>l.target===id).reduce((s,l)=>s+l.value,0); return Math.max(out,inc,1);};
  const colColor=(c)=>SER[c%SER.length];
  // 以最"重"的列决定纵向比例，保证任何列都放得下且居中
  const colVal=colNodes.map(cn=>cn.reduce((s,n)=>s+val(n.id),0));
  const colGapH=colNodes.map(cn=>Math.max(0,cn.length-1)*gap);
  const innerH=300;
  const scale=Math.min(...colNodes.map((cn,c)=>(innerH-colGapH[c])/(colVal[c]||1)));
  const H=h||Math.round(innerH+padTop+padBot);
  const colX=(c)=>padX+ (cols>1? c/(cols-1)*(w-2*padX-nodeW) : 0);
  const pos={};
  colNodes.forEach((cn,c)=>{const stackH=colVal[c]*scale+colGapH[c]; let y=padTop+(innerH-stackH)/2; const x=colX(c);
    cn.forEach(n=>{const hh=val(n.id)*scale; pos[n.id]={x,y,h:hh,c,outO:0,inO:0}; y+=hh+gap;});});
  const grads=[], linkPaths=links.map(l=>{const s=pos[l.source], t=pos[l.target]; if(!s||!t) return null;
    const th=Math.max(1.5,l.value*scale), y0=s.y+s.outO, y1=t.y+t.inO; s.outO+=th; t.inO+=th;
    const x0=s.x+nodeW, x1=t.x, xm=(x0+x1)/2, gid=uid();
    grads.push(html`<linearGradient id=${gid} x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color=${colColor(s.c)} stop-opacity="0.5"/><stop offset="100%" stop-color=${colColor(t.c)} stop-opacity="0.5"/></linearGradient>`);
    const d=`M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1+th} C${xm},${y1+th} ${xm},${y0+th} ${x0},${y0+th} Z`;
    return {d, gid, tip:`${l.source} → ${l.target}: <b>${l.value}</b>`};}).filter(Boolean);
  const trunc=(s)=>{s=String(s); return s.length>9?s.slice(0,9)+"…":s;};
  return html`<svg viewBox=${`0 0 ${w} ${H}`} width="100%" style="max-width:100%">
    <defs>${grads}</defs>
    ${linkPaths.map(lp=>html`<path class="mk" d=${lp.d} fill=${`url(#${lp.gid})`} data-tip=${lp.tip}/>`)}
    ${nodes.map(n=>{const p=pos[n.id]; if(!p) return ""; const cx=p.x+nodeW/2;
      return html`<g data-tip=${`${n.label}: <b>${val(n.id)}</b>`}>
        <rect class="mk" x=${p.x} y=${p.y} width=${nodeW} height=${Math.max(2,p.h)} rx="3" fill=${colColor(p.c)}/>
        <text x=${cx} y=${p.y-6} font-size="9.5" fill=${PAL.ink} text-anchor="middle" font-weight="600">${trunc(n.label)}</text>
        <text x=${cx} y=${p.y+p.h+13} font-size="9" fill=${PAL.muted} text-anchor="middle">${val(n.id)}</text></g>`;})}
  </svg>`;
}

// ===== 散点 + 回归线 + R² =====
export function ScatterReg({ points, w=520, h=300, xLabel, yLabel, xMax, yMax, curve }){
  const pad={l:46,r:16,t:16,b:34}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const xM=xMax||Math.max(...points.map(p=>p.x))*1.1, yM=yMax||Math.max(...points.map(p=>p.y))*1.1;
  const X=(v)=>pad.l+v/xM*iw, Y=(v)=>pad.t+ih-v/yM*ih;
  const n=points.length, sx=points.reduce((s,p)=>s+p.x,0), sy=points.reduce((s,p)=>s+p.y,0);
  const sxy=points.reduce((s,p)=>s+p.x*p.y,0), sxx=points.reduce((s,p)=>s+p.x*p.x,0);
  const slope=(n*sxy-sx*sy)/((n*sxx-sx*sx)||1), inter=(sy-slope*sx)/n;
  const yMean=sy/n, ssTot=points.reduce((s,p)=>s+(p.y-yMean)**2,0), ssRes=points.reduce((s,p)=>s+(p.y-(slope*p.x+inter))**2,0);
  const r2=ssTot?1-ssRes/ssTot:0;
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    ${[0,.5,1].map(g=>html`<g><line x1=${X(xM*g)} y1=${pad.t} x2=${X(xM*g)} y2=${pad.t+ih} stroke=${PAL.line2}/>
      <text x=${X(xM*g)} y=${pad.t+ih+13} font-size="9" fill=${PAL.faint} text-anchor="middle">${Math.round(xM*g)}</text>
      <line x1=${pad.l} y1=${Y(yM*g)} x2=${w-pad.r} y2=${Y(yM*g)} stroke=${PAL.line2}/>
      <text x=${pad.l-5} y=${Y(yM*g)+3} font-size="9" fill=${PAL.faint} text-anchor="end">${Math.round(yM*g)}</text></g>`)}
    <line x1=${X(0)} y1=${Y(inter)} x2=${X(xM)} y2=${Y(slope*xM+inter)} stroke=${PAL.accent} stroke-width="2" stroke-dasharray="6 3"/>
    ${points.map(p=>{const r=p.r?6+(p.r/Math.max(...points.map(q=>q.r||1)))*20:7, col=p.highlight?PAL.accent:(p.color||PAL.slate);
      return html`<g><circle class="mk" cx=${X(p.x)} cy=${Y(p.y)} r=${r} fill=${col} fill-opacity=${p.highlight?0.9:0.5} stroke=${col} stroke-width=${p.highlight?2:1}
        data-tip=${`<b>${p.label||""}</b><br/>${xLabel||"x"} ${p.x} · ${yLabel||"y"} ${p.y}`}/>
        <text x=${X(p.x)} y=${Y(p.y)-r-3} font-size="8.5" fill=${PAL.ink} text-anchor="middle">${p.label||""}</text></g>`;})}
    <text x=${w-pad.r} y=${pad.t+12} font-size="10" fill=${PAL.accent} text-anchor="end" font-weight="700">${curve||`拟合 R²=${r2.toFixed(2)} · 斜率 ${slope.toFixed(2)}`}</text>
    <text x=${pad.l+iw/2} y=${h-3} font-size="10" fill=${PAL.muted} text-anchor="middle">${xLabel||""}</text>
    <text x=${13} y=${pad.t+ih/2} font-size="10" fill=${PAL.muted} text-anchor="middle" transform=${`rotate(-90 13 ${pad.t+ih/2})`}>${yLabel||""}</text>
  </svg>`;
}

// ===== 雷达 + 基准带 =====
export function RadarBench({ axes, series, benchLow, benchHigh, max=100, size=290 }){
  const cx=size/2, cy=size/2+6, R=size/2-48, n=axes.length, rings=[.25,.5,.75,1];
  const band=[...axes.map((_,i)=>P(cx,cy,R*benchHigh[i]/max,i*360/n).join(",")),
    ...axes.map((_,i)=>P(cx,cy,R*benchLow[n-1-i]/max,(n-1-i)*360/n).join(","))].join(" ");
  return html`<svg width=${size} height=${size+8} viewBox=${`0 0 ${size} ${size+8}`} style="max-width:100%">
    ${rings.map(g=>html`<polygon points=${axes.map((_,i)=>P(cx,cy,R*g,i*360/n).join(",")).join(" ")} fill="none" stroke=${PAL.line} stroke-width="1"/>`)}
    <polygon points=${band} fill=${PAL.slate} fill-opacity="0.13" stroke=${PAL.slate} stroke-width="1" stroke-dasharray="3 2"/>
    ${axes.map((ax,i)=>{const[lx,ly]=P(cx,cy,R+22,i*360/n);return html`<text x=${lx} y=${ly} font-size="10" fill=${PAL.muted} text-anchor="middle" dominant-baseline="middle">${ax}</text>`;})}
    ${series.map((s,si)=>{const col=s.color||SER[si%SER.length];const pts=s.scores.map((v,i)=>P(cx,cy,R*Math.max(0,Math.min(1,v/max)),i*360/n).join(",")).join(" ");
      return html`<g><polygon points=${pts} fill=${col} fill-opacity="0.15" stroke=${col} stroke-width="2.4"/>
        ${s.scores.map((v,i)=>{const[x,y]=P(cx,cy,R*v/max,i*360/n);return html`<circle class="mk" cx=${x} cy=${y} r="3" fill=${col} data-tip=${`${axes[i]} · ${s.name}: <b>${v}</b>`}/>`;})}</g>`;})}
    <g><rect x=${8} y=${8} width="10" height="10" fill=${PAL.slate} fill-opacity="0.2"/><text x=${22} y=${17} font-size="10" fill=${PAL.ink}>竞品区间</text>
      ${series.map((s,si)=>html`<g><rect x=${8} y=${24+si*15} width="10" height="10" rx="2" fill=${s.color||SER[si%SER.length]}/><text x=${22} y=${33+si*15} font-size="10" fill=${PAL.ink}>${s.name}</text></g>`)}</g>
  </svg>`;
}

// ===== 双向堆叠（正负情感）=====
export function StackedDiverging({ items, w=540 }){
  const rowH=26, labelW=130, half=(w-labelW-40)/2, cx=labelW+half;
  const av=(x)=>Math.abs(+x||0);
  const mx=Math.max(...items.map(i=>Math.max(av(i.neg),av(i.pos))))*1.1||1;
  const lbl=(x)=>{const a=av(x); return a<=1?Math.round(a*100)+"%":(Number.isInteger(a)?a:Math.round(a));};
  return html`<svg viewBox=${`0 0 ${w} ${items.length*rowH+22}`} width="100%" style="max-width:100%">
    <line x1=${cx} y1=${6} x2=${cx} y2=${items.length*rowH+6} stroke=${PAL.line}/>
    <text x=${cx-half/2} y=${items.length*rowH+18} font-size="9" fill=${PAL.low} text-anchor="middle">← 差评</text>
    <text x=${cx+half/2} y=${items.length*rowH+18} font-size="9" fill=${PAL.high} text-anchor="middle">好评 →</text>
    ${items.map((it,i)=>{const y=8+i*rowH, nw=av(it.neg)/mx*half, pw=av(it.pos)/mx*half;
      return html`<g data-tip=${`${it.label}<br/>差评 <b>${lbl(it.neg)}</b> · 好评 ${lbl(it.pos)}`}>
        <rect class="mk" x=${cx-nw} y=${y} width=${nw} height="16" rx="2" fill=${PAL.low} fill-opacity="0.85"/>
        <rect class="mk" x=${cx} y=${y} width=${pw} height="16" rx="2" fill=${PAL.high} fill-opacity="0.85"/>
        <text x=${labelW-8} y=${y+12} font-size="10.5" fill=${PAL.ink} text-anchor="end">${it.strategic?"⭐ ":""}${it.label}</text>
        <text x=${cx-nw-4} y=${y+12} font-size="8.5" fill=${PAL.low} text-anchor="end">${lbl(it.neg)}</text>
        <text x=${cx+pw+4} y=${y+12} font-size="8.5" fill=${PAL.high}>${lbl(it.pos)}</text></g>`;})}
  </svg>`;
}

// ===== K线式区间（高/低/收）=====
export function Candlestick({ periods, w=540, h=200 }){
  const pad={l:42,r:12,t:14,b:24}, iw=w-pad.l-pad.r, ih=h-pad.t-pad.b;
  const mn=Math.min(...periods.map(p=>p.l)), mx=Math.max(...periods.map(p=>p.h)), n=periods.length;
  const Y=(v)=>pad.t+ih-(v-mn)/((mx-mn)||1)*ih, gap=iw/n, bw=Math.min(16,gap*0.5);
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" style="max-width:100%">
    ${[0,.5,1].map(g=>{const y=pad.t+ih*(1-g);return html`<g><line x1=${pad.l} y1=${y} x2=${w-pad.r} y2=${y} stroke=${PAL.line2}/>
      <text x=${pad.l-5} y=${y+3} font-size="9" fill=${PAL.faint} text-anchor="end">${fmt.num(Math.round(mn+(mx-mn)*g))}</text></g>`;})}
    ${periods.map((p,i)=>{const x=pad.l+i*gap+gap/2, up=p.c>=p.o, col=up?PAL.high:PAL.low;
      return html`<g data-tip=${`${p.label} · 高${p.h} 低${p.l} 收${p.c}`}><line x1=${x} y1=${Y(p.h)} x2=${x} y2=${Y(p.l)} stroke=${col}/>
        <rect class="mk" x=${x-bw/2} y=${Y(Math.max(p.o,p.c))} width=${bw} height=${Math.max(2,Math.abs(Y(p.o)-Y(p.c)))} rx="1.5" fill=${col} fill-opacity="0.85"/>
        <text x=${x} y=${h-8} font-size="8" fill=${PAL.muted} text-anchor="middle">${p.label}</text></g>`;})}
  </svg>`;
}
