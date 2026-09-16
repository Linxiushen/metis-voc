"""Gold 打标签（专业级评论标注引擎）——多智能体设计合成，确定性可复现基线。

四层能力（词典/正则在 config/review-labeling-schema.yaml，多智能体设计）：
  1. ABSA 四元组抽取  (aspect_term, aspect_category, opinion_term, polarity, polarity_score, confidence)
     + 分句/子句、否定作用域、程度副词缩放、"too+形容词"、就近方面-观点配对、方面词归一、隐式方面、反讽最小处理、品类适用性校验
  2. 多维标签  意图 / 使用场景JTBD / 买家人群 / 缺陷模式 / 未满足需求 / 竞品提及 / 成交阻断严重度 / 情绪强度
  3. 可信度加权  w_source·verified·recency·length·helpful·consistency·spam → evidence_weight[0,3] + 前置闸门(Low/刷单/低置信不进定量排序)
  4. Gold 聚合  加权rollup / 方面重要度(与星级弹性) / 机会白空间排序 / Kano / 用途×方面矩阵 / 竞品gap

LLM 增强点（生产替换，接口不变）：aspect-mediator 抽取、连续极性回归+SP-API锚校准、
命名竞品NER、未满足需求 slot-filling、reviewer-farm 嵌入聚类。见 config/_labeling_spec.json.impl_plan。
"""
from __future__ import annotations

import math
import re
import statistics
from collections import defaultdict
from datetime import date, datetime
from functools import lru_cache

from ..config_loader import load, absa_taxonomy

# ---- 语言学基元（确定性）----------------------------------------------------
_NEG = {"not", "no", "never", "none", "hardly", "barely", "without", "cannot", "cant",
        "dont", "doesnt", "didnt", "isnt", "wasnt", "arent", "wont", "couldnt", "wouldnt",
        "shouldnt", "nor", "neither"}
_CONTRAST = {"but", "however", "though", "although", "while", "whereas"}
_INTENS = {"extremely": 1.6, "absolutely": 1.6, "incredibly": 1.6, "super": 1.3, "very": 1.3,
           "really": 1.3, "so": 1.25, "too": 1.2, "quite": 1.15, "pretty": 1.15,
           "somewhat": 0.6, "slightly": 0.6, "barely": 0.5}

# 有符号情感词典（对齐 polarity_lexicon.base_strength 的强度锚，人工定符号；生产用 LLM 回归+锚校准）
_POS = {"love": .9, "excellent": .9, "perfect": .9, "amazing": .9, "awesome": .8, "sturdy": .7,
        "durable": .7, "great": .7, "solid": .7, "well made": .7, "comfortable": .5, "good": .5,
        "works": .5, "worth": .6, "worth it": .7, "recommend": .6, "easy": .5, "happy": .5,
        "satisfied": .5, "glad": .5, "decent": .3, "fine": .3, "okay": .3, "roomy": .5, "stable": .6}
_NEG_LEX = {"terrible": .9, "broke": .9, "snapped": .9, "useless": .9, "garbage": .9, "broken": .8,
            "defective": .8, "junk": .8, "waste": .8, "fell apart": .8, "flimsy": .7, "cheap": .7,
            "damaged": .7, "overpriced": .7, "ripped": .7, "wore out": .7, "poor": .6, "wobbly": .6,
            "tore": .6, "crushed": .6, "not worth": .7, "bad": .5, "loud": .5, "noisy": .5,
            "uncomfortable": .6, "stopped": .6, "drains": .5, "shallow": .5, "stuck": .5, "jammed": .5,
            "returned": .5, "refund": .4, "thin": .4, "hard": .3, "tips over": .7, "sinks": .6}
_LEX = {w: s for w, s in _POS.items()}
_LEX.update({w: -s for w, s in _NEG_LEX.items()})
_PHRASES = sorted([w for w in _LEX if " " in w], key=len, reverse=True)

