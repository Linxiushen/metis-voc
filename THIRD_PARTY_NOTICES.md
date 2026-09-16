# Third-party notices and data rights

The MIT license covers original project code, original documentation, original synthetic fixture text and the SVG illustrations authored for this release. It does not relicense dependencies, trademarks, external websites, API responses, reviews, product photography or other third-party material.

## Software

The lockfile is the authoritative dependency inventory. Dependencies remain under their own licenses. React/Next.js and Preact use MIT; htm and Drizzle use Apache-2.0. The `xlsx` dependency resolves to the third-party npm repackaging `@e965/xlsx@0.20.3`, with Apache-2.0 metadata; it is not an official upstream npm release. Installations retain package-level license files. Generated vendor bundles are built from these packages and are not distributed in the source archive.

Inspect package licenses before redistributing a compiled deployment. Updates can change the dependency inventory; this document is not a substitute for the actual package notices.

Transitive tool/runtime packages also include MPL-2.0 components (for example satori, @vercel/og, @resvg/resvg-wasm, lightningcss and axe-core), CC-BY-4.0 data (caniuse-lite), and libvips native binaries with LGPL terms alongside sharp's Apache-2.0 license. If distributing binaries or modified dependencies, preserve applicable attribution, notices and source/relinking rights. This source release does not bundle node_modules or native binaries.

## Data and images

Original production databases, account credentials, private reports, company documents and generated client product images are excluded. Shipped VOC fixture text is newly authored synthetic content and carries explicit synthetic flags. See `data/SYNTHETIC_DATA_DICTIONARY.md`.

Some report templates include historical public market facts, product names and source links to illustrate research provenance. These are not a licensed current market dataset. The release does not certify their accuracy or give users rights to copy linked pages or retrieve third-party content beyond applicable terms.

The included product SVG is a schematic example, not a photorealistic concept render or manufacturing specification. Brand and provider names identify compatible services or cited sources; no sponsorship or endorsement is implied.
