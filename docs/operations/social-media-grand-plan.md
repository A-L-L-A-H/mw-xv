# MoonWitness Social Media Grand Plan

> **Status (2026-11-25):** Synthesized from multi-agent audit (brand-assets, automation, content-sources, platform-research). TaskOS series `SM` will be registered in `docs/tasks/tasks.json`.

---

## Executive Summary

MoonWitness has a **strong technical foundation** and **complete brand asset system** but **zero social presence beyond GitHub + npm**. The YouTube channel (@moonwitness-xv) has branding but 0 videos. This plan establishes a multi-platform presence across **owned channels** (docs site, Discord, newsletter) and **distribution platforms** (X/Twitter, LinkedIn, Dev.to, Bluesky, Instagram, TikTok) with a **content repurposing framework** that turns each YouTube episode into 5+ platform-native derivatives.

---

## Platform Strategy Matrix

| Platform | Role | Priority | Format | Audience | Status |
|----------|------|----------|--------|----------|--------|
| **YouTube** | Anchor (long-form tutorials) | P0 | 8-15 min horizontal | Developers, SaaS builders | Branding done, 0 videos |
| **X/Twitter** | Discovery + threads | P0 | Threads, short video, GIFs | Dev community, technical founders | Not created |
| **LinkedIn** | Professional credibility | P1 | Carousels, articles, short video | Technical founders, hiring managers | Not created |
| **Dev.to / Hashnode** | SEO + deep-dive articles | P1 | Long-form technical articles | Developers searching solutions | Not created |
| **Bluesky** | Early adopter dev community | P1 | Threads, short video | Dev community | Not created |
| **Instagram / Threads** | Visual brand + Reels | P2 | Reels (9:16), carousels | Visual learners, younger devs | Not created |
| **TikTok** | Viral discovery | P2 | Short-form (9:16), trends | Broad dev audience | Not created |
| **Discord** | Community hub | P0 | Real-time chat, announcements | Power users, contributors | "Coming soon" only |
| **GitHub Discussions** | Technical Q&A | P0 | Threaded discussions | Developers using the product | Not enabled |
| **Newsletter** | Owned audience | P1 | Monthly digest + launch emails | Subscribers | Not created |
| **Docs Site (GitHub Pages)** | SEO + reference | P0 | Static site | Developers evaluating | M6.06/M6.07 pending |

---

## Content Repurposing Framework

**Core Principle:** Every YouTube episode → 5 platform-native derivatives

| YouTube Episode | X/Twitter Thread | LinkedIn Carousel | Dev.to Article | Shorts/Reels (2-3) | Newsletter Section |
|-----------------|------------------|-------------------|----------------|---------------------|-------------------|
| Trailer (60s) | "5 things MoonWitness eliminates" | — | "Why we built MoonWitness" | 3 vertical cuts | Launch announcement |
| Ep 1: Declarative Models | Thread: model→API in 5 min | Carousel: SQL vs declarative | "Declarative models in 5 min" | Model demo + Board reveal | Episode recap |
| Ep 2: Addons | Thread: install features not SQL | Carousel: addon anatomy | "Transactional addons deep dive" | Addon install + rollback | Episode recap |
| Ep 3: The Board | Thread: 4 skins demo | Carousel: skin comparison | "Data-driven admin UI" | Skin switch + drag demo | Episode recap |
| Ep 4: Model→API Live | Thread: live coding highlights | — | "From model to API in seconds" | Terminal→Board flow | Episode recap |
| Ep 5: Transactional Addons | Thread: safe rollout patterns | Carousel: rollback visualization | "Safe feature rollout" | Rollback demo | Episode recap |
| Ep 6: Multi-tenancy | Thread: RLS patterns | Carousel: tenant architecture | "Multi-tenancy in MoonWitness" | Company switch demo | Episode recap |
| Ep 7: SaaS Starter 30min | Thread: 30-min breakdown | Carousel: starter kit components | "Build SaaS admin in 30 min" | Key moments montage | Episode recap |

---

## Visual Asset Requirements by Platform