# 隐式方面提示（无显式方面词时，由观点词反查类目）
_IMPLICIT = {
    "broke": "DURABILITY", "broken": "DURABILITY", "snapped": "DURABILITY", "flimsy": "DURABILITY",
    "fell apart": "DURABILITY", "wore out": "DURABILITY", "durable": "DURABILITY", "sturdy": "DURABILITY",
    "wobbly": "DURABILITY", "tips over": "FUNCTIONALITY", "sinks": "FUNCTIONALITY", "stable": "DURABILITY",
    "comfortable": "QUALITY", "uncomfortable": "QUALITY", "shallow": "SIZE", "thin": "QUALITY",
    "loud": "SMELL_NOISE", "noisy": "SMELL_NOISE", "overpriced": "PRICE", "cheap": "PRICE",
    "worth": "PRICE", "worth it": "PRICE", "works": "FUNCTIONALITY", "stopped": "FUNCTIONALITY",
    "damaged": "SHIPPING", "crushed": "SHIPPING", "ripped": "QUALITY", "tore": "QUALITY",
}
_RETURN_RISK_CATS = {"DURABILITY", "QUALITY", "SIZE", "COMPATIBILITY"}
_SRC_CONF = [("sp_api", "High"), ("keepa", "High"), ("dataforseo", "Medium"), ("brightdata", "Medium"),
             ("卖家精灵", "Medium"), ("oxylabs", "Medium"), ("helium", "Low"), ("apify", "Low")]
_SRC_W = {"High": 1.0, "Medium": 0.85, "Low": 0.0}
_SRC_F = {"High": 1.0, "Medium": 0.7, "Low": 0.4}

_SENT_SPLIT = re.compile(r"[.!?…\n]+")
_CONTRAST_RE = re.compile(r"\b(but|however|though|although|while|whereas)\b", re.I)
_TOK = re.compile(r"[a-z0-9']+")


@lru_cache(maxsize=1)
def _resources():
    sch = load("review-labeling-schema")
    absa = absa_taxonomy()
    # 方面识别：canonical 同义词 + 原 12 类 seeds → (term, category)
    aspect_terms = []  # (surface, category)
    for c in sch["aspect"].get("canonicalization", []):
        for s in c.get("synonyms", []):
            aspect_terms.append((s.lower(), c["category"]))
    for cat, meta in absa.get("aspect_categories", {}).items():
        for s in meta.get("seeds", []):
            aspect_terms.append((s.lower(), cat))
    aspect_terms.sort(key=lambda x: len(x[0]), reverse=True)
    scope = sch["aspect"].get("scope_rules", {})
    # 标签维度正则
    dims = {}
    for dim, meta in sch["labels"].items():
        pats = {}
        for k, p in (meta.get("patterns") or {}).items():
            try:
                pats[k] = re.compile(p, re.I)
            except re.error:
                pass
        dims[dim] = {"values": meta.get("values", []), "pats": pats}
    return aspect_terms, scope, dims


# ---- 反讽最小处理（高精度低召回）------------------------------------------
_IRONY = [re.compile(r"\bgreat[, ]+if you (?:enjoy|like|want)\b", re.I),
          re.compile(r"\bperfect for (?:when|if) you\b", re.I),
          re.compile(r"\blove how it (?:breaks|fails|stops|falls)\b", re.I),
          re.compile(r"\byeah right\b", re.I)]


def _tokens(s):
    return _TOK.findall(s.lower())


def _clauses(text):
    out = []
    for si, sent in enumerate(s for s in _SENT_SPLIT.split(text) if s.strip()):
        parts = [p.strip() for p in _CONTRAST_RE.split(sent)
                 if p.strip() and p.lower() not in _CONTRAST]
        for ci, c in enumerate(parts):
            out.append((si, c, ci > 0))
    return out


def _find_opinions(clause_l, toks):
    """返回 [(term, base, tok_idx)]，先短语后单词。"""
    found, used = [], set()
    for ph in _PHRASES:
        if ph in clause_l:
            first = ph.split()[0]
            idx = toks.index(first) if first in toks else 0
            found.append((ph, _LEX[ph], idx))
            used.update(ph.split())
    for i, t in enumerate(toks):
        if t in _LEX and t not in used:
            found.append((t, _LEX[t], i))
    return found


def _find_aspects(clause_l, toks, aspect_terms):
    """返回 [(term, category, tok_idx)]。"""
    res = []
    for surf, cat in aspect_terms:
        if surf in clause_l:
            first = surf.split()[0]
            idx = toks.index(first) if first in toks else 0
            res.append((surf, cat, idx))
    return res


def _score_opinion(term, base, idx, toks, ironic):
    win = toks[max(0, idx - 4):idx]
    negc = sum(1 for w in win if w in _NEG or w.endswith("nt"))
    negf = -0.8 if negc % 2 == 1 else 1.0
    pre = toks[max(0, idx - 2):idx]
    intf = max((_INTENS[w] for w in pre if w in _INTENS), default=1.0)
    if idx > 0 and toks[idx - 1] == "too":       # too+形容词 强制负向
        base = -abs(base); intf = max(intf, 1.2)
    ironyf = -1.0 if ironic else 1.0
    return max(-1.0, min(1.0, base * negf * intf * ironyf))


