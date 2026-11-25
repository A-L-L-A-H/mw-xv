# MoonWitness Social Media Routines & Recurring Tasks

> **Purpose:** Document recurring/automated tasks for social media operations. These are routine ideas that complement the one-time setup tasks (SM-001 through SM-035) in the Grand Plan.

---

## Daily Routines (Automated)

### 1. Morning Metrics Sync (07:00 WIB)
- **Trigger:** GitHub Actions scheduled workflow
- **Action:** Fetch previous day's metrics from all platforms
- **Platforms:** YouTube Studio, X Analytics, LinkedIn Analytics, Dev.to Stats, Discord Insights, Newsletter provider
- **Output:** Append to content calendar (Notion/GitHub Project) with date, views, engagement, follower delta
- **Alert:** If any metric drops >20% WoW, post to #social-alerts Discord channel

### 2. Scheduled Post Dispatcher (Every 2 hours, 08:00-22:00 WIB)
- **Trigger:** Worker polling `post_queue` in orm-automation-core
- **Action:** Process scheduled posts from content calendar
- **Platforms:** X, LinkedIn, Dev.to, Bluesky (via platform handlers)
- **Retry:** Exponential backoff (1m, 5m, 15m, 1h) on transient failures
- **Dead letter:** Failed posts after 3 retries → #social-alerts for manual review

### 3. YouTube Comment Monitor (Every 30 min during business hours)
- **Trigger:** YouTube Data API v3 polling
- **Action:** Fetch new comments on latest 3 videos
- **Filter:** Questions → route to #community-support Discord; Praise → quote-tweet/LinkedIn share; Spam → delete
- **SLA:** Respond to questions within 4 hours during business hours

---

## Weekly Routines

### 4. Content Calendar Review (Monday 09:00 WIB)
- **Owner:** Content lead / solo founder
- **Duration:** 30 min
- **Agenda:**
  - Review upcoming week's derivatives (Ep N → 5 formats)
  - Confirm recording schedule for next YouTube episode
  - Check asset pipeline readiness (thumbnails, GIFs, carousels)
  - Assign owners for each derivative
  - Update statuses: planned → in-progress → review → published
- **Artifact:** Updated Notion/GitHub Project board

### 5. Episode Production Kickoff (Wednesday 10:00 WIB - when recording)
- **Trigger:** Calendar event for episode recording week
- **Duration:** 60 min
- **Agenda:**
  - Finalize script/outline from `YOUTUBE_CHANNEL_ASSETS.md`
  - Prepare terminal + Board demo environment (clean state, seeded data)
  - Test OBS/Playwright recording setup
  - Record episode (target 8-10 min raw → 6-8 min edited)
  - Immediate post-record: generate thumbnail via `SM-003` pipeline
- **Output:** Raw footage + thumbnail → editing queue

### 6. Derivative Generation Sprint (Thursday-Friday, post-recording)
- **Trigger:** Episode upload to YouTube (or scheduled)
- **Duration:** 2-3 hours over 2 days
- **Parallel workstreams:**
  - **X Thread:** Hook + 5-7 tweets + media (terminal GIF, Board screenshot)
  - **LinkedIn Carousel:** 5-7 slides (1080×1080) from `SM-002` pipeline
  - **Dev.to Article:** Cross-post with canonical URL, cover image (1000×420)
  - **Shorts/Reels:** 2-3 vertical cuts (9:16) with captions from timestamps
  - **Newsletter Section:** Markdown snippet for next digest
- **Tooling:** `generate-episode-derivatives.mjs` (SM-023) for automation
- **Deadline:** All derivatives published within 24h of YouTube upload

### 7. Community Engagement Hour (Friday 15:00 WIB)
- **Duration:** 60 min
- **Actions:**
  - Reply to all unanswered Discord questions in #help, #general
  - Check GitHub Discussions for unanswered Q&A
  - Engage with 5-10 relevant posts on X/LinkedIn/Bluesky (thoughtful replies, not just likes)
  - Share community showcases/projects in #showcase channel
  - Curate 1-2 community contributions for next newsletter

---

## Bi-Weekly Routines

### 8. Asset Pipeline Health Check (1st & 15th of month)
- **Trigger:** Manual or scheduled script
- **Checks:**
  - `validate-social-assets.mjs` passes on latest renders
  - All 9 formats × 2 modes = 18 files exist in `packages/assets/brand/rendered/`
  - Brand color compliance: no drift from `tokens.css` values
  - SVG optimization scores >90 (svgo)
  - PNG compression ratios acceptable
  - Contact sheet at `docs/design/assets/social-formats/` up to date
- **Failure:** Create GitHub issue with `priority:p0,area:assets` label

### 9. Platform API Health Check (1st & 15th of month)
- **Trigger:** Scheduled workflow
- **Checks:**
  - X API v2: rate limits, auth token valid, test tweet draft
  - LinkedIn UGC API: token refresh, organization access
  - Dev.to API: API key valid, test article draft
  - Bluesky ATProto: session valid, test post draft
  - Instagram Graph API: token valid (long-lived), test media upload
  - TikTok Business API: token valid, test video upload
- **Alert:** Any failure → #social-alerts + GitHub issue

---

## Monthly Routines

### 10. Monthly Metrics Review (1st of month, 09:00 WIB)
- **Duration:** 60 min
- **Data Sources:**
  - YouTube Studio: subs, views, watch time, CTR, AVD
  - X Analytics: impressions, engagement rate, follower growth
  - LinkedIn Analytics: impressions, clicks, follower demographics
  - Dev.to Stats: article views, reading time, reactions
  - Discord Insights: active members, messages, retention
  - Newsletter: open rate, click rate, unsubscribe rate
  - Plausible/GA: docs site visitors, top pages, referrers
  - GitHub Insights: stars, forks, clones, traffic
- **Template:** Quarterly metrics table in Grand Plan (SM-035)
- **Output:** 
  - Notion page / GitHub Discussion post with metrics vs targets
  - 3 actionable insights for next month
  - Content strategy adjustments

### 11. Newsletter Digest Publication (1st of month, 10:00 WIB)
- **Trigger:** Manual send after review
- **Content:**
  - Month recap: videos published, key metrics
  - Episode deep-dive: one episode's derivatives + links
  - Community highlight: showcase/project from Discord/GitHub
  - Upcoming: next episode teaser, roadmap preview
  - Resource links: docs, GitHub, YouTube, Discord
- **Distribution:** Buttondown/ConvertKit + cross-post to LinkedIn article + Dev.to

### 12. Content Calendar Planning Session (Last Friday of month)
- **Duration:** 90 min
- **Agenda:**
  - Plan next month's episode + derivative schedule
  - Assign recording dates, derivative deadlines
  - Identify asset gaps (need new GIFs, carousels, templates)
  - Coordinate with product releases (addon launches, Board features)
  - Buffer planning: 20% slack for delays
- **Output:** Populated content calendar for next 4-6 weeks

---

## Quarterly Routines

### 13. Quarterly Strategy Review (Quarter start: Jan 1, Apr 1, Jul 1, Oct 1)
- **Duration:** 2-3 hours
- **Participants:** Founder + key contributors
- **Agenda:**
  - Review quarterly metrics vs targets (Grand Plan table)
  - Platform ROI analysis: effort vs. results per platform
  - Audience insights: who's engaging, what content resonates
  - Competitive landscape: what are peers doing?
  - Strategy adjustments: double down, pivot, or sunset platforms
  - Budget/resource allocation for next quarter
  - Set next quarter's targets (update Grand Plan table)
- **Artifact:** Updated Grand Plan + quarterly retrospective doc

### 14. Brand Asset Audit (Quarter start)
- **Trigger:** Manual review
- **Scope:**
  - All social templates render correctly at all dimensions
  - Brand tokens in `tokens.css` match rendered assets
  - New platform formats needed? (e.g., Threads, new YouTube features)
  - Deprecated formats to remove?
  - Contact sheet completeness
