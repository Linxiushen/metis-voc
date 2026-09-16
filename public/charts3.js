// 灵眸/LynxAI 逆向新图型：评价等级矩阵 / 评级市场地图 / 表内条 / 痛点词云 / 概念对标卡
import htm, { h } from "./vendor/metis-vendor.js";
const html = htm.bind(h);

const GRADE_COLOR = { A: "#16a34a", B: "#eab308", C: "#f97316", D: "#ef4444" };
const scoreColor = (s) => s >= 8 ? GRADE_COLOR.A : s >= 7 ? GRADE_COLOR.B : s >= 6 ? GRADE_COLOR.C : GRADE_COLOR.D;
const scoreLetter = (s) => s >= 8 ? "A" : s >= 7 ? "B" : s >= 6 ? "C" : "D";
const isMissing = (v) => v == null || v === "-" || v === "0%" || v === "";

// ============ 评价等级矩阵（签名视图）============
// {columns:[维度,...niche], rows:[{dim, cells:[{v?,grade?,color?,bar?,good?,tip?}]}], legend, note}
export function GradeMatrix({ columns, rows, legend, note }) {
  return html`<div class="gm-wrap">
    <div style="overflow:auto"><table class="gm">
      <thead><tr>${(columns || []).map((c, i) => html`<th class=${i === 0 ? "gm-dim" : ""}>${c}</th>`)}</tr></thead>
      <tbody>${(rows || []).map(r => html`<tr>
        <td class="gm-dim">${r.dim}</td>
        ${(r.cells || []).map(cell => {
          if (cell.grade) return html`<td class="gm-grade" data-tip=${cell.tip || ""}>
            <span class="gm-badge" style=${`background:${cell.color || GRADE_COLOR[cell.grade] || "#94a3b8"}`}>${cell.grade}</span></td>`;
          if (cell.bar != null) return html`<td class="gm-score">
            <div class="gm-scorebar"><span style=${`width:${Math.max(4, Math.min(100, cell.bar))}%;background:${cell.color || scoreColor(cell.v)}`}></span></div>
            <b style=${`color:${cell.color || scoreColor(cell.v)}`}>${cell.v}</b></td>`;
          const miss = isMissing(cell.v);
          return html`<td class=${"gm-cell" + (cell.good ? " gm-good" : "") + (miss ? " gm-miss" : "")}>
            ${cell.v}${cell.good ? html`<span class="gm-up">👍</span>` : ""}</td>`;
        })}
      </tr>`)}</tbody>
    </table></div>
    ${legend ? html`<div class="gm-legend">${Object.entries(legend).map(([k, v]) =>
      GRADE_COLOR[k] ? html`<span class="gm-lg"><i style=${`background:${v}`}></i>${k}</span>` : html`<span class="gm-lgtxt">${v}</span>`)}</div>` : ""}
    ${note ? html`<div class="note">${note}</div>` : ""}
  </div>`;
}

// ============ 评级市场地图（Heatmap + 字母角标 + gateFail 置灰）============
export function GradeMap({ xLabels, yLabels, matrix, cellGrades, gateFail, legend, note }) {
  const rows = matrix || [];
  return html`<div class="gmap-wrap">
    <div style="overflow:auto"><table class="gmap">
      <thead><tr><th></th>${(xLabels || []).map(x => html`<th>${x}</th>`)}</tr></thead>
      <tbody>${rows.map((row, i) => html`<tr>
        <td class="gmap-y">${(yLabels || [])[i]}</td>
        ${row.map((s, j) => {
          const gf = gateFail && gateFail[i] && gateFail[i][j];
          const letter = (cellGrades && cellGrades[i] && cellGrades[i][j]) || scoreLetter(s);
          const bg = gf ? "#94a3b8" : scoreColor(s);
          return html`<td class="gmap-c" style=${`background:${bg}`}
            data-tip=${`评分 ${s}/10 · ${letter}${gf ? " · 硬门槛未过(置灰)" : ""}`}>
            <span class="gmap-s">${s}</span><span class="gmap-g">${gf ? "×" : letter}</span></td>`;
        })}
      </tr>`)}</tbody>
    </table></div>
    ${legend ? html`<div class="gm-legend">${legend.map(l => html`<span class="gm-lg"><i style=${`background:${l.color}`}></i>${l.grade} ${l.range}</span>`)}</div>` : ""}
    ${note ? html`<div class="note">${note}</div>` : ""}
  </div>`;
}

