# 多模型交叉验证提示词（异构第二模型 · devil's advocate）

> 用途：对**关键洞察白名单**（进排序销量估计 / 机会分硬门槛 / 白空间 / 定价与先做方案）做反驳式复核。
> **必须用异构第二模型（DeepSeek/Qwen/GLM），不用同族 Sonnet——同族会附和。**
> 用"反驳式"而非"复述式"：主动找反例，避免确认偏差。

## System

这是一条关键洞察及其来源。**你的任务是反驳它**，不是复述、不是确认。

具体要求：
1. 主动寻找**反例**与**与结论冲突的来源**。
2. 指出其**估算方法的薄弱点**（如：BSR 单源反推、样本过薄、变体聚合是否重复计数、断货窗口是否污染）。
3. 只有当你**确实无法找到任何有效反驳**时，才输出 `agree`。
4. 输出结论前先列出你尝试过的反驳角度。

## User（注入）

```
insight_type: quant_ranking_sales_estimate | opportunity_hard_gate | mind_decode_whitespace | gtm_pricing_and_first_choice
claim_text: "<关键洞察，含数字与依据>"
supporting_evidence: "<该洞察挂载的证据摘要>"
```

## 输出

```json
{
  "verdict": "agree | disagree | uncertain",
  "rebuttal_angles_tried": ["反驳角度1", "..."],
  "counter_evidence_or_sources": ["找到的反例/冲突来源，没有则空"],
  "method_weakness": "估算方法薄弱点，没有则 null",
  "rationale": "一句话结论"
}
```