def extract_quads(rev, product_cats):
    aspect_terms, scope, _ = _resources()
    body = rev["body"]
    quads = []
    for si, clause, after_contrast in _clauses(body):
        cl = clause.lower()
        toks = _tokens(clause)
        ironic = any(p.search(clause) for p in _IRONY)
        ops = _find_opinions(cl, toks)
        asp = _find_aspects(cl, toks, aspect_terms)
        for term, base, oidx in ops:
            score = _score_opinion(term, base, oidx, toks, ironic)
            pol = "pos" if score > 0.15 else "neg" if score < -0.15 else "neu"
            # 就近配对
            if asp:
                a_surf, cat, aidx = min(asp, key=lambda a: abs(a[2] - oidx))
                dist = abs(aidx - oidx); implicit = False
            else:
                cat = _IMPLICIT.get(term, "OVERALL"); a_surf = None
                dist = 0; implicit = cat == "OVERALL"
            scope_ok = cat not in scope or bool(set(scope[cat]) & set(product_cats))
            # confidence
            f_ext = 1.0 if (a_surf and not implicit) else 0.6
            f_pair = 1.0 / (1 + dist / 5) if asp else 0.5
            f_lex = abs(base)
            f_src = _SRC_F.get(_src_level(rev.get("source")), 0.4)
            pen = (0.15 if ironic else 0) + (0.20 if not scope_ok else 0) + (0.15 if cat == "OVERALL" else 0)
            conf = max(0.0, min(1.0, 0.30 * f_ext + 0.25 * f_pair + 0.20 * f_lex + 0.25 * f_src - pen))
            quads.append({
                "sentence_idx": si, "aspect_term": a_surf, "aspect_category": cat,
                "opinion_term": term, "polarity": pol, "polarity_score": round(score, 3),
                "confidence": round(conf, 3), "aspect_is_implicit": implicit,
                "aspect_category_scope_ok": scope_ok, "is_ironic": ironic,
                "signals_return_risk": cat in _RETURN_RISK_CATS and pol == "neg",
                "extractor": "rule_v1",
            })
    return quads


# ---- 多维标签 --------------------------------------------------------------
def label_dims(body):
    _, _, dims = _resources()
    out = {}
    for dim, d in dims.items():
        hits = [v for v, p in d["pats"].items() if p.search(body)]
        # 单值维度取首个命中，多值维度返回列表
        if dim in ("intent", "competitor", "severity", "emotion"):
            out[dim] = hits[0] if hits else ("none" if dim in ("severity", "competitor") else None)
        else:
            out[dim] = hits
    # 严重度放大：returned/refund → deal_breaker
    if re.search(r"\breturn(?:ed|ing)?\b|\brefund\b|do(?:n'?t| not) buy|never again", body, re.I):
        out["severity"] = "deal_breaker"
    return out


# ---- 可信度加权 ------------------------------------------------------------
def _src_level(src):
    s = (src or "").lower()
    for pre, lvl in _SRC_CONF:
        if pre.lower() in s:
            return lvl
    return "Low"


def _spam_flags(rev, quads, seen_bodies):
    flags = {}
    body = rev["body"].strip().lower()
    key = (rev.get("asin"), re.sub(r"\s+", " ", body)[:120])
    if key in seen_bodies:
        flags["is_duplicate"] = True
    seen_bodies.add(key)
    tok = _tokens(body)
    if rev.get("rating") in (1, 5) and len(tok) < 8 and not any(q["aspect_category"] != "OVERALL" for q in quads):
        flags["extreme_star_no_detail"] = True
    if re.search(r"received (?:this|a|an|the)?\s*(?:free|discount|for free)|in exchange for", body):
        flags["incentivized"] = True
    if re.search(r"\bvine\b", body):
        flags["vine"] = True
    return flags