| Platform | Format | Dimensions | Source | Automation Status |
|----------|--------|------------|--------|-------------------|
| YouTube Banner | Channel art | 2560×1440 (safe 1546×423) | SVG template needed | ❌ JPG only, wrong size |
| YouTube Thumbnail | Video thumb | 1280×720 | SVG template needed | ❌ JPG template only |
| YouTube Profile | Avatar | 800×800 circular | SVG source needed | ❌ JPG only |
| YouTube Watermark | Branding | 150×150 | SVG source needed | ❌ JPG only |
| OG Social Card | Link preview | 1200×630 | social-card.svg | ✅ Rendered |
| X/Twitter Header | Profile banner | 1500×500 | SVG template needed | ❌ |
| X/Twitter Post | Single image | 1600×900 (16:9) | Template needed | ❌ |
| LinkedIn Post | Feed image | 1128×191 (1.91:1) | Template needed | ❌ |
| LinkedIn Carousel | Multi-page | 1080×1080 (square) | Template needed | ❌ |
| Instagram Square | Feed post | 1080×1080 | Template needed | ❌ |
| Instagram Reels | Vertical video | 1080×1920 (9:16) | Template needed | ❌ |
| TikTok | Vertical video | 1080×1920 (9:16) | Template needed | ❌ |
| Bluesky Post | Feed image | 1600×900 | Template needed | ❌ |
| Dev.to Cover | Article header | 1000×420 | Template needed | ❌ |
| GitHub Social | Repo preview | 1280×640 | Template needed | ❌ |

---

## Automation Pipeline Needed

### 1. Multi-Format Render Pipeline (`render-social.mjs` extension)
- CLI flags: `--format og|instagram-square|instagram-story|x-header|linkedin|github|youtube-banner|youtube-thumbnail|youtube-profile`
- Template variable injection: `{{TITLE}}`, `{{EPISODE}}`, `{{LANG}}`, `{{SKIN}}`
- Batch rendering to `packages/assets/brand/rendered/`
- Light/dark mode variants for all formats

### 2. YouTube Thumbnail Generator
- Base SVG: `moonwitness-youtube-thumbnail-base.svg` with `{{EPISODE_TITLE}}` placeholder
- Script: `render-youtube-thumbnails.mjs` reads episode table from `YOUTUBE_CHANNEL_ASSETS.md`
- Outputs 8 episode thumbnails as PNG

### 3. Social Format Contact Sheet
- Extend `generate-contact-sheets.mjs` with brand group
- Render at each target dimension with safe-area overlays
- Output to `docs/design/assets/social-formats/`

### 4. CI Validation (`validate-social-assets.mjs`)
- Dimension validation against platform specs
- Brand color compliance (tokens.css)
- SVG optimization (svgo)
- PNG compression
- Completeness matrix as JSON for CI gate

### 5. Content Calendar System
- Notion/Airtable or GitHub Project tracking
- Map each YT episode → 5 derivatives + schedule
- Track status: planned → in-progress → review → published
- Cross-platform scheduling coordination

---

## Channel Setup Checklist (Owned Channels)

| Channel | Setup Tasks | Dependencies |
|---------|-------------|--------------|
| **GitHub Pages Docs** | M6.06 (build), M6.07 (deploy) | ROADMAP.md items |
| **Discord Server** | Create server, roles, channels, invite link | Add to video descriptions |
| **GitHub Discussions** | Enable in repo settings | Announce in first video |
| **Newsletter** | Provider (Buttondown/ConvertKit), signup form on docs | First issue: launch announcement |
| **X/Twitter @moonwitness_xv** | Create account, profile, pinned thread | Launch thread for 1.0.0-rc.1 |
| **LinkedIn Page** | Create company page, banner, description | Carousel template ready |
| **Bluesky** | Create handle, profile | Cross-post from X |
| **Dev.to / Hashnode** | Create accounts, connect GitHub | First article from Ep 1 |
| **Instagram / Threads** | Create business account | Reels template ready |
| **TikTok** | Create account | Shorts template ready |

---

## Phased Rollout Plan

### Phase 0: Foundation (Week 1-2) — **Blockers for everything**
- [ ] SM-001: Create source SVGs for all YouTube assets
- [ ] SM-002: Extend render-social.mjs with multi-format CLI
- [ ] SM-003: Build YouTube thumbnail generator
- [ ] SM-004: Add social-format contact sheet
- [ ] SM-005: Add CI validation for social assets
- [ ] SM-006: Create dark-mode variants for all social templates
- [ ] SM-007: Document social asset pipeline

### Phase 1: Owned Channels (Week 2-3) — **Distribution foundation**
- [ ] SM-008: Publish docs site to GitHub Pages (M6.07)
- [ ] SM-009: Set up Discord server + GitHub Discussions
- [ ] SM-010: Set up newsletter provider + signup form
- [ ] SM-011: Create X/Twitter account @moonwitness_xv
- [ ] SM-012: Create LinkedIn company page
- [ ] SM-013: Create Bluesky account
- [ ] SM-014: Enable GitHub Discussions on repo

