# MoonWitness YouTube Channel Operations

> **Channel:** [@moonwitness-xv](https://www.youtube.com/@moonwitness-xv) (UC0Ww2KgIDWGkc5bxjMspecg)
> **Status (2026-11-25):** Branding uploaded, 0 videos, 0 subscribers.
> **TaskOS linkage:** Series `YT`, tasks `YT-001` through `YT-007`.

---

## Channel Identity

| Field | Value |
|-------|-------|
| Handle | `@moonwitness-xv` |
| Display Name | MoonWitness |
| Channel ID | `UC0Ww2KgIDWGkc5bxjMspecg` |
| Description | See **YOUTUBE_CHANNEL_ASSETS.md** (bilingual EN/ID, 1500 chars) |
| Links | GitHub: `github.com/A-L-L-A-H/mw-xv` · Docs: `moonwitness.dev` · Contact: `moonwitness@proton.me` |
| Brand Colors | Cream `#f3efe4`, Ink `#0d0d0d`, Yellow `#ffe031`, Signal Blue `#00b8f0`, Magenta `#ff2e88` |
| Fonts | Anton (display), Space Grotesk (UI), JetBrains Mono (code) |
| Visual Style | Neo-brutalist: hard shadows `3px 3px 0 0 #0d0d0d`, 2px borders, 0.25rem radius |

---

## Reconciliation Table

| Asset | Spec | File in Repo | Status |
|-------|------|--------------|--------|
| Banner | 2560×1440, safe 1546×423 | `moonwitness-youtube-banner.jpg` (1440×810, **wrong size**) | ❌ Needs SVG source |
| Profile | 800×800 circular | `moonwitness-youtube-logo.jpg` (800×800) | ⚠️ JPG only |
| Watermark | 150×150 | `moonwitness-youtube-watermark.jpg` (256×256) | ⚠️ JPG only, wrong size |
| Thumbnail Template | 1280×720 | `moonwitness-youtube-thumbnail-template.jpg` (1280×720) | ⚠️ JPG only |

> **Source of truth for specs:** `YOUTUBE_CHANNEL_ASSETS.md` (repo root).

---

## 8-Episode Content Plan

| Ep | Code | Title | Duration | Core Demo | Thumbnail Text | Status |
|----|------|-------|----------|-----------|----------------|--------|
| Trailer | YT-003 | Channel Trailer | 60s | Brand narrative, terminal + Board | "MoonWitness Channel Trailer — Every model. One board." | 📋 Ready to record |
| 1 | YT-004 | Declarative Models in 5 Minutes | 8-10 min | Define model → install ORM → REST API + Board | "Declarative Models in 5 Min" | 📋 Planned |
| 2 | YT-006 | Addons — Install Features, Not SQL | 8-10 min | `pnpm add @moonwitness/addon-auth @moonwitness/addon-workflow` → Board shows models → uninstall → rollback | "Addons: Install Features, Not SQL" | 📋 Planned |
| 3 | YT-007 | The Board — Your Data, Your Way | 8-10 min | 4 skins (default/compact/high-contrast/riot), dark mode, drag, filters | "The Board: Your Data, Your Way" | 📋 Planned |
| 4 | — | Model→API Live Coding | 15-20 min | Live: new model → server restart → Board | "Model → API in Seconds (Live)" | 📦 Backlog |
| 5 | — | Transactional Addons Deep Dive | 10-12 min | Addon internals, safe rollout patterns | "Transactional Addons: Safe Rollout" | 📦 Backlog |
| 6 | — | Multi-tenancy & RLS | 10-12 min | Company switch, row-level security | "Multi-tenancy in MoonWitness" | 📦 Backlog |
| 7 | — | SaaS Starter in 30 Minutes | 30 min | Full scaffold: auth, billing, admin | "Build SaaS Admin in 30 Min" | 📦 Backlog |

---

## Channel Setup Checklist

| Item | Status | Notes |
|------|--------|-------|
| Banner uploaded | ✅ | Wrong size (1440×810) — replace with 2560×1440 from pipeline |
| Profile photo uploaded | ✅ | Replace with SVG-rendered 800×800 |
| Watermark uploaded | ✅ | Replace with SVG-rendered 150×150 |
| Description (Basic Info tab) | ❌ | ID-only 592 chars — needs bilingual 1500-char EN+ID from `YOUTUBE_CHANNEL_ASSETS.md` |
| GitHub link | ✅ | |
| Contact email | ✅ | |
| Home tab layout | ❌ | Requires ≥1 video (YT-005 / SM-028) |
| Playlists created | ❌ | "MoonWitness Tutorials" (SM-022) |
| Featured video set | ❌ | Trailer (SM-016) |

---

## TaskOS Linkage

| Task | Series | Horizon | Title | Blocks | Depends On |
|------|--------|---------|-------|--------|------------|
| YT-001 | YT | now | Setup channel branding & assets (banner, logo, watermark, description) | YT-002, YT-003, SM-015 | — |
| YT-002 | YT | now | Publish full bilingual channel description (EN + ID) on Basic Info tab | — | YT-001 |
| YT-003 | YT | now | Record & upload channel trailer (60s) + custom thumbnail | YT-004, YT-005, SM-016, SM-022, SM-028 | YT-001, SM-016 |
| YT-004 | YT | next | Record Episode 1: Declarative Models in 5 Minutes | YT-005, YT-006, SM-024, SM-028 | YT-003, SM-022 |
| YT-005 | YT | next | Configure Home tab layout (Videos, Shorts, Playlists sections) | — | YT-003, YT-004, SM-016, SM-022 |
| YT-006 | YT | next | Record Episode 2: Addons — Install Features, Not SQL | YT-007, SM-026 | YT-004, SM-022 |
| YT-007 | YT | next | Record Episode 3: The Board — Your Data, Your Way | — | YT-006, SM-024 |

> **Note:** `SM-016` and `SM-022` are Social Media counterparts for the same physical work (trailer, Episode 1). They exist in separate series to track platform-specific derivatives (X thread, LinkedIn carousel, Shorts, etc.).

---

## YouTube Studio Manual Steps (Headless Blockers)

The following operations **cannot** be automated via headless browser due to YouTube Studio restrictions:

1. **Basic Info → Description** — paste bilingual EN/ID text manually.
2. **Customization → Home tab** — add/remove sections via drag-and-drop UI.
3. **Video upload → End screen** — add Subscribe + GitHub link elements.
4. **Video upload → Tags** — add 15+ comma-separated tags per video.
5. **Video upload → Chapters** — set timestamps from description.

**Workaround:** Document each as a human-gated TaskOS task (`human: true`) with step-by-step checklist in `acceptanceCriteria`. Use `YOUTUBE_CHANNEL_ASSETS.md` as the copy-paste source.

---

## Trailer Script (from YOUTUBE_CHANNEL_ASSETS.md)

```
0-5s    Hook: "Every model. One board." — animated logo reveal
5-15s   Problem: SQL migrations, boilerplate, fragmented admin
15-35s  Solution: Declarative TypeScript model → REST + GraphQL + Board
35-50s  Demo: `pnpm add @moonwitness/orm @moonwitness/addon-auth` → Board shows Users, Roles, Sessions
50-60s  CTA: Subscribe · GitHub · moonwitness.dev
```

- Language: Indonesian voiceover + English subtitles (or bilingual audio track)
- Format: 1080p/30fps, H.264, AAC
- Thumbnail: From `SM-003` pipeline (`moonwitness-youtube-thumbnail-template.svg` with `{{EPISODE_TITLE}}` = "Channel Trailer")
- End screen: 20s — Subscribe button + GitHub link card

---

## Episode Production Checklist (per episode)

1. **Pre-record**: Outline in `YOUTUBE_CHANNEL_ASSETS.md` episode table
2. **Record**: Terminal (model def, addon install) + Board (skins, drag, filters) via OBS/Playwright
3. **Voiceover**: ID/EN bilingual
4. **Edit**: Cut to target duration, add chapters/timestamps
5. **Thumbnail**: Generate via `SM-003` pipeline
6. **Upload**: Set title, description (with timestamps, repo link), tags, end screen, playlist
7. **Derivatives**: Trigger `SM-023`/`SM-025`/`SM-027` for platform-native content

---

## Related Files

- `YOUTUBE_CHANNEL_ASSETS.md` — asset specs, bilingual description, thumbnail texts, trailer script
- `docs/operations/social-media-grand-plan.md` — full multi-platform strategy
- `scripts/tasks/sources/yt-tasks.mjs` — TaskOS source definitions
- `scripts/tasks/sources/sm-tasks.mjs` — Social Media derivative tasks
- `packages/assets/scripts/render-youtube-thumbnails.mjs` — (to be created) thumbnail generator

---

*Last updated: 2026-11-25. This document is the operational reference for YouTube channel management.*