- **Action:** Create GitHub issues for any gaps (feed into next quarter's SM tasks)

### 15. Community Health Assessment (Quarterly)
- **Metrics:**
  - Discord: monthly active users, message volume, retention cohorts
  - GitHub Discussions: questions answered %, response time
  - Newsletter: list growth, engagement segments
  - YouTube: comment sentiment, community tab engagement
- **Actions:**
  - Identify super-contributors for recognition/ambassador program
  - Address churn risks (inactive members, unanswered questions)
  - Plan community events (AMAs, hackathons, office hours)

---

## Event-Driven Routines (Triggered)

### 16. New Release / Version Launch
- **Trigger:** GitHub Release published (tag push)
- **Automation:**
  - Generate social card via `render-social.mjs --format og --version {{VERSION}}`
  - Post to X, LinkedIn, Bluesky, Dev.to with release notes summary
  - Update Discord #announcements with @everyone (major) or @here (patch)
  - Newsletter: dedicated release email if major/minor
- **Timing:** Within 1 hour of release

### 17. Major Feature Launch (Addon, Board feature)
- **Trigger:** Feature flag enabled / PR merged to main with `feature:` prefix
- **Content:**
  - Short demo GIF via `record-ui-gifs.mjs` (SM-029)
  - X thread: problem → solution → demo
  - LinkedIn carousel: before/after + code snippet
  - Dev.to article: deep-dive with code examples
  - YouTube Short: 60s demo
- **Coordination:** Align with product/engineering for accurate messaging

### 18. Conference / Speaking Engagement
- **Trigger:** CFP accepted or event confirmed
- **Content:**
  - Announcement post (X, LinkedIn, Bluesky)
  - Speaker card asset (1200×630 OG + 1080×1080 IG)
  - Post-event: slide deck upload, recording link, thread recap
  - Follow-up Dev.to article: "What I presented at [Event]"

### 19. Security Incident / Outage Communication
- **Trigger:** Incident declared
- **Channels:** Discord #announcements (priority), X thread, GitHub Discussion
- **Cadence:** Initial acknowledgment → 30 min updates → resolution → post-mortem link
- **Template:** Pre-written incident communication templates in `docs/operations/incident-comms.md`

### 20. Viral Moment Amplification
- **Trigger:** Any post >10x median engagement
- **Action (within 2 hours):**
  - Quote-tweet / repost with context
  - Create follow-up content (thread expanding on the point)
  - Cross-post to other platforms with platform-native format
  - Capture in "greatest hits" for newsletter/recap content
- **Analysis:** Document what worked for future replication

---

## Automation Architecture Summary

| Routine | Trigger | Tool/Script | Output Location |
|---------|---------|-------------|-----------------|
| Metrics Sync | Cron (daily 07:00) | `sync-metrics.mjs` | Content calendar |
| Post Dispatcher | Queue poll (2hr) | `post_social` worker | Platform APIs |
| Comment Monitor | Cron (30min) | `youtube-comments.mjs` | Discord #community-support |
| Asset Validation | Cron (bi-weekly) | `validate-social-assets.mjs` | CI gate / GitHub issue |
| API Health | Cron (bi-weekly) | `check-social-apis.mjs` | Discord #social-alerts |
| Release Posts | GitHub Release webhook | `render-social.mjs` + worker | All platforms |
| Episode Derivatives | YouTube upload webhook | `generate-episode-derivatives.mjs` | All platforms |

---

## Implementation Priority

| Phase | Routines | Dependencies |
|-------|----------|--------------|
| **Phase 0** (Week 1-2) | 16 (Release posts - basic) | `render-social.mjs` multi-format (SM-002) |
| **Phase 1** (Week 2-3) | 1, 2, 4, 5, 6 | Content calendar (SM-032), derivative generator (SM-023) |
| **Phase 2** (Week 3-4) | 3, 7, 8, 9 | YouTube API access, platform API tokens |
| **Phase 3** (Week 4-12) | 10, 11, 17, 18 | Analytics setup (SM-035), newsletter (SM-010) |
| **Phase 4** (Week 12+) | 12, 13, 14, 15, 19, 20 | Mature operations, community scale |

---

## Tooling Requirements

### New Scripts to Create
```
packages/assets/scripts/
├── social-formats.config.js         # Format specs for render-social.mjs
├── render-youtube-thumbnails.mjs    # SM-003
├── validate-social-assets.mjs       # SM-005
├── record-ui-gifs.mjs               # SM-029
├── record-mobile-board.mjs          # SM-034
├── generate-episode-derivatives.mjs # SM-023
├── sync-metrics.mjs                 # Daily metrics
├── check-social-apis.mjs            # Bi-weekly API health
├── youtube-comments.mjs             # Comment monitoring
└── incident-comms.mjs               # Incident templates
```

### Platform API Credentials Needed (Store in GitHub Secrets / 1Password)
- `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`
- `DEVTO_API_KEY`
- `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_ACCESS_TOKEN`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN`
- `YOUTUBE_API_KEY` (for comments/metrics)
- `DISCORD_WEBHOOK_METRICS`, `DISCORD_WEBHOOK_ALERTS`, `DISCORD_WEBHOOK_ANNOUNCEMENTS`
- `NEWSLETTER_API_KEY` (Buttondown/ConvertKit)
- `PLAUSIBLE_API_KEY` / `GA_MEASUREMENT_ID`

---

## Success Criteria for Routines

| Routine | Success Metric |
|---------|----------------|
| Metrics Sync | 100% daily completion, <5 min runtime |
| Post Dispatcher | 99.9% scheduled posts published on time |
| Comment Monitor | <4hr response to questions during business hours |
| Weekly Review | 100% calendar accuracy for following week |
| Derivative Sprint | 100% derivatives published within 24h of YT upload |
| Monthly Review | Completed by 5th of each month |
| Newsletter | Published by 3rd of each month, >30% open rate |
| Quarterly Review | Strategy doc updated, targets set for next quarter |
| Release Posts | Published within 1hr of GitHub Release |
| Asset Validation | Zero undetected dimension/color drift |

---

*This document is a living reference. Update as routines are implemented, automated, or retired. Link to TaskOS tasks where applicable (SM-032 for calendar, SM-035 for analytics, etc.).*