// ============ 表内嵌横条（差评墙粉条 / 好评点绿条）============
export function TableWithBar({ v }) {
  const cols = v.columns || [], rows = v.rows || [];
  const bc = v.bar_col, bmax = v.bar_max || 100;
  const barColor = v.bar_color === "pink" ? "rgba(219,39,119,.16)" : v.bar_color === "teal" ? "rgba(16,163,127,.16)" : "rgba(37,99,235,.14)";
  return html`<div class="twb-wrap"><div style="overflow:auto"><table class="twb">
    <thead><tr>${cols.map(c => html`<th>${c}</th>`)}</tr></thead>
    <tbody>${rows.map(r => html`<tr>${cols.map(c => {
      if (c === bc) { const val = +r[c] || 0; const w = Math.max(2, Math.min(100, val / bmax * 100));
        return html`<td class="twb-bar"><span class="twb-fill" style=${`width:${w}%;background:${barColor}`}></span><b>${r[c]}${typeof r[c] === "number" && val <= 100 ? "%" : ""}</b></td>`; }
      return html`<td>${r[c]}</td>`;
    })}</tr>`)}</tbody>
  </table></div>${v.note ? html`<div class="note">${v.note}</div>` : ""}</div>`;
}

// ============ 痛点词云（字号∝加权频次，色∝情感）============
function sentColor(s) {
  if (s <= -0.6) return "#b91c1c"; if (s <= -0.3) return "#ea580c";
  if (s < 0) return "#a16207"; if (s < 0.4) return "#64748b"; return "#16a34a";
}
export function WordCloud({ words, note }) {
  const ws = (words || []).slice().sort((a, b) => b.weight - a.weight);
  const mx = Math.max(1, ...ws.map(w => w.weight)), mn = Math.min(...ws.map(w => w.weight));
  const size = (w) => { const t = (Math.sqrt(w) - Math.sqrt(mn)) / (Math.sqrt(mx) - Math.sqrt(mn) || 1); return Math.round(14 + t * 30); };
  return html`<div class="wc-wrap"><div class="wc">${ws.map(w => html`<span class="wc-w"
      style=${`font-size:${size(w.weight)}px;color:${sentColor(w.sentiment)};opacity:${0.62 + 0.38 * (w.weight / mx)}`}
      data-tip=${`权重 ${w.weight} · 情感 ${w.sentiment}`}>${w.text}</span>`)}</div>
    ${note ? html`<div class="note">${note}</div>` : ""}</div>`;
}

