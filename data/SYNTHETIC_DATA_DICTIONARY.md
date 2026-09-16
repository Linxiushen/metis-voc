# Synthetic fixture data

This directory contains fictional software fixtures. They are not a market dataset,
customer reviews, company records, or evidence for a purchasing decision. The original
research excerpts and identities are excluded from this open-source copy.

`node data/generate-fixtures.mjs` regenerates the three VOC fixture datasets and
normalizes the presentation fixtures. It makes no network requests. Files under
`public/data/` are public mirrors; never place private data there.

| File group | Runtime purpose | Evidence status |
| --- | --- | --- |
| `chair_report.json`, `ext_report.json` | Preserve report module, table, and chart shapes | Synthetic values; each module has `fixture_provenance` |
| `ext_meta.json`, `voc_gold_meta.json` | Labels, navigation, and subsection contracts | Schema metadata, not collected data |
| `voc_gold.json` | VOC chart shape examples | Synthetic fixture |
| `voc_*_2026-08-01.json` | Legacy filenames retained for import compatibility | Completely replaced fictional source records |
| `public/data/mod/*.json` | Individually loadable report module fixtures | Exact module copies of `chair_report.json` |

VOC records preserve `id`, `channel`, `product`, `rating`, `ratingCount`, `reviewCount`,
`observed`, `url`, and `signals`. Signal records preserve polarity, theme, illustrative
text, and an illustrative product action. `synthetic: true` and
`source_mode: synthetic_fixture` explicitly identify fictional records. Real rating
and review counts are zero. Dates are placeholders; `example.com` links are reserved
examples and must never be treated as verified source URLs. Stable `VOC-*` IDs are
fixture relations, not external customer identities.

The inline records in `lib/voc-evidence.ts` are also newly authored fictional examples.
The builder returns `template_demo` and `insufficient_evidence`; a rendered table or
passing schema check does not turn these fixtures into market evidence.

Data supplier API access and a public webpage do not automatically permit dataset
redistribution. Integrators must obtain appropriate rights before publishing their
own review text, product imagery, licensed exports, or personal data. The repository
license covers the original fixture implementation and text subject to the root
license; it does not grant rights to outside providers' datasets or trademarks.
