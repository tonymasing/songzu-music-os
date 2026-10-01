# Local DAW fonts

Noto Sans TC (100–900) and Oxanium (200–800), obtained from the Google Fonts upstream files recorded in `sources.json`. The source TTF files were repackaged to WOFF2 with FontTools and the already-installed Node Brotli encoder; no glyph subsetting or outline changes. Full OFL licenses accompany the files. The app loads these assets locally through `src/app/daw-typography.css`; no runtime Google Fonts request.

Font source archives and reproducible packaging script: `output/theme-cyberpunk-2026-09-24/typography-20260925-221202/`. See `docs/daw-typography.md` for roles, token values, fallback chains and verification.