### Phase 2: Launch Content (Week 3-4) — **First impression**
- [ ] SM-015: Publish full bilingual channel description (YT-002)
- [ ] SM-016: Record & upload channel trailer (YT-003)
- [ ] SM-017: Write launch thread for 1.0.0-rc.1 (X + LinkedIn + Dev.to)
- [ ] SM-018: Create Shorts from trailer (3 vertical cuts)
- [ ] SM-019: LinkedIn carousel: "From SQL migration to addon install"
- [ ] SM-020: Dev.to article: "Building a SaaS admin panel in 5 min"
- [ ] SM-021: Automate CI badge + version badge for README + social cards

### Phase 3: Episode Pipeline (Week 4-12) — **Sustained cadence**
- [ ] SM-022: Record Episode 1: Declarative Models (YT-004)
- [ ] SM-023: Derivatives for Ep 1 (thread, carousel, article, 2 Shorts)
- [ ] SM-024: Record Episode 2: Addons (YT-006)
- [ ] SM-025: Derivatives for Ep 2
- [ ] SM-026: Record Episode 3: The Board (YT-007)
- [ ] SM-027: Derivatives for Ep 3
- [ ] SM-028: Configure Home tab layout (YT-005)
- [ ] SM-029: Extract UI Catalog components as GIFs for social

### Phase 4: Scale & Optimize (Week 12+) — **Growth**
- [ ] SM-030: Create Instagram/Threads account + Reels pipeline
- [ ] SM-031: Create TikTok account + Shorts pipeline
- [ ] SM-032: Set up content calendar system (Notion/Airtable/GitHub Projects)
- [ ] SM-033: Add app store screenshot templates
- [ ] SM-034: Mobile Board responsive demo GIF (320px viewport)
- [ ] SM-035: Analytics dashboard + monthly review process

---

## Success Metrics (Quarterly)

| Metric | Q1 Target | Q2 Target | Measurement |
|--------|-----------|-----------|-------------|
| YouTube Subscribers | 500 | 2,000 | YouTube Studio |
| YouTube Views (cumulative) | 10,000 | 50,000 | YouTube Studio |
| X/Twitter Followers | 1,000 | 5,000 | X Analytics |
| LinkedIn Followers | 500 | 2,000 | LinkedIn Analytics |
| Discord Members | 200 | 1,000 | Discord Insights |
| Newsletter Subscribers | 300 | 1,500 | Provider dashboard |
| Dev.to Article Views | 5,000 | 20,000 | Dev.to Stats |
| GitHub Stars | 200 | 500 | GitHub Insights |
| Website Visitors (docs) | 5,000/mo | 20,000/mo | Plausible/GA |

---

## Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Trailer recording blocked (no time/skills) | Blocks all episodes | High | Script ready, consider freelance editor or screen-record in chunks |
| Platform API changes break automation | Pipeline breaks | Medium | Abstract platform specs, version-pin dependencies |
| Inconsistent visual brand across platforms | Dilutes recognition | High | CI validation + contact sheet review + design tokens as single source |
| Burnout from content cadence | Missed deadlines | Medium | Batch recording, template system, calendar with buffer |
| Low engagement on new channels | Wasted effort | Medium | Cross-post strategically, focus on 2-3 primary channels first |
| YouTube Studio headless limitations | Manual steps remain | High | Document manual checklists, automate what's possible |

---

## TaskOS Integration

All tasks above use series `SM` (Social Media), project `moonwitness`, and will be registered in `docs/tasks/tasks.json` via the sweep-and-consolidate pipeline. Each task includes:
- Acceptance criteria with measurable done states
- Dependencies (blocks/dependsOn)
- Validation commands
- Evidence paths
- Effort/priority estimates

**Source files for TaskOS generation:**
- This document: `docs/operations/social-media-grand-plan.md`
- Existing YT tasks: `scripts/tasks/sources/yt-tasks.mjs`
- Audit results: workflow journal in `.claude/projects/.../wf_dac449d9-7bb/journal.jsonl`

---

## Next Actions

1. **Immediate:** Run `pnpm tasks:validate` to verify current registry, then generate SM tasks
2. **This week:** Complete Phase 0 (asset pipeline) — unblocks all visual content
3. **Parallel:** Set up owned channels (Discord, GitHub Discussions, Newsletter)
4. **Week 2:** Execute Phase 1 + 2 launch sequence
5. **Ongoing:** Episode production cadence with derivative automation

---

*This plan is a living document. Update via TaskOS as tasks complete and metrics inform strategy.*