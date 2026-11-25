// YT task source for TaskOS sweep - YouTube channel
export const YT_TASKS = [
  {
    code: 'YT-001',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'now',
    title: 'Setup channel branding & assets (banner, logo, watermark, description)',
    summary: 'Upload banner, profile photo, watermark, set description, add GitHub link & contact email via YouTube Studio.',
    problem: 'Channel moonwitness existed but empty; needs full brand setup from repo assets.',
    proposedSolution: 'Use generated assets from YOUTUBE_CHANNEL_ASSETS.md; upload via Studio Customization tabs.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'done',
    human: false,
    owner: null,
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'youtube',
      'branding',
      'channel-setup'
    ],
    scope: {
      packages: [],
      files: [
        'moonwitness-youtube-banner.jpg',
        'moonwitness-youtube-logo.jpg',
        'moonwitness-youtube-watermark.jpg',
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'YT-001-ac-1',
        text: 'Banner uploaded',
        done: true
      },
      {
        id: 'YT-001-ac-2',
        text: 'Profile photo uploaded',
        done: true
      },
      {
        id: 'YT-001-ac-3',
        text: 'Watermark uploaded',
        done: true
      },
      {
        id: 'YT-001-ac-4',
        text: 'Description published',
        done: true
      },
      {
        id: 'YT-001-ac-5',
        text: 'GitHub link added',
        done: true
      },
      {
        id: 'YT-001-ac-6',
        text: 'Contact email added',
        done: true
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Channel shows banner, logo, watermark, description, links'
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
    code: 'YT-002',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'now',
    title: 'Publish full bilingual channel description (EN + ID) on Basic Info tab',
    summary: 'Studio Basic Info tab errors in headless; need manual paste of 1500-char EN+ID description with SEO keywords.',
    problem: 'Current description is ID-only 592 chars; EN version + full SEO text missing.',
    proposedSolution: 'Copy description from YOUTUBE_CHANNEL_ASSETS.md to studio.youtube.com/.../editing/basic manually.',
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
      'YT-001'
    ],
    blocks: [],
    tags: [
      'youtube',
      'description',
      'seo',
      'bilingual'
    ],
    scope: {
      packages: [],
      files: [
        'YOUTUBE_CHANNEL_ASSETS.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'YT-002-ac-1',
        text: 'EN description visible',
        done: false
      },
      {
        id: 'YT-002-ac-2',
        text: 'ID description visible',
        done: false
      },
      {
        id: 'YT-002-ac-3',
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
    code: 'YT-003',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'now',
    title: 'Record & upload channel trailer (60s) + custom thumbnail',
    summary: 'Record scripted trailer per YOUTUBE_CHANNEL_ASSETS.md; export 1080p; upload with custom thumbnail from template.',
    problem: 'Channel has zero videos; trailer establishes brand narrative.',
    proposedSolution: 'Screen-record terminal + Board demo per script; voiceover; edit 60s; upload to YouTube.',
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
      'YT-001'
    ],
    blocks: [],
    tags: [
      'youtube',
      'trailer',
      'video-production'
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
        id: 'YT-003-ac-1',
        text: 'Trailer uploaded as public video',
        done: false
      },
      {
        id: 'YT-003-ac-2',
        text: 'Custom thumbnail set from template',
        done: false
      },
      {
        id: 'YT-003-ac-3',
        text: 'Title: MoonWitness Channel Trailer -- Every model. One board.',
        done: false
      },
      {
        id: 'YT-003-ac-4',
        text: 'Description includes repo link & timestamps',
        done: false
      },
      {
        id: 'YT-003-ac-5',
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
    code: 'YT-004',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'next',
    title: 'Record Episode 1: Declarative Models in 5 Minutes',
    summary: 'Tutorial: define model -> install ORM -> get REST API + Board. 8-10 min.',
    problem: 'Need first real tutorial content for developer onboarding.',
    proposedSolution: 'Follow episode plan in YOUTUBE_CHANNEL_ASSETS.md; record terminal + Board; add timestamps.',
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
      'YT-003'
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
        id: 'YT-004-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'YT-004-ac-2',
        text: 'Custom thumbnail set',
        done: false
      },
      {
        id: 'YT-004-ac-3',
        text: 'Chapters/timestamps in description',
        done: false
      },
      {
        id: 'YT-004-ac-4',
        text: 'Playlist "MoonWitness Tutorials" created & video added',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 1 video in playlist'
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
    code: 'YT-005',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'next',
    title: 'Configure Home tab layout (Videos, Shorts, Playlists sections)',
    summary: 'After first video published, enable Home tab sections: Featured video, Latest uploads, Shorts, Tutorials playlist.',
    problem: 'YouTube only shows layout editor after content exists.',
    proposedSolution: 'In Studio Customization > Home tab, add sections per content types.',
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
      'YT-004',
      'SM-016',
      'SM-022'
    ],
    blocks: [],
    tags: [
      'youtube',
      'home-tab',
      'layout'
    ],
    scope: {
      packages: [],
      files: []
    },
    acceptanceCriteria: [
      {
        id: 'YT-005-ac-1',
        text: 'Featured video section shows trailer',
        done: false
      },
      {
        id: 'YT-005-ac-2',
        text: 'Tutorials playlist section visible',
        done: false
      },
      {
        id: 'YT-005-ac-3',
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
    code: 'YT-006',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'next',
    title: 'Record Episode 2: Addons -- Install Features, Not SQL',
    summary: 'Tutorial: install auth/workflow addons transactionally; show rollback.',
    problem: 'Core differentiator (addon system) needs dedicated demo.',
    proposedSolution: 'Follow episode plan; record addon install/uninstall; highlight no SQL migrations.',
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
      'SM-022'
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
        id: 'YT-006-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'YT-006-ac-2',
        text: 'Custom thumbnail set',
        done: false
      },
      {
        id: 'YT-006-ac-3',
        text: 'Chapters/timestamps',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 2 video visible'
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
    code: 'YT-007',
    project: 'moonwitness',
    series: 'YT',
    milestone: 'YT',
    horizon: 'next',
    title: 'Record Episode 3: The Board -- Your Data, Your Way',
    summary: 'Demo Board UI: multi-skin (default/compact/high-contrast/riot), dark mode, column drag, filters.',
    problem: 'Board is visible differentiator; needs visual demo.',
    proposedSolution: 'Record Board interaction; showcase 4 skins; demonstrate data-driven UI.',
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
      'SM-024'
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
        id: 'YT-007-ac-1',
        text: 'Video uploaded',
        done: false
      },
      {
        id: 'YT-007-ac-2',
        text: 'Custom thumbnail set',
        done: false
      },
      {
        id: 'YT-007-ac-3',
        text: 'All 4 skins demoed',
        done: false
      }
    ],
    validation: {
      commands: [
        'Open https://www.youtube.com/@moonwitness-xv'
      ],
      expected: 'Episode 3 video visible'
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
  }
];