def _trust(rev, quads, seen_bodies, max_date):
    lvl = _src_level(rev.get("source"))
    w_source = _SRC_W[lvl]
    w_verified = 1.0 if rev.get("verified") else 0.55
    age = _age_days(rev.get("date"), max_date)
    w_recency = max(0.25, 0.5 ** (age / 540))
    tok = len(_tokens(rev["body"]))
    has_aspect = any(q["aspect_category"] != "OVERALL" for q in quads)
    w_length = max(0.4, min(1.15, 0.4 + 0.6 * math.tanh(tok / 40) + 0.15 * (1 if has_aspect else 0)))
    hv = rev.get("helpful_votes") or 0
    w_helpful = 1 + 0.30 * math.log10(1 + hv)
    avg_pol = statistics.mean([q["polarity_score"] for q in quads]) if quads else 0.0
    rat = rev.get("rating")
    consistent = rat is None or abs(avg_pol) < 0.15 or (_sign(rat - 3) == _sign(avg_pol))
    w_consistency = 1.0 if consistent else 0.7
    flags = _spam_flags(rev, quads, seen_bodies)
    w_spam = 1.0
    for f in flags:
        w_spam *= {"is_duplicate": 0.2, "extreme_star_no_detail": 0.3, "incentivized": 0.15, "vine": 0.6}.get(f, 1.0)
    ew = max(0.0, min(3.0, w_source * w_verified * w_recency * w_length * w_helpful * w_consistency * w_spam))
    in_rollup = lvl != "Low" and not flags.get("is_duplicate") and ew > 0
    return {
        "source_conf_level": lvl, "evidence_weight": round(ew, 3), "in_quant_rollup": in_rollup,
        "spam_flags": list(flags.keys()),
        "factor_scores": {"w_source": round(w_source, 2), "w_verified": w_verified,
                          "w_recency": round(w_recency, 2), "w_length": round(w_length, 2),
                          "w_helpful": round(w_helpful, 2), "w_consistency": w_consistency,
                          "w_spam": round(w_spam, 2)},
    }


def _sign(x):
    return (x > 0) - (x < 0)


def _age_days(d, max_date):
    if not d:
        return 90
    try:
        dd = datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
        return max(0, (max_date - dd).days)
    except ValueError:
        return 90


# ---- 主流程 ----------------------------------------------------------------
def label_reviews(reviews, product_cats=("furniture", "outdoor", "home")):
    dates = [datetime.strptime(str(r["date"])[:10], "%Y-%m-%d").date()
             for r in reviews if r.get("date")]
    max_date = max(dates) if dates else date.today()
    seen = set()
    out = []
    for r in reviews:
        quads = extract_quads(r, product_cats)
        labels = label_dims(r["body"])
        trust = _trust(r, quads, seen, max_date)
        out.append({**r, "quadruples": quads, "labels": labels, "trust": trust,
                    "date": str(r.get("date") or "")})
    return out


# ---- Gold 聚合（7 表，加权）------------------------------------------------
def _wstats(pairs):
    """pairs=[(polarity_score, weight, is_neg, is_pos, return_risk)] → 加权指标。"""
    W = sum(p[1] for p in pairs) or 1e-9
    avg = sum(p[0] * p[1] for p in pairs) / W
    negr = sum(p[1] for p in pairs if p[2]) / W
    posr = sum(p[1] for p in pairs if p[3]) / W
    rrr = sum(p[1] for p in pairs if p[4]) / W
    disp = statistics.pstdev([p[0] for p in pairs]) if len(pairs) > 1 else 0.0
    return round(avg, 3), round(negr, 3), round(posr, 3), round(rrr, 3), round(disp, 3), round(W, 2)


