# MEDORO_DISTRIBUTION_PRODUCT_TOUR

Hindi-English (Hinglish) product tour and training videos for **Medoro Distribution**, the pharma wholesale and distribution ERP (https://medoro.in/distribution). Every video is a screen recording of the real application, running on a separate demo server with a fictional distributor, **Medoro Demo Pharma Distributors, Ranchi**. Nothing is a mock-up.

| Folder | Contents |
|---|---|
| `01_…26_*` | One folder per chapter: `Part_NN_….mp4` and its `.srt`. The 12 compilations (`V01_…` to `V12_…`) sit in the folder of one of their chapters, each with a `_chapters.txt` (timestamps). `01_Complete_Product_Tour` holds Part 01 and the full tour (V01). |
| `27_Scripts_Subtitles` | Narration scripts for all 26 parts (Roman Hinglish subtitles + the Devanagari line the voice speaks), every SRT, video titles, descriptions and chapter timestamps |
| `28_Thumbnails` | 1920×1080 thumbnails for the 26 chapters and 12 compilations |
| `29_QA_Report` | Test environment, demo data, bugs found and fixed, feature-status table, recording QA |
| `30_Demo_Data` | What the demo account contains and the script that generated its history through Medoro's own services |

MP4 files are kept in this folder in the session workspace and are not committed to git (see `.gitignore`); everything else is committed.