// ============ 机会×胜算 2×2 决策象限（火葬场报警）============
// {points:[{x,y,r,label,quadrant,color}], xSplit, ySplit, xLabel, yLabel, quadrant_labels, alert, note}
export function QuadrantScatter({ points, xSplit, ySplit, xLabel, yLabel, quadrant_labels, alert, note, xMax = 10, yMax = 100 }) {
  const W = 620, H = 420, pad = { l: 54, r: 18, t: 40, b: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (v) => pad.l + Math.min(v, xMax) / xMax * iw;
  const Y = (v) => pad.t + ih - Math.min(v, yMax) / yMax * ih;
  const xs = X(xSplit), ys = Y(ySplit);
  const ql = quadrant_labels || {};
  const tints = { tr: "rgba(22,163,74,.07)", tl: "rgba(234,179,8,.07)", br: "rgba(239,68,68,.09)", bl: "rgba(148,163,184,.06)" };
  return html`<div class="qs-wrap">
    ${alert ? html`<div class=${"qs-alert" + (alert.includes("⚠") ? " danger" : " ok")}>${alert}</div>` : ""}
    <div style="overflow:auto"><svg viewBox=${`0 0 ${W} ${H}`} width="100%" style="max-width:100%;min-width:520px">
      <rect x=${xs} y=${pad.t} width=${pad.l + iw - xs} height=${ys - pad.t} fill=${tints.tr}/>
      <rect x=${pad.l} y=${pad.t} width=${xs - pad.l} height=${ys - pad.t} fill=${tints.tl}/>
      <rect x=${xs} y=${ys} width=${pad.l + iw - xs} height=${pad.t + ih - ys} fill=${tints.br}/>
      <rect x=${pad.l} y=${ys} width=${xs - pad.l} height=${pad.t + ih - ys} fill=${tints.bl}/>
      <text x=${pad.l + iw - 6} y=${pad.t + 14} font-size="11" font-weight="800" fill="#16a34a" text-anchor="end">${ql.tr || ""}</text>
      <text x=${pad.l + 6} y=${pad.t + 14} font-size="11" font-weight="800" fill="#b7920a" text-anchor="start">${ql.tl || ""}</text>
      <text x=${pad.l + iw - 6} y=${pad.t + ih - 8} font-size="11.5" font-weight="800" fill="#ef4444" text-anchor="end">${ql.br || ""}</text>
      <text x=${pad.l + 6} y=${pad.t + ih - 8} font-size="11" font-weight="800" fill="#94a3b8" text-anchor="start">${ql.bl || ""}</text>
      <line x1=${xs} y1=${pad.t} x2=${xs} y2=${pad.t + ih} stroke="#cbd5e1" stroke-dasharray="4 3"/>
      <line x1=${pad.l} y1=${ys} x2=${pad.l + iw} y2=${ys} stroke="#cbd5e1" stroke-dasharray="4 3"/>
      <line x1=${pad.l} y1=${pad.t + ih} x2=${pad.l + iw} y2=${pad.t + ih} stroke="#e5e5e5"/>
      <line x1=${pad.l} y1=${pad.t} x2=${pad.l} y2=${pad.t + ih} stroke="#e5e5e5"/>
      <text x=${pad.l + iw / 2} y=${H - 8} font-size="10.5" fill="#71717a" text-anchor="middle">${xLabel || "beta"}</text>
      <text x=${14} y=${pad.t + ih / 2} font-size="10.5" fill="#71717a" text-anchor="middle" transform=${`rotate(-90 14 ${pad.t + ih / 2})`}>${yLabel || "alpha"}</text>
      ${(points || []).map(p => html`<g data-tip=${`${p.label} · beta ${p.x} × alpha ${p.y}`}>
        <circle cx=${X(p.x)} cy=${Y(p.y)} r=${p.r || 20} fill=${p.color || "#64748b"} fill-opacity="0.28" stroke=${p.color || "#64748b"} stroke-width="1.6"/>
        <circle cx=${X(p.x)} cy=${Y(p.y)} r="3.5" fill=${p.color || "#64748b"}/>
        <text x=${X(p.x)} y=${Y(p.y) - (p.r || 20) - 5} font-size="10" font-weight="600" fill="#27272a" text-anchor="middle">${p.label}</text>
      </g>`)}
    </svg></div>
    ${note ? html`<div class="note">${note}</div>` : ""}
  </div>`;
}

// ============ 战略决策地图（分层彩色节点 + 连线 + 洞察）============
// {nodes:[{id,label,grade,score,tier,weight,confidence}], links:[{source,target}], basis, note}
export function StrategyMap({ nodes, links, basis, note }) {
  const ns = nodes || [], ls = links || [];
  const tiers = [...new Set(ns.map(n => n.tier))].sort((a, b) => a - b);
  const W = 720, colW = W / tiers.length;
  const perTier = Math.max(1, ...tiers.map(t => ns.filter(n => n.tier === t).length));
  const H = perTier * 76 + 30;
  const pos = {};
  tiers.forEach((t, ci) => {
    const col = ns.filter(n => n.tier === t), rh = H / (col.length + 1);
    col.forEach((n, ri) => { pos[n.id] = { x: colW * ci + colW / 2, y: rh * (ri + 1) }; });
  });
  const rad = (n) => 13 + (n.weight != null ? n.weight : 0.5) * 15;
  const basisColor = basis === "go" ? "#16a34a" : basis === "no_go" ? "#ef4444" : "#eab308";
  const basisLabel = basis === "go" ? "GO 进入" : basis === "no_go" ? "NO-GO 放弃" : "有条件 GO";
  return html`<div class="sm-wrap">
    <div class="sm-basis" style=${`border-color:${basisColor};color:${basisColor}`}>决策依据 · ${basisLabel}</div>
    <div style="overflow:auto"><svg viewBox=${`0 0 ${W} ${H}`} width="100%" style="max-width:100%;min-width:560px">
      ${ls.map(l => { const a = pos[l.source], b = pos[l.target]; if (!a || !b) return "";
        const mx = (a.x + b.x) / 2;
        return html`<path d=${`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
          fill="none" stroke="#d4d4d8" stroke-width=${1 + (l.value || 1) * 0.6} opacity="0.8"/>`; })}
      ${ns.map(n => { const p = pos[n.id], r = rad(n), col = GRADE_COLOR[n.grade] || "#64748b";
        const dashed = n.confidence === "Low";
        return html`<g data-tip=${`${n.label}${n.score != null ? " · 评分 " + n.score : ""}${n.grade ? " · " + n.grade + "级" : ""}${n.confidence ? " · 置信" + n.confidence : ""}`}>
          <circle cx=${p.x} cy=${p.y} r=${r} fill=${col} fill-opacity="0.92"
            stroke=${col} stroke-width="2" stroke-dasharray=${dashed ? "4 3" : "0"}/>
          ${n.grade ? html`<text x=${p.x} y=${p.y + 4} font-size="12" font-weight="800" fill="#fff" text-anchor="middle">${n.grade}</text>` : ""}
          <text x=${p.x} y=${p.y + r + 12} font-size="10" fill="#27272a" text-anchor="middle" font-weight="600">${n.label}</text>
        </g>`; })}
    </svg></div>
    ${note ? html`<div class="note">${note}</div>` : ""}
  </div>`;
}

// ============ 痛点解决型 概念×竞品对标卡 ============
export function ConceptCard({ concept, comps, note }) {
  const c = concept || {};
  return html`<div class="cc-wrap">
    <div class="cc-grid">
      <div class="cc-concept">
        <div class="cc-head"><span class="cc-tag">推荐产品概念</span>
          ${c.grade ? html`<span class="gm-badge" style=${`background:${GRADE_COLOR[c.grade] || "#64748b"}`}>${c.grade}</span>` : ""}</div>
        <div class="cc-name">${c.name || ""}</div>
        <div class="cc-meta"><span class="cc-price">${c.price || ""}</span>${c.score != null ? html`<span class="cc-score">总分 ${c.score}/10</span>` : ""}</div>
        ${c.positioning ? html`<div class="cc-pos">${c.positioning}</div>` : ""}
        <div class="cc-upg">${(c.upgrades || []).map(u => html`<div class="cc-u">
          <div class="cc-ut"><b>${u["升级点"] || u.point}</b>${u["置信度"] ? html`<span class=${"rlv rlv-" + (u["置信度"] === "High" ? "High" : "Medium")}>${u["置信度"]}</span>` : ""}</div>
          <div class="cc-up">↳ 痛点：${u["痛点"] || u.pain}</div></div>`)}</div>
      </div>
      <div class="cc-comps">
        <div class="cc-tag cc-tag2">竞品参考 · 弱点→反制</div>
        ${(comps || []).map(cp => html`<div class="cc-comp">
          <div class="cc-cn">${cp.name}${cp.asin ? html`<span class="cc-asin">${cp.asin}</span>` : ""}</div>
          <div class="cc-wk">弱点：${cp["弱点"] || cp.weakness}</div>
          <div class="cc-ct">↳ 我方反制：<b>${cp["我方反制"] || cp.counter}</b></div>
          <div class="cc-gain">${cp["预期收益"] || ""} ${cp["评论墙"] ? html`<span class="cc-wall">墙 ${cp["评论墙"]}</span>` : ""}</div>
        </div>`)}
      </div>
    </div>
    ${note ? html`<div class="note">${note}</div>` : ""}
  </div>`;
}