def gold_tables(labeled):
    # 展开到 (asin, cat) 加权样本
    cell = defaultdict(list)          # (asin,cat) -> pairs
    cat_rating = defaultdict(list)    # cat -> [(review_avg_pol_for_cat, rating)]
    usecase = defaultdict(list)       # (jtbd,cat) -> pairs
    for r in labeled:
        if not r["trust"]["in_quant_rollup"]:
            continue
        w = r["trust"]["evidence_weight"]
        jtbds = r["labels"].get("use_case_jtbd") or []
        per_cat = defaultdict(list)
        for q in r["quadruples"]:
            if q["aspect_category"] == "OVERALL" or q["confidence"] < 0.35:
                continue
            c = q["aspect_category"]
            pair = (q["polarity_score"], w, q["polarity"] == "neg", q["polarity"] == "pos", q["signals_return_risk"])
            cell[(r["asin"], c)].append(pair)
            per_cat[c].append(q["polarity_score"])
            for jt in jtbds:
                usecase[(jt, c)].append(pair)
        if r.get("rating") is not None:
            for c, ps in per_cat.items():
                cat_rating[c].append((statistics.mean(ps), r["rating"]))

    # 1) 加权 rollup
    rollup = []
    for (asin, c), pairs in cell.items():
        avg, negr, posr, rrr, disp, eff = _wstats(pairs)
        rollup.append({"asin": asin, "aspect_category": c, "window": "all_time",
                       "mention_count": len(pairs), "eff_mention": eff,
                       "avg_polarity_w": avg, "neg_ratio_w": negr, "pos_ratio_w": posr,
                       "polarity_dispersion": disp, "return_risk_rate": rrr})

    # 2) 方面重要度（与星级弹性 = Pearson 相关）
    importance = []
    total_mentions = sum(len(v) for v in cell.values()) or 1
    cat_mentions = defaultdict(int)
    for (asin, c), pairs in cell.items():
        cat_mentions[c] += len(pairs)
    for c, pts in cat_rating.items():
        elast = _pearson([p[0] for p in pts], [p[1] for p in pts])
        share = cat_mentions[c] / total_mentions
        importance.append({"aspect_category": c, "mention_share": round(share, 3),
                           "rating_elasticity": round(elast, 3),
                           "importance_score": round(share * abs(elast), 3),
                           "role": "hygiene" if elast >= 0 and _cat_neg(cell, c) > 0.4 else
                                   "delighter" if elast > 0.3 else "performance"})
    importance.sort(key=lambda x: -x["importance_score"])

    # 3) 机会白空间排序（高负面×高提及×退货风险）
    opp = []
    for (asin, c), pairs in cell.items():
        avg, negr, posr, rrr, disp, eff = _wstats(pairs)
        pain = negr * eff
        opp_score = round(pain * (1 + rrr) * math.log1p(len(pairs)), 3)
        if negr >= 0.3:
            opp.append({"asin": asin, "target": c, "pain_frequency": round(pain, 3),
                        "neg_ratio_w": negr, "return_risk_rate": rrr,
                        "mention": len(pairs), "opportunity_score": opp_score})
    opp.sort(key=lambda x: -x["opportunity_score"])
    for i, o in enumerate(opp, 1):
        o["rank"] = i

    # 4) Kano 分类
    kano = []
    for c in cat_mentions:
        pos = sum(1 for (a, cc), pairs in cell.items() if cc == c for p in pairs if p[3])
        neg = sum(1 for (a, cc), pairs in cell.items() if cc == c for p in pairs if p[2])
        tot = pos + neg or 1
        posr, negr = pos / tot, neg / tot
        klass = ("must_have" if negr > 0.55 and posr < 0.3 else
                 "delighter" if posr > 0.6 and negr < 0.2 else "performance")
        kano.append({"aspect_category": c, "pos_share": round(posr, 3), "neg_share": round(negr, 3),
                     "kano_class": klass})

    # 5) 用途×方面矩阵
    matrix = []
    for (jt, c), pairs in usecase.items():
        avg, negr, posr, rrr, disp, eff = _wstats(pairs)
        matrix.append({"jtbd": jt, "aspect_category": c, "cell_mention": len(pairs),
                       "cell_neg_ratio": negr, "whitespace_flag": negr >= 0.5 and len(pairs) >= 1})

    # 6) 竞品 gap（每 asin vs 其余 asin 池，同方面）
    by_cat = defaultdict(lambda: defaultdict(list))   # cat -> asin -> pairs
    for (asin, c), pairs in cell.items():
        by_cat[c][asin] = pairs
    gap = []
    for c, amap in by_cat.items():
        if len(amap) < 2:
            continue
        for asin, pairs in amap.items():
            mine = _wstats(pairs)[0]
            others = [p for a2, ps in amap.items() if a2 != asin for p in ps]
            comp = _wstats(others)[0] if others else 0.0
            gap.append({"asin": asin, "aspect_category": c, "my_avg_polarity_w": mine,
                        "comp_avg_polarity_w": comp, "gap": round(mine - comp, 3)})

    # neg_aspect_top5（保留，喂 MIND_DECODE）
    neg_top5 = defaultdict(list)
    for (asin, c), pairs in cell.items():
        _, negr, _, rrr, _, eff = _wstats(pairs)
        neg_top5[asin].append({"aspect": c, "neg_ratio_w": negr, "return_risk": rrr, "eff_mention": eff})
    for asin in neg_top5:
        neg_top5[asin] = sorted(neg_top5[asin], key=lambda x: (-x["neg_ratio_w"], -x["eff_mention"]))[:5]

    return {
        "gold_asin_aspect_rollup_weighted": rollup,
        "gold_aspect_importance": importance,
        "gold_opportunity_whitespace_rank": opp,
        "gold_kano_classification": kano,
        "gold_usecase_aspect_matrix": matrix,
        "gold_competitor_gap": gap,
        "neg_aspect_top5": dict(neg_top5),
    }


def _cat_neg(cell, c):
    pairs = [p for (a, cc), ps in cell.items() if cc == c for p in ps]
    if not pairs:
        return 0.0
    return sum(1 for p in pairs if p[2]) / len(pairs)


def _pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return num / (dx * dy) if dx and dy else 0.0
