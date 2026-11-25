// SM task source for TaskOS sweep - Social Media Grand Plan
export const SM_TASKS = [
  {
    code: 'SM-001',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Create source SVGs for all YouTube assets in packages/assets/brand/',
    summary: 'Create moonwitness-youtube-banner.svg (2560x1440 with safe area guides), moonwitness-youtube-logo.svg (800x800 circular), moonwitness-youtube-watermark.svg (150x150), moonwitness-youtube-thumbnail-template.svg (1280x720 with text placeholders) using brand tokens from tokens.css.',
    problem: 'YouTube assets exist only as JPGs in repo root with wrong dimensions (banner 1440x810 vs required 2560x1440). No source SVGs means no regeneration, color adjustment, or version control through asset pipeline.',
    proposedSolution: 'Design SVG sources in Figma/Illustrator using brand tokens (Cream #f3efe4, Ink #0d0d0d, Yellow #ffe031, Signal Blue #00b8f0, Magenta #ff2e88; Fonts: Anton, Space Grotesk, JetBrains Mono; Shadow: 3px 3px 0 0 #0d0d0d; Border 2px; Radius 0.25rem). Place in packages/assets/brand/.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'social-media',
      'assets',
      'youtube',
      'svg',
      'brand'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/brand/moonwitness-youtube-banner.svg',
        'packages/assets/brand/moonwitness-youtube-logo.svg',
        'packages/assets/brand/moonwitness-youtube-watermark.svg',
        'packages/assets/brand/moonwitness-youtube-thumbnail-template.svg'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-001-ac-1',
        text: 'Banner SVG at 2560x1440 with 1546x423 safe area guide',
        done: false
      },
      {
        id: 'SM-001-ac-2',
        text: 'Logo SVG at 800x800 circular with crown symbol',
        done: false
      },
      {
        id: 'SM-001-ac-3',
        text: 'Watermark SVG at 150x150',
        done: false
      },
      {
        id: 'SM-001-ac-4',
        text: 'Thumbnail template SVG at 1280x720 with {{EPISODE_TITLE}} placeholder',
        done: false
      },
      {
        id: 'SM-001-ac-5',
        text: 'All SVGs use brand tokens from tokens.css (colors, fonts, shadows)',
        done: false
      },
      {
        id: 'SM-001-ac-6',
        text: 'SVGs pass svgo optimization',
        done: false
      }
    ],
    validation: {
      commands: [
        'ls packages/assets/brand/moonwitness-youtube-*.svg',
        'pnpm test:assets'
      ],
      expected: '4 YouTube SVGs present; asset tests pass'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'YOUTUBE_CHANNEL_ASSETS.md',
        'packages/ui/src/styles/tokens.css'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'YOUTUBE_CHANNEL_ASSETS.md',
      'packages/ui/src/styles/tokens.css'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-002',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Extend render-social.mjs with multi-format CLI',
    summary: 'Add --format flag (og, instagram-square, instagram-story, x-header, linkedin, github, youtube-banner, youtube-thumbnail, youtube-profile), template variable injection ({{TITLE}}, {{EPISODE}}, {{LANG}}), and batch rendering to packages/assets/brand/rendered/.',
    problem: 'render-social.mjs produces ONLY 1200x630 (OG card). Missing all other platform formats. No CLI args for format selection, no template variable substitution, no batch rendering.',
    proposedSolution: 'Refactor render-social.mjs to accept format parameter, define format specs (dimensions, safe areas) in a config object, add template variable replacement, output to organized directory structure.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-001'
    ],
    blocks: [],
    tags: [
      'social-media',
      'automation',
      'render-pipeline',
      'cli'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/scripts/render-social.mjs'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-002-ac-1',
        text: 'CLI accepts --format with 9 format options',
        done: false
      },
      {
        id: 'SM-002-ac-2',
        text: 'Template variables {{TITLE}}, {{EPISODE}}, {{LANG}} replaced',
        done: false
      },
      {
        id: 'SM-002-ac-3',
        text: 'Batch rendering outputs to packages/assets/brand/rendered/{format}/',
        done: false
      },
      {
        id: 'SM-002-ac-4',
        text: 'All 9 formats produce correct dimensions',
        done: false
      },
      {
        id: 'SM-002-ac-5',
        text: 'Light/dark mode variants generated for each format',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/render-social.mjs --format og',
        'node packages/assets/scripts/render-social.mjs --format instagram-square',
        'ls packages/assets/brand/rendered/'
      ],
      expected: 'All formats render successfully with correct dimensions'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'packages/assets/scripts/render-social.mjs',
        'packages/assets/scripts/generate-contact-sheets.mjs'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'packages/assets/scripts/render-social.mjs',
      'packages/assets/scripts/generate-contact-sheets.mjs'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-003',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Build YouTube thumbnail template generator',
    summary: 'Create moonwitness-youtube-thumbnail-base.svg with {{EPISODE_TITLE}} placeholder, add script packages/assets/scripts/render-youtube-thumbnails.mjs that reads episode list from YOUTUBE_CHANNEL_ASSETS.md table and outputs 8 episode thumbnails as PNG.',
    problem: 'YOUTUBE_CHANNEL_ASSETS.md defines 8 episode thumbnail templates with specific title text per episode, but there is no automated way to generate these from the base template. Each episode requires manual image editing.',
    proposedSolution: 'Create base SVG template with text placeholder, write Node script that parses episode table from YOUTUBE_CHANNEL_ASSETS.md, renders each episode thumbnail via Playwright/Sharp, outputs to packages/assets/brand/rendered/youtube-thumbnails/.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-001',
      'SM-002'
    ],
    blocks: [],
    tags: [
      'social-media',
      'automation',
      'youtube',
      'thumbnails'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/brand/moonwitness-youtube-thumbnail-base.svg',
        'packages/assets/scripts/render-youtube-thumbnails.mjs'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-003-ac-1',
        text: 'Base SVG template with {{EPISODE_TITLE}} placeholder exists',
        done: false
      },
      {
        id: 'SM-003-ac-2',
        text: 'Script reads episode table from YOUTUBE_CHANNEL_ASSETS.md',
        done: false
      },
      {
        id: 'SM-003-ac-3',
        text: 'Outputs 8 PNG thumbnails (1280x720) with correct titles',
        done: false
      },
      {
        id: 'SM-003-ac-4',
        text: 'Thumbnails use brand tokens (Anton for title, Yellow accent)',
        done: false
      },
      {
        id: 'SM-003-ac-5',
        text: 'Script integrated into render pipeline (callable via npm script)',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/render-youtube-thumbnails.mjs',
        'ls packages/assets/brand/rendered/youtube-thumbnails/*.png | wc -l'
      ],
      expected: '8 PNG files generated with correct episode titles'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'YOUTUBE_CHANNEL_ASSETS.md',
        'packages/assets/scripts/render-social.mjs'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'YOUTUBE_CHANNEL_ASSETS.md',
      'packages/assets/scripts/render-social.mjs'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-004',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Add social-format contact sheet to generate-contact-sheets.mjs',
    summary: 'Render brand group at each target dimension (OG 1200x630, IG 1080x1080, Stories 1080x1920, X 1500x500, YT banner 2560x1440, YT thumb 1280x720) with safe-area overlays, output to docs/design/assets/social-formats/.',
    problem: 'generate-contact-sheets.mjs produces a 1280x900 contact sheet for internal asset packs but the brand group is not rendered as a social-format contact sheet. No automated visual regression or brand consistency check across formats.',
    proposedSolution: 'Extend generate-contact-sheets.mjs with a "social-formats" group that renders all brand assets (symbol, wordmark, lockup variants, social-card) at each platform dimension with safe-area guides.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002'
    ],
    blocks: [],
    tags: [
      'social-media',
      'automation',
      'contact-sheet',
      'visual-regression'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/scripts/generate-contact-sheets.mjs'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-004-ac-1',
        text: 'Social formats group added to generate-contact-sheets.mjs',
        done: false
      },
      {
        id: 'SM-004-ac-2',
        text: 'Renders at 6+ platform dimensions with safe-area overlays',
        done: false
      },
      {
        id: 'SM-004-ac-3',
        text: 'Outputs to docs/design/assets/social-formats/',
        done: false
      },
      {
        id: 'SM-004-ac-4',
        text: 'Includes light/dark variants for each format',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/generate-contact-sheets.mjs',
        'ls docs/design/assets/social-formats/'
      ],
      expected: 'Contact sheets generated for all social formats'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'packages/assets/scripts/generate-contact-sheets.mjs'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'packages/assets/scripts/generate-contact-sheets.mjs'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-005',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Add CI validation script for social assets',
    summary: 'Create packages/assets/scripts/validate-social-assets.mjs that checks manifest.json for required social formats, validates dimensions against platform specs, verifies brand colors from tokens.css, ensures SVG optimization (svgo), outputs completeness matrix as JSON for CI gate.',
    problem: 'No automated checks: dimension validation, color palette compliance, token reference validation, SVG optimization, PNG compression, format completeness matrix. Manifest.json tracks 2000+ assets but no pipeline validates social-format coverage.',
    proposedSolution: 'Write validation script that reads manifest.json and platform spec definitions, validates each rendered asset, outputs JSON report with pass/fail per format, integrates into CI pipeline as a gate.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-004'
    ],
    blocks: [],
    tags: [
      'social-media',
      'ci',
      'validation',
      'automation'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/scripts/validate-social-assets.mjs',
        '.github/workflows/validate-social-assets.yml'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-005-ac-1',
        text: 'Validation script checks all 9 social formats',
        done: false
      },
      {
        id: 'SM-005-ac-2',
        text: 'Validates dimensions against platform specs',
        done: false
      },
      {
        id: 'SM-005-ac-3',
        text: 'Verifies brand colors from tokens.css',
        done: false
      },
      {
        id: 'SM-005-ac-4',
        text: 'Checks SVG optimization (svgo)',
        done: false
      },
      {
        id: 'SM-005-ac-5',
        text: 'Outputs JSON completeness matrix',
        done: false
      },
      {
        id: 'SM-005-ac-6',
        text: 'CI workflow runs on PR and fails on validation errors',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/validate-social-assets.mjs',
        'cat validation-report.json'
      ],
      expected: 'Validation passes with all formats green; CI workflow configured'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'packages/assets/manifest.json',
        'packages/ui/src/styles/tokens.css'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'packages/assets/manifest.json',
      'packages/ui/src/styles/tokens.css'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-006',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Create dark-mode variants for all social templates',
    summary: 'Duplicate each SVG with .dark.svg suffix using dark skin tokens from tokens.css (--mw-paper: #0e0e10, --mw-ink: #f3efe4), update render pipeline to output both light/dark variants.',
    problem: 'No dark-mode variants for social cards. Platforms increasingly support dark mode; brand must look consistent in both.',
    proposedSolution: 'Create dark variants of all social SVGs using dark skin token values. Update render-social.mjs to generate both variants automatically.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-001'
    ],
    blocks: [],
    tags: [
      'social-media',
      'assets',
      'dark-mode',
      'brand'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/brand/*-dark.svg',
        'packages/assets/scripts/render-social.mjs'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-006-ac-1',
        text: 'Dark variants exist for all 4 YouTube SVGs',
        done: false
      },
      {
        id: 'SM-006-ac-2',
        text: 'Dark variants exist for social-card.svg',
        done: false
      },
      {
        id: 'SM-006-ac-3',
        text: 'Dark variants use dark skin tokens (--mw-paper: #0e0e10, --mw-ink: #f3efe4)',
        done: false
      },
      {
        id: 'SM-006-ac-4',
        text: 'Render pipeline outputs both light/dark for each format',
        done: false
      }
    ],
    validation: {
      commands: [
        'ls packages/assets/brand/*-dark.svg',
        'node packages/assets/scripts/render-social.mjs --format og'
      ],
      expected: 'Dark SVGs exist; both variants rendered'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'packages/ui/src/styles/tokens.css'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'packages/ui/src/styles/tokens.css'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-007',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-FOUNDATION',
    horizon: 'now',
    title: 'Document social asset pipeline in docs/design/brand-assets.md',
    summary: 'Add render command reference, format specification table, template variable guide, CI integration steps, and manual YouTube Studio upload checklist.',
    problem: 'No documentation for the social asset pipeline. Team members cannot discover or use the automation.',
    proposedSolution: 'Create comprehensive documentation covering all render commands, format specs, template variables, CI gates, and manual upload procedures.',
    category: 'documentation',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-003',
      'SM-005'
    ],
    blocks: [],
    tags: [
      'social-media',
      'documentation',
      'brand-assets'
    ],
    scope: {
      packages: [],
      files: [
        'docs/design/brand-assets.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-007-ac-1',
        text: 'Render command reference with all flags documented',
        done: false
      },
      {
        id: 'SM-007-ac-2',
        text: 'Format specification table with dimensions and safe areas',
        done: false
      },
      {
        id: 'SM-007-ac-3',
        text: 'Template variable guide ({{TITLE}}, {{EPISODE}}, {{LANG}})',
        done: false
      },
      {
        id: 'SM-007-ac-4',
        text: 'CI integration steps documented',
        done: false
      },
      {
        id: 'SM-007-ac-5',
        text: 'YouTube Studio manual upload checklist included',
        done: false
      }
    ],
    validation: {
      commands: [
        'cat docs/design/brand-assets.md'
      ],
      expected: 'Complete documentation present'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-008',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Publish docs site to GitHub Pages (M6.07)',
    summary: 'Complete ROADMAP.md M6.06 (build) and M6.07 (deploy) to publish docs site. Adds docs link to all social bios.',
    problem: 'Docs site not yet published. No central documentation hub for social traffic.',
    proposedSolution: 'Complete existing roadmap items M6.06 and M6.07. Configure GitHub Pages deployment from docs build output.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'social-media',
      'docs',
      'github-pages',
      'seo'
    ],
    scope: {
      packages: [],
      files: [
        '.github/workflows/docs-deploy.yml',
        'docs/'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-008-ac-1',
        text: 'Docs site accessible at https://moonwitness.dev or GitHub Pages URL',
        done: false
      },
      {
        id: 'SM-008-ac-2',
        text: 'Custom domain configured (if available)',
        done: false
      },
      {
        id: 'SM-008-ac-3',
        text: 'Auto-deploy on main branch push',
        done: false
      },
      {
        id: 'SM-008-ac-4',
        text: 'Search and navigation functional',
        done: false
      }
    ],
    validation: {
      commands: [
        'curl -I https://moonwitness.dev'
      ],
      expected: 'Docs site returns 200 with content'
    },
    evidence: {
      paths: [
        'ROADMAP.md',
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'ROADMAP.md',
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-009',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Set up Discord server + GitHub Discussions',
    summary: 'Create Discord server with roles, channels, invite link. Enable GitHub Discussions on repo. Add invite to video descriptions and README.',
    problem: 'YouTube description lists Discord as "coming soon". No community hub for real-time chat, announcements, or technical Q&A.',
    proposedSolution: 'Create Discord server (moonwitness), configure roles (admin, contributor, member), channels (#announcements, #general, #help, #showcase, #feedback). Enable GitHub Discussions in repo settings. Add invite links to all profiles.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-008'
    ],
    blocks: [],
    tags: [
      'social-media',
      'community',
      'discord',
      'github-discussions'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-009-ac-1',
        text: 'Discord server created with invite link',
        done: false
      },
      {
        id: 'SM-009-ac-2',
        text: 'Roles and channels configured',
        done: false
      },
      {
        id: 'SM-009-ac-3',
        text: 'GitHub Discussions enabled on repo',
        done: false
      },
      {
        id: 'SM-009-ac-4',
        text: 'Invite links added to YouTube description, README, docs',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open Discord invite',
        'Open GitHub repo Discussions tab'
      ],
      expected: 'Discord server accessible; Discussions tab active'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'docs/operations/youtube-channel.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'docs/operations/youtube-channel.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-010',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Set up newsletter provider + signup form',
    summary: 'Choose provider (Buttondown/ConvertKit), create signup form, embed in docs site and GitHub repo. First issue: launch announcement.',
    problem: 'No owned audience channel. Newsletter provides direct reach independent of platform algorithms.',
    proposedSolution: 'Evaluate Buttondown (simpler) vs ConvertKit (more features). Create account, design signup form, embed in docs site footer and GitHub README. Prepare launch issue template.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-008'
    ],
    blocks: [],
    tags: [
      'social-media',
      'newsletter',
      'owned-audience'
    ],
    scope: {
      packages: [],
      files: [
        'docs/',
        'README.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-010-ac-1',
        text: 'Newsletter provider account created',
        done: false
      },
      {
        id: 'SM-010-ac-2',
        text: 'Signup form embedded in docs site',
        done: false
      },
      {
        id: 'SM-010-ac-3',
        text: 'Signup link in GitHub README',
        done: false
      },
      {
        id: 'SM-010-ac-4',
        text: 'Launch issue template prepared',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open docs site footer',
        'Open GitHub README'
      ],
      expected: 'Newsletter signup visible in both locations'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-011',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Create X/Twitter account @moonwitness_xv',
    summary: 'Create account, set up profile (banner, avatar, bio, pinned tweet), follow relevant accounts.',
    problem: 'No X/Twitter presence. Primary platform for developer discovery and thread-format content.',
    proposedSolution: 'Create @moonwitness_xv account. Use brand assets from pipeline (X header 1500x500, profile 400x400). Bio: "Every model. One board. Declarative ORM + addon system + data-driven admin for TypeScript/PostgreSQL." Link to GitHub/docs.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-008',
      'SM-009'
    ],
    blocks: [],
    tags: [
      'social-media',
      'twitter',
      'x',
      'distribution'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-011-ac-1',
        text: 'Account @moonwitness_xv created',
        done: false
      },
      {
        id: 'SM-011-ac-2',
        text: 'Profile banner (1500x500) and avatar (400x400) uploaded',
        done: false
      },
      {
        id: 'SM-011-ac-3',
        text: 'Bio with brand tagline and links',
        done: false
      },
      {
        id: 'SM-011-ac-4',
        text: 'Pinned tweet ready for launch thread',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://x.com/moonwitness_xv'
      ],
      expected: 'Profile complete with brand assets'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-012',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Create LinkedIn company page',
    summary: 'Create LinkedIn company page for MoonWitness, upload banner (1128x191), logo, description. Connect to team members.',
    problem: 'No LinkedIn presence. Important for professional credibility, hiring, and founder audience.',
    proposedSolution: 'Create company page. Use brand assets from pipeline. Description: "MoonWitness eliminates SQL migrations. Declarative models, transactional addons, and a data-driven admin board — all TypeScript-first."',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-008',
      'SM-009'
    ],
    blocks: [],
    tags: [
      'social-media',
      'linkedin',
      'distribution'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-012-ac-1',
        text: 'LinkedIn company page created',
        done: false
      },
      {
        id: 'SM-012-ac-2',
        text: 'Banner (1128x191) and logo uploaded',
        done: false
      },
      {
        id: 'SM-012-ac-3',
        text: 'Description with brand positioning',
        done: false
      },
      {
        id: 'SM-012-ac-4',
        text: 'Team members connected',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open LinkedIn company page'
      ],
      expected: 'Page complete with brand assets'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-013',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Create Bluesky account',
    summary: 'Create Bluesky handle @moonwitness.dev, set up profile with brand assets, cross-post from X.',
    problem: 'No Bluesky presence. Growing developer community on Bluesky.',
    proposedSolution: 'Create account. Use same brand assets. Enable cross-posting from X via tools or manual.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-008'
    ],
    blocks: [],
    tags: [
      'social-media',
      'bluesky',
      'distribution'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-013-ac-1',
        text: 'Bluesky account @moonwitness.dev created',
        done: false
      },
      {
        id: 'SM-013-ac-2',
        text: 'Profile with brand assets',
        done: false
      },
      {
        id: 'SM-013-ac-3',
        text: 'First post announcing presence',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://bsky.app/profile/moonwitness.dev'
      ],
      expected: 'Profile complete'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-014',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-CHANNELS',
    horizon: 'now',
    title: 'Enable GitHub Discussions on repo',
    summary: 'Enable Discussions in repository settings. Create categories: Announcements, Q&A, Ideas, Show & Tell. Pin welcome post.',
    problem: 'GitHub Discussions not enabled. Missing technical Q&A channel for developers.',
    proposedSolution: 'Settings > Features > Discussions > Enable. Configure categories. Pin welcome post with links to docs, Discord, YouTube.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'social-media',
      'github',
      'community',
      'discussions'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-014-ac-1',
        text: 'Discussions enabled in repo settings',
        done: false
      },
      {
        id: 'SM-014-ac-2',
        text: 'Categories created (Announcements, Q&A, Ideas, Show & Tell)',
        done: false
      },
      {
        id: 'SM-014-ac-3',
        text: 'Welcome post pinned with links',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open GitHub repo Discussions tab'
      ],
      expected: 'Discussions active with categories'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-015',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Publish full bilingual channel description (YT-002)',
    summary: 'Copy bilingual description (EN + ID, ~1500 chars with SEO keywords: ORM, TypeScript, SaaS, PostgreSQL) from YOUTUBE_CHANNEL_ASSETS.md to YouTube Studio Basic Info tab manually.',
    problem: 'Current description is ID-only 592 chars; EN version + full SEO text missing. Studio Basic Info tab errors in headless browser.',
    proposedSolution: 'Manual copy-paste from YOUTUBE_CHANNEL_ASSETS.md to studio.youtube.com/channel/UC0Ww2KgIDWGkc5bxjMspecg/editing/basic.',
    category: 'documentation',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'YT-001',
      'SM-002',
      'SM-003',
      'SM-009'
    ],
    blocks: [],
    tags: [
      'youtube',
      'seo',
      'bilingual',
      'channel-setup'
    ],
    scope: {
      packages: [],
      files: [
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-015-ac-1',
        text: 'EN description visible on channel about page',
        done: false
      },
      {
        id: 'SM-015-ac-2',
        text: 'ID description visible on channel about page',
        done: false
      },
      {
        id: 'SM-015-ac-3',
        text: 'Keywords present (ORM, TypeScript, SaaS, PostgreSQL)',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv/about'
      ],
      expected: 'Full bilingual description rendered'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-016',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Record & upload channel trailer (YT-003) — 60s scripted',
    summary: 'Record scripted trailer per YOUTUBE_CHANNEL_ASSETS.md; export 1080p; upload with custom thumbnail from template. Screen-record terminal + Board demo; voiceover; edit 60s.',
    problem: 'Channel has zero videos; trailer establishes brand narrative. Requires manual screen recording + voiceover + editing.',
    proposedSolution: 'Follow trailer script in YOUTUBE_CHANNEL_ASSETS.md. Record terminal (model definition, addon install) + Board (skins, drag, filters). Voiceover in ID/EN. Edit to 60s. Upload with custom thumbnail from SM-003 pipeline.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'medium',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-003',
      'SM-015'
    ],
    blocks: [],
    tags: [
      'youtube',
      'trailer',
      'video-production',
      'launch'
    ],
    scope: {
      packages: [],
      files: [
        'moonwitness-youtube-thumbnail-template.jpg',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-016-ac-1',
        text: 'Trailer uploaded as public video',
        done: false
      },
      {
        id: 'SM-016-ac-2',
        text: 'Custom thumbnail set from automated template',
        done: false
      },
      {
        id: 'SM-016-ac-3',
        text: 'Title: MoonWitness Channel Trailer — Every model. One board.',
        done: false
      },
      {
        id: 'SM-016-ac-4',
        text: 'Description includes repo link & timestamps',
        done: false
      },
      {
        id: 'SM-016-ac-5',
        text: 'End screen: Subscribe + GitHub link',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Trailer video visible with custom thumbnail'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-017',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Write launch thread for 1.0.0-rc.1 (X + LinkedIn + Dev.to)',
    summary: 'Publish coordinated launch announcement: X thread "5 things MoonWitness eliminates", LinkedIn post with carousel, Dev.to article "Why we built MoonWitness". Link to GitHub release, docs, YouTube trailer.',
    problem: 'No launch announcement across platforms. 1.0.0-rc.1 released but not promoted.',
    proposedSolution: 'Draft thread: 1) Hook, 2) No SQL migrations, 3) Transactional addons, 4) Data-driven Board, 5) TypeScript-first, 6) Links. Cross-post to LinkedIn (carousel) and Dev.to (article). Use assets from SM-002 pipeline.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-008',
      'SM-009',
      'SM-010',
      'SM-011',
      'SM-012',
      'SM-013',
      'SM-014',
      'SM-015',
      'SM-016'
    ],
    blocks: [],
    tags: [
      'launch',
      'twitter',
      'linkedin',
      'devto',
      'announcement'
    ],
    scope: {
      packages: [],
      files: [
        'CHANGELOG.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-017-ac-1',
        text: 'X thread published with 6+ tweets + media',
        done: false
      },
      {
        id: 'SM-017-ac-2',
        text: 'LinkedIn post with carousel published',
        done: false
      },
      {
        id: 'SM-017-ac-3',
        text: 'Dev.to article published',
        done: false
      },
      {
        id: 'SM-017-ac-4',
        text: 'All posts link to GitHub release, docs, YouTube trailer',
        done: false
      },
      {
        id: 'SM-017-ac-5',
        text: 'Brand assets (OG card, X header) used from pipeline',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open X @moonwitness_xv',
        'Open LinkedIn page',
        'Open Dev.to article'
      ],
      expected: 'All three launch posts live with correct links and assets'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'CHANGELOG.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'CHANGELOG.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-018',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Create Shorts from trailer: 3 vertical cuts',
    summary: 'Extract 3 vertical (9:16) Shorts from trailer: 1) Brand hook (0-15s), 2) Model→API demo (15-35s), 3) Board skins reveal (35-60s). Upload to YouTube Shorts, cross-post to Reels/TikTok later.',
    problem: 'No short-form content. Shorts drive discovery and subscriber growth.',
    proposedSolution: 'Edit trailer into 3 vertical cuts using 9:16 safe area. Add captions (ID/EN). Upload as YouTube Shorts with #shorts hashtag. Use thumbnail pipeline for vertical format.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'medium',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-011',
      'SM-016'
    ],
    blocks: [],
    tags: [
      'youtube',
      'shorts',
      'vertical-video',
      'repurposing'
    ],
    scope: {
      packages: [],
      files: [
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-018-ac-1',
        text: 'Short 1: Brand hook (0-15s) uploaded',
        done: false
      },
      {
        id: 'SM-018-ac-2',
        text: 'Short 2: Model→API demo (15-35s) uploaded',
        done: false
      },
      {
        id: 'SM-018-ac-3',
        text: 'Short 3: Board skins reveal (35-60s) uploaded',
        done: false
      },
      {
        id: 'SM-018-ac-4',
        text: 'All Shorts have captions (ID/EN)',
        done: false
      },
      {
        id: 'SM-018-ac-5',
        text: 'Shorts use 9:16 format with safe area',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv/shorts'
      ],
      expected: '3 Shorts visible with captions'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-019',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'LinkedIn carousel: "From SQL migration to addon install — visual comparison"',
    summary: 'Create 5-7 slide carousel: 1) Problem: SQL migrations, 2) Old way: migration files, 3) MoonWitness: declarative model, 4) Addon install = feature install, 5) Rollback safety, 6) Board visual, 7) Get started link.',
    problem: 'No LinkedIn content. Carousel format performs well for technical comparisons.',
    proposedSolution: 'Design slides using brand tokens (Anton titles, Space Grotesk body, Yellow/Magenta accents). Export as 1080x1080 PNGs from pipeline. Post to LinkedIn company page.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-012'
    ],
    blocks: [],
    tags: [
      'linkedin',
      'carousel',
      'visual-comparison',
      'repurposing'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-019-ac-1',
        text: '5-7 slide carousel created',
        done: false
      },
      {
        id: 'SM-019-ac-2',
        text: 'Slides use brand tokens and visual style',
        done: false
      },
      {
        id: 'SM-019-ac-3',
        text: 'Exported as 1080x1080 PNGs',
        done: false
      },
      {
        id: 'SM-019-ac-4',
        text: 'Published to LinkedIn company page',
        done: false
      },
      {
        id: 'SM-019-ac-5',
        text: 'Caption with link to GitHub/docs',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open LinkedIn company page posts'
      ],
      expected: 'Carousel post visible with correct branding'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-020',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Dev.to article: "Building a SaaS admin panel in 5 min with metadata-driven ORM"',
    summary: 'Write tutorial article based on Episode 1 content: define model → install ORM → get REST API + Board. Include code snippets, screenshots, link to video.',
    problem: 'No Dev.to presence. Articles provide SEO and deep-dive content for developers searching solutions.',
    proposedSolution: 'Write article following Episode 1 structure. Use screenshots from Board/UI Catalog. Embed YouTube trailer/Shorts. Cross-link to GitHub, docs, YouTube.',
    category: 'documentation',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-008',
      'SM-010',
      'SM-016'
    ],
    blocks: [],
    tags: [
      'devto',
      'article',
      'seo',
      'tutorial',
      'repurposing'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-020-ac-1',
        text: 'Article published on Dev.to',
        done: false
      },
      {
        id: 'SM-020-ac-2',
        text: 'Includes code snippets and screenshots',
        done: false
      },
      {
        id: 'SM-020-ac-3',
        text: 'Links to GitHub, docs, YouTube',
        done: false
      },
      {
        id: 'SM-020-ac-4',
        text: 'Canonical URL points to Dev.to (or GitHub if cross-posted)',
        done: false
      },
      {
        id: 'SM-020-ac-5',
        text: 'Tags: typescript, postgresql, orm, saas, admin-panel',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open Dev.to article URL'
      ],
      expected: 'Article live with all elements'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-021',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-LAUNCH',
    horizon: 'now',
    title: 'Automate CI badge + version badge for README + social cards',
    summary: 'Add dynamic badges to README (build status, version, license) and generate social card variants with version badge for release announcements.',
    problem: 'README and social cards lack dynamic status badges. Manual updates needed per release.',
    proposedSolution: 'Add shields.io badges to README. Extend render-social.mjs to inject version from package.json into social card template for release announcements.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002'
    ],
    blocks: [],
    tags: [
      'automation',
      'badges',
      'readme',
      'social-cards',
      'ci'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'README.md',
        'packages/assets/scripts/render-social.mjs',
        'package.json'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-021-ac-1',
        text: 'README shows build status, version, license badges',
        done: false
      },
      {
        id: 'SM-021-ac-2',
        text: 'Social card template accepts {{VERSION}} variable',
        done: false
      },
      {
        id: 'SM-021-ac-3',
        text: 'Release announcement cards auto-generate with version',
        done: false
      }
    ],
    validation: {
      commands: [
        'cat README.md',
        'node packages/assets/scripts/render-social.mjs --format og'
      ],
      expected: 'Badges visible; version injected in social card'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'README.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'README.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-022',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Record Episode 1: Declarative Models in 5 Minutes (YT-004)',
    summary: 'Tutorial: define model → install ORM → get REST API + Board. 8-10 min. Follow episode plan in YOUTUBE_CHANNEL_ASSETS.md; record terminal + Board; add timestamps.',
    problem: 'Need first real tutorial content for developer onboarding.',
    proposedSolution: 'Record terminal session (model definition, pnpm add, server start) + Board interaction (view records, filters, skins). Voiceover ID/EN. Edit with chapters.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'medium',
    effort: 'm',
    scores: null,
    dependsOn: [
      'YT-003',
      'SM-003',
      'SM-009',
      'SM-011',
      'SM-012',
      'SM-016'
    ],
    blocks: [],
    tags: [
      'youtube',
      'tutorial',
      'episode-1',
      'declarative-models'
    ],
    scope: {
      packages: [],
      files: [
        'moonwitness-youtube-thumbnail-template.jpg',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-022-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'SM-022-ac-2',
        text: 'Custom thumbnail set from automated pipeline',
        done: false
      },
      {
        id: 'SM-022-ac-3',
        text: 'Chapters/timestamps in description',
        done: false
      },
      {
        id: 'SM-022-ac-4',
        text: 'Playlist "MoonWitness Tutorials" created & video added',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 1 video in playlist with thumbnail'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-023',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Derivatives for Episode 1 (thread, carousel, article, 2 Shorts)',
    summary: 'Create: X thread "Declarative models in 5 min", LinkedIn carousel "SQL vs Declarative", Dev.to article "Declarative models in 5 min", 2 Shorts (model definition, Board reveal).',
    problem: 'Each episode needs multi-platform derivatives for maximum reach.',
    proposedSolution: 'Use content repurposing framework. Extract key moments from Ep 1 recording. Generate assets via pipeline. Publish within 24h of YouTube upload.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-011',
      'SM-012',
      'SM-022',
      'SM-029',
      'SM-016'
    ],
    blocks: [],
    tags: [
      'repurposing',
      'episode-1',
      'twitter',
      'linkedin',
      'devto',
      'shorts'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-023-ac-1',
        text: 'X thread published with terminal + Board GIFs',
        done: false
      },
      {
        id: 'SM-023-ac-2',
        text: 'LinkedIn carousel published (5 slides)',
        done: false
      },
      {
        id: 'SM-023-ac-3',
        text: 'Dev.to article published (cross-post of video content)',
        done: false
      },
      {
        id: 'SM-023-ac-4',
        text: 'Short 1: Model definition uploaded',
        done: false
      },
      {
        id: 'SM-023-ac-5',
        text: 'Short 2: Board reveal uploaded',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open X @moonwitness_xv',
        'Open LinkedIn page',
        'Open Dev.to',
        'Open YouTube Shorts'
      ],
      expected: 'All derivatives published within 24h of Ep 1'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-024',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Record Episode 2: Addons — Install Features, Not SQL (YT-006)',
    summary: 'Tutorial: install auth/workflow addons transactionally; show rollback. Follow episode plan; record addon install/uninstall; highlight no SQL migrations.',
    problem: 'Core differentiator (addon system) needs dedicated demo.',
    proposedSolution: 'Record: pnpm add @moonwitness/addon-auth @moonwitness/addon-workflow → Board shows new models → uninstall → rollback. Voiceover ID/EN.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'medium',
    effort: 'm',
    scores: null,
    dependsOn: [
      'YT-004',
      'SM-003'
    ],
    blocks: [],
    tags: [
      'youtube',
      'tutorial',
      'episode-2',
      'addons'
    ],
    scope: {
      packages: [],
      files: [
        'moonwitness-youtube-thumbnail-template.jpg',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-024-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'SM-024-ac-2',
        text: 'Custom thumbnail set from automated pipeline',
        done: false
      },
      {
        id: 'SM-024-ac-3',
        text: 'Chapters/timestamps',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 2 video visible with thumbnail'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-025',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Derivatives for Episode 2',
    summary: 'Create: X thread "Transactional addons: safe feature rollout", LinkedIn carousel "Addon anatomy + rollback", Dev.to article "Transactional addons deep dive", Shorts (addon install, rollback demo).',
    problem: 'Each episode needs multi-platform derivatives.',
    proposedSolution: 'Same repurposing framework as Ep 1. Focus on transactional safety visual.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-011',
      'SM-012',
      'SM-024',
      'SM-029'
    ],
    blocks: [],
    tags: [
      'repurposing',
      'episode-2',
      'addons',
      'rollback'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-025-ac-1',
        text: 'X thread with rollback GIF published',
        done: false
      },
      {
        id: 'SM-025-ac-2',
        text: 'LinkedIn carousel with rollback visualization',
        done: false
      },
      {
        id: 'SM-025-ac-3',
        text: 'Dev.to article published',
        done: false
      },
      {
        id: 'SM-025-ac-4',
        text: '2 Shorts published',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open X @moonwitness_xv',
        'Open LinkedIn page',
        'Open Dev.to',
        'Open YouTube Shorts'
      ],
      expected: 'All Ep 2 derivatives published'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-026',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Record Episode 3: The Board — Your Data, Your Way (YT-007)',
    summary: 'Demo Board UI: multi-skin (default/compact/high-contrast/riot), dark mode, column drag, filters. Record Board interaction; showcase 4 skins; demonstrate data-driven UI.',
    problem: 'Board is visible differentiator; needs visual demo.',
    proposedSolution: 'Record: skin switcher, dark mode toggle, column drag, filter/sort, compact mode, high-contrast mode, riot mode. Voiceover ID/EN.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'medium',
    effort: 'm',
    scores: null,
    dependsOn: [
      'YT-006',
      'SM-003'
    ],
    blocks: [],
    tags: [
      'youtube',
      'tutorial',
      'episode-3',
      'board',
      'skins'
    ],
    scope: {
      packages: [],
      files: [
        'moonwitness-youtube-thumbnail-template.jpg',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-026-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'SM-026-ac-2',
        text: 'Custom thumbnail set from automated pipeline',
        done: false
      },
      {
        id: 'SM-026-ac-3',
        text: 'All 4 skins demoed',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 3 video visible with thumbnail'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md',
      'YOUTUBE_CHANNEL_ASSETS.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-027',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Derivatives for Episode 3',
    summary: 'Create: X thread "4 Board skins in 60 seconds", LinkedIn carousel "Skin comparison", Dev.to article "Data-driven admin UI", Shorts (skin switch, drag demo).',
    problem: 'Each episode needs multi-platform derivatives.',
    proposedSolution: 'Same repurposing framework. Visual-heavy: skin comparison GIFs, drag demo.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-011',
      'SM-012',
      'SM-026',
      'SM-029'
    ],
    blocks: [],
    tags: [
      'repurposing',
      'episode-3',
      'board',
      'skins'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-027-ac-1',
        text: 'X thread with skin comparison GIF',
        done: false
      },
      {
        id: 'SM-027-ac-2',
        text: 'LinkedIn carousel skin comparison',
        done: false
      },
      {
        id: 'SM-027-ac-3',
        text: 'Dev.to article published',
        done: false
      },
      {
        id: 'SM-027-ac-4',
        text: '2 Shorts published',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open X @moonwitness_xv',
        'Open LinkedIn page',
        'Open Dev.to',
        'Open YouTube Shorts'
      ],
      expected: 'All Ep 3 derivatives published'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-028',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Configure Home tab layout (YT-005)',
    summary: 'After first video published, enable Home tab sections: Featured video, Latest uploads, Shorts, Tutorials playlist. In Studio Customization > Home tab, add sections per content types.',
    problem: 'YouTube only shows layout editor after content exists.',
    proposedSolution: 'Once Ep 1 uploaded, configure Home tab in YouTube Studio.',
    category: 'product',
    type: 'feature',
    priority: 'p3',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'YT-003',
      'YT-004'
    ],
    blocks: [],
    tags: [
      'youtube',
      'home-tab',
      'layout',
      'channel-optimization'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-028-ac-1',
        text: 'Featured video section shows trailer',
        done: false
      },
      {
        id: 'SM-028-ac-2',
        text: 'Tutorials playlist section visible',
        done: false
      },
      {
        id: 'SM-028-ac-3',
        text: 'Shorts section enabled',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Home tab shows configured sections'
    },
    evidence: {
      paths: [
        'docs/operations/youtube-channel.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/youtube-channel.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/youtube-channel.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-029',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-EPISODES',
    horizon: 'next',
    title: 'Extract UI Catalog components as standalone GIFs for social',
    summary: 'Record GIFs of button variants, skin switches, kanban drag, modal animations from UI Catalog. Export as optimized GIFs/WebP for social media embedding.',
    problem: 'No reusable component animations for social posts. Static screenshots less engaging.',
    proposedSolution: 'Use Playwright to record interactions in UI Catalog (catalog.tsx). Export as GIF/WebP. Store in packages/assets/brand/rendered/ui-components/.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-002'
    ],
    blocks: [],
    tags: [
      'ui-catalog',
      'gifs',
      'components',
      'social-assets',
      'animation'
    ],
    scope: {
      packages: [
        'assets',
        'ui-catalog'
      ],
      files: [
        'packages/assets/scripts/record-ui-gifs.mjs',
        'apps/ui-catalog/src/catalog.tsx'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-029-ac-1',
        text: 'Script records 10+ component interactions as GIF/WebP',
        done: false
      },
      {
        id: 'SM-029-ac-2',
        text: 'Includes: button variants, skin switch, kanban drag, modal, toast',
        done: false
      },
      {
        id: 'SM-029-ac-3',
        text: 'Optimized for social (under 5MB each)',
        done: false
      },
      {
        id: 'SM-029-ac-4',
        text: 'Stored in packages/assets/brand/rendered/ui-components/',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/record-ui-gifs.mjs',
        'ls packages/assets/brand/rendered/ui-components/'
      ],
      expected: 'GIF/WebP files for key components'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'apps/ui-catalog/src/catalog.tsx'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'apps/ui-catalog/src/catalog.tsx'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-030',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Create Instagram/Threads account + Reels pipeline',
    summary: 'Create Instagram business account @moonwitness, Threads linked. Set up Reels pipeline: vertical templates, caption templates, hashtag sets. Cross-post from YouTube Shorts.',
    problem: 'No Instagram/Threads presence. Visual platform for younger developers and Reels discovery.',
    proposedSolution: 'Create accounts. Use brand assets. Adapt Shorts for Reels (add Instagram-native captions, hashtags). Schedule via Meta Business Suite.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-018'
    ],
    blocks: [],
    tags: [
      'instagram',
      'threads',
      'reels',
      'scale'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-030-ac-1',
        text: 'Instagram business account @moonwitness created',
        done: false
      },
      {
        id: 'SM-030-ac-2',
        text: 'Threads account linked',
        done: false
      },
      {
        id: 'SM-030-ac-3',
        text: 'Reels template (1080x1920) in pipeline',
        done: false
      },
      {
        id: 'SM-030-ac-4',
        text: 'First Reel cross-posted from Shorts',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open Instagram @moonwitness',
        'Open Threads @moonwitness'
      ],
      expected: 'Accounts active with brand assets'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-031',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Create TikTok account + Shorts pipeline',
    summary: 'Create TikTok account @moonwitness. Adapt Shorts for TikTok (trending audio, native captions, hashtags). Schedule via TikTok Creator Center.',
    problem: 'No TikTok presence. High viral potential for developer content.',
    proposedSolution: 'Create account. Use same vertical content. Add TikTok-native elements (trending sounds, effects). Cross-post schedule.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-018'
    ],
    blocks: [],
    tags: [
      'tiktok',
      'shorts',
      'scale'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-031-ac-1',
        text: 'TikTok account @moonwitness created',
        done: false
      },
      {
        id: 'SM-031-ac-2',
        text: 'First TikTok posted (adapted from Shorts)',
        done: false
      },
      {
        id: 'SM-031-ac-3',
        text: 'Cross-post workflow documented',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open TikTok @moonwitness'
      ],
      expected: 'Account active with content'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-032',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Set up content calendar system (Notion/Airtable/GitHub Projects)',
    summary: 'Create content calendar mapping each YT episode → 5 derivatives + schedule. Track status: planned → in-progress → review → published. Coordinate cross-platform timing.',
    problem: 'No system to track derivatives, schedule, or measure. TaskOS has YT tasks but no social-media series coordination.',
    proposedSolution: 'Set up Notion database or GitHub Project with fields: Episode, Platform, Format, Status, Due Date, Published URL, Metrics. Automate status updates via GitHub Actions where possible.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-023',
      'SM-025',
      'SM-027'
    ],
    blocks: [],
    tags: [
      'content-calendar',
      'planning',
      'coordination',
      'analytics'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'SM-032-ac-1',
        text: 'Calendar system created (Notion/Airtable/GitHub Projects)',
        done: false
      },
      {
        id: 'SM-032-ac-2',
        text: 'Template: Episode → 5 derivatives with due dates',
        done: false
      },
      {
        id: 'SM-032-ac-3',
        text: 'Status tracking: planned/in-progress/review/published',
        done: false
      },
      {
        id: 'SM-032-ac-4',
        text: 'Cross-platform timing coordination visible',
        done: false
      },
      {
        id: 'SM-032-ac-5',
        text: 'Metrics tracking columns (views, engagement)',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open content calendar'
      ],
      expected: 'Calendar populated with Ep 1-3 derivatives and schedule'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-033',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Add app store screenshot templates',
    summary: 'Create iOS screenshot template (1290x2796) and Android template (1080x1920) with device frame overlays, Board UI placeholder slots, and brand-compliant styling. For future mobile app or PWA listing.',
    problem: 'No app store screenshot templates. Needed for future mobile distribution.',
    proposedSolution: 'Design SVG templates in packages/assets/brand/ with device frames (iPhone 15 Pro, Pixel 8). Placeholders for Board screens. Brand-compliant styling.',
    category: 'product',
    type: 'feature',
    priority: 'p3',
    status: 'backlog',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-001',
      'SM-002'
    ],
    blocks: [],
    tags: [
      'app-store',
      'screenshots',
      'ios',
      'android',
      'future'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/brand/ios-screenshot-6.7.svg',
        'packages/assets/brand/android-screenshot.svg'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-033-ac-1',
        text: 'iOS template (1290x2796) with device frame',
        done: false
      },
      {
        id: 'SM-033-ac-2',
        text: 'Android template (1080x1920) with device frame',
        done: false
      },
      {
        id: 'SM-033-ac-3',
        text: 'Board UI placeholder slots',
        done: false
      },
      {
        id: 'SM-033-ac-4',
        text: 'Brand-compliant styling (tokens.css)',
        done: false
      },
      {
        id: 'SM-033-ac-5',
        text: 'Renderable via pipeline',
        done: false
      }
    ],
    validation: {
      commands: [
        'ls packages/assets/brand/*screenshot*.svg',
        'node packages/assets/scripts/render-social.mjs --format ios-screenshot'
      ],
      expected: 'Templates exist and render'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'packages/ui/src/styles/tokens.css'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'packages/ui/src/styles/tokens.css'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-034',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Mobile Board responsive demo GIF (320px viewport)',
    summary: 'Record Board at 320px viewport showing mobile navigation drawer, compact cards, touch interactions. Export as GIF/WebP for Twitter/LinkedIn mobile demo posts.',
    problem: 'No mobile responsive demo asset. Board mobile UX is a key differentiator (M3.04).',
    proposedSolution: 'Use Playwright to resize Board to 320px, record interactions (drawer open, card tap, filter, skin switch). Export optimized GIF.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [
      'SM-002',
      'SM-029'
    ],
    blocks: [],
    tags: [
      'mobile',
      'board',
      'responsive',
      'gif',
      'demo'
    ],
    scope: {
      packages: [
        'assets'
      ],
      files: [
        'packages/assets/scripts/record-mobile-board.mjs'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-034-ac-1',
        text: 'GIF shows mobile drawer, compact cards, touch interactions',
        done: false
      },
      {
        id: 'SM-034-ac-2',
        text: 'Recorded at 320px viewport',
        done: false
      },
      {
        id: 'SM-034-ac-3',
        text: 'Optimized under 5MB',
        done: false
      },
      {
        id: 'SM-034-ac-4',
        text: 'Used in Twitter/LinkedIn posts',
        done: false
      }
    ],
    validation: {
      commands: [
        'node packages/assets/scripts/record-mobile-board.mjs',
        'ls packages/assets/brand/rendered/mobile-board.gif'
      ],
      expected: 'Mobile Board GIF created and used'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md',
        'ROADMAP.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md',
      'ROADMAP.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  },
  {
    code: 'SM-035',
    project: 'moonwitness',
    series: 'SM',
    milestone: 'SM-SCALE',
    horizon: 'later',
    title: 'Analytics dashboard + monthly review process',
    summary: 'Build or configure analytics dashboard (Plausible/GA for docs, platform native for social). Monthly review: metrics vs targets, content performance, strategy adjustment.',
    problem: 'No measurement system. Cannot optimize without data.',
    proposedSolution: 'Add Plausible to docs site. Use platform analytics (YouTube Studio, X Analytics, LinkedIn Analytics, Dev.to Stats). Create monthly review template in content calendar. Quarterly strategy review.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'backlog',
    human: true,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: null,
    dependsOn: [
      'SM-008',
      'SM-032'
    ],
    blocks: [],
    tags: [
      'analytics',
      'measurement',
      'review',
      'optimization'
    ],
    scope: {
      packages: [],
      files: [
        'docs/',
        'content-calendar'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'SM-035-ac-1',
        text: 'Plausible/GA on docs site',
        done: false
      },
      {
        id: 'SM-035-ac-2',
        text: 'Monthly review template in calendar',
        done: false
      },
      {
        id: 'SM-035-ac-3',
        text: 'Quarterly metrics vs targets documented',
        done: false
      },
      {
        id: 'SM-035-ac-4',
        text: 'First monthly review completed',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open docs site analytics',
        'Open content calendar review'
      ],
      expected: 'Analytics active; review process running'
    },
    evidence: {
      paths: [
        'docs/operations/social-media-grand-plan.md'
      ],
      detailFile: null,
      commitSha: null
    },
    references: [
      'docs/operations/social-media-grand-plan.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'docs/operations/social-media-grand-plan.md',
      legacyId: null
    },
    url: '',
    metadata: {},
    comments: []
  }
];
