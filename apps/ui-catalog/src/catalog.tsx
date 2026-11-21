import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import {
  ActivityIcon,
  AddIcon,
  ArrowRightIcon,
  AttachmentIcon,
  CalendarIcon,
  CompanyIcon,
  DeleteIcon,
  EditIcon,
  FilterIcon,
  ModelIcon,
  SearchIcon,
  SecurityIcon,
  SettingsIcon,
  UserIcon,
  ArrowLeftIcon,
  BookmarkIcon,
  CheckCircleIcon,
  ClockIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  SendIcon,
  SignalOffIcon,
  SmartphoneIcon,
} from '@moonwitness/ui/icons';
import { Avatar } from '@moonwitness/ui/components/avatar';
import { Badge } from '@moonwitness/ui/components/badge';
import { BarChart, LineChart } from '@moonwitness/ui/components/chart';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import { Button } from '@moonwitness/ui/components/button';
import { ArtworkFrame } from '@moonwitness/ui/components/artwork-frame';
import homeHeroDesktop from '@moonwitness/assets/illustrations/home-hero-desktop.webp';
import homeHeroMobile from '@moonwitness/assets/illustrations/home-hero-mobile.webp';
import boardMasthead from '@moonwitness/assets/illustrations/board-masthead.webp';
import lockupDark from '@moonwitness/assets/brand/moonwitness-lockup-dark.svg';
import lockupLight from '@moonwitness/assets/brand/moonwitness-lockup-light.svg';
import symbolDark from '@moonwitness/assets/brand/moonwitness-symbol-dark.svg';
import tornEdgeTopUrl from '@moonwitness/assets/materials/torn-edge-top.svg';
import tornCornerTlUrl from '@moonwitness/assets/materials/torn-corner-tl.svg';
import brushStripShortUrl from '@moonwitness/assets/materials/brush-strip-short.svg';
import paperNoteUrl from '@moonwitness/assets/materials/paper-note.svg';
import tapeStripUrl from '@moonwitness/assets/materials/tape-strip.svg';
import foldedCornerUrl from '@moonwitness/assets/materials/folded-corner.svg';
import stampOutlineUrl from '@moonwitness/assets/materials/stamp-outline.svg';
import inkSplatterSmUrl from '@moonwitness/assets/materials/ink-splatter-sm.svg';
import tileHalftoneUrl from '@moonwitness/assets/materials/tile-halftone.svg';
import scuffedBorderUrl from '@moonwitness/assets/materials/scuffed-border.svg';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PaperNote } from '@moonwitness/ui/components/paper-note';
import { SectionRibbon } from '@moonwitness/ui/components/section-ribbon';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@moonwitness/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@moonwitness/ui/components/dropdown-menu';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { Field } from '@moonwitness/ui/components/field';
import { Input } from '@moonwitness/ui/components/input';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Pagination } from '@moonwitness/ui/components/pagination';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@moonwitness/ui/components/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@moonwitness/ui/components/command';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@moonwitness/ui/components/popover';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@moonwitness/ui/components/sheet';
import { Switch } from '@moonwitness/ui/components/switch';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import { toast, ToastHost } from '@moonwitness/ui/components/toast';
import { SoundProvider, SoundToggle, useSfx } from '@moonwitness/ui/components/audio';
import {
  DecorativeMotif,
  Doodle,
  InkUnderline,
  LiveIndicator,
  LoadingProgress,
  LoadingSpinner,
  SignalOrbit,
  SpeechBubble,
  SpeedLines,
  type DecorativeMotifKind,
} from '@moonwitness/ui/components/effects';
import { Toolbar } from '@moonwitness/ui/components/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@moonwitness/ui/components/tooltip';

const sections = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'board-proof', label: 'Board dashboard proof' },
  { id: 'brand', label: 'Brand' },
  { id: 'typography', label: 'Typography' },
  { id: 'materials', label: 'Materials' },
  { id: 'icons-materials', label: 'Icons & Materials' },
  { id: 'workbench-proof', label: 'Story Workbench proof' },
  { id: 'editorial-proof', label: 'Editorial proof' },
  { id: 'actions', label: 'Actions & feedback' },
  { id: 'forms', label: 'Forms' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'data-display', label: 'Data display' },
  { id: 'charts', label: 'Charts' },
] as const;

const chartData = [
  { label: 'Base', value: 42 },
  { label: 'CRM', value: 28 },
  { label: 'Inventory', value: 19 },
];

const iconSamples: { Component: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
  { Component: ActivityIcon, label: 'Activity' },
  { Component: AddIcon, label: 'Add' },
  { Component: AttachmentIcon, label: 'Attachment' },
  { Component: CalendarIcon, label: 'Calendar' },
  { Component: CompanyIcon, label: 'Company' },
  { Component: DeleteIcon, label: 'Delete' },
  { Component: EditIcon, label: 'Edit' },
  { Component: FilterIcon, label: 'Filter' },
  { Component: ModelIcon, label: 'Model' },
  { Component: SearchIcon, label: 'Search' },
  { Component: SecurityIcon, label: 'Security' },
  { Component: SettingsIcon, label: 'Settings' },
  { Component: UserIcon, label: 'User' },
];

const iconScaleSizes = [16, 20, 24, 32] as const;

const iconScaleSamples: { Component: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
  { Component: ArrowLeftIcon, label: 'ArrowLeft' },
  { Component: BookmarkIcon, label: 'Bookmark' },
  { Component: CheckCircleIcon, label: 'CheckCircle' },
  { Component: ClockIcon, label: 'Clock' },
  { Component: FileSpreadsheetIcon, label: 'FileSpreadsheet' },
  { Component: HistoryIcon, label: 'History' },
  { Component: SendIcon, label: 'Send' },
  { Component: SignalOffIcon, label: 'SignalOff' },
  { Component: SmartphoneIcon, label: 'Smartphone' },
];

const materialAssets = [
  { name: 'torn-edge-top.svg', src: tornEdgeTopUrl },
  { name: 'torn-corner-tl.svg', src: tornCornerTlUrl },
  { name: 'brush-strip-short.svg', src: brushStripShortUrl },
  { name: 'paper-note.svg', src: paperNoteUrl },
  { name: 'tape-strip.svg', src: tapeStripUrl },
  { name: 'folded-corner.svg', src: foldedCornerUrl },
  { name: 'stamp-outline.svg', src: stampOutlineUrl },
  { name: 'ink-splatter-sm.svg', src: inkSplatterSmUrl },
  { name: 'tile-halftone.svg', src: tileHalftoneUrl },
  { name: 'scuffed-border.svg', src: scuffedBorderUrl },
] as const;

const doodleKinds = ['star', 'bolt', 'smiley', 'arrow', 'crown'] as const;

const motifKinds: readonly DecorativeMotifKind[] = [
  'underline',
  'cross-out',
  'orbit',
  'globe-grid',
  'moon-phases',
  'eye-target',
];

const initialWorkbenchPages = [
  {
    id: 'page-1',
    number: '01',
    title: 'Opening scene',
    draft: '  Line 01: Night market signal\n    Indented field note\n\tTabbed source cue',
  },
  {
    id: 'page-2',
    number: '02',
    title: 'Field interview',
    draft: '  Line 02: Harbor witness record\n    Quoted context preserved',
  },
  {
    id: 'page-3',
    number: '03',
    title: 'Closing signal',
    draft: '  Line 03: Shared moon epilogue\n    Final verification mark',
  },
];

function Example({
  title,
  description,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={wide ? 'catalog-example catalog-example-wide' : 'catalog-example'}>
      <div className="catalog-example-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="catalog-example-stage">{children}</div>
    </article>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="catalog-section" id={id} aria-labelledby={`${id}-heading`}>
      <header className="catalog-section-heading">
        <p className="catalog-kicker">COMPONENT SET</p>
        <h2 id={`${id}-heading`}>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="catalog-examples">{children}</div>
    </section>
  );
}

function CatalogContent() {
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(true);
  const [indeterminateChecked, setIndeterminateChecked] = useState<boolean | 'indeterminate'>(
    'indeterminate'
  );
  const [autoPublish, setAutoPublish] = useState(true);
  const [assignment, setAssignment] = useState('none');
  const [notesValue, setNotesValue] = useState('  First line\n    Indented detail');
  const [query, setQuery] = useState('');
  const [addonSort, setAddonSort] = useState<'ascending' | 'descending' | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [workbenchPages, setWorkbenchPages] = useState(initialWorkbenchPages);
  const [activeWorkbenchPageId, setActiveWorkbenchPageId] = useState('page-1');
  const [selectedCommand, setSelectedCommand] = useState('Create story');
  const { play } = useSfx();

  const activeWorkbenchIndex = Math.max(
    0,
    workbenchPages.findIndex((entry) => entry.id === activeWorkbenchPageId)
  );
  const activeWorkbenchPage = workbenchPages[activeWorkbenchIndex] ?? workbenchPages[0];

  function updateWorkbenchDraft(nextDraft: string) {
    setWorkbenchPages((current) =>
      current.map((entry) =>
        entry.id === activeWorkbenchPage.id ? { ...entry, draft: nextDraft } : entry
      )
    );
  }

  function addWorkbenchPage() {
    const nextNumber = String(workbenchPages.length + 1).padStart(2, '0');
    const nextId = `page-${workbenchPages.length + 1}`;
    setWorkbenchPages((current) => [
      ...current,
      {
        id: nextId,
        number: nextNumber,
        title: `Draft page ${nextNumber}`,
        draft: `  Line ${nextNumber}: Synthetic page body\n    Indented detail`,
      },
    ]);
    setActiveWorkbenchPageId(nextId);
  }

  function moveActiveWorkbenchPageUp() {
    if (activeWorkbenchIndex <= 0) return;
    setWorkbenchPages((current) => {
      const next = [...current];
      const [moved] = next.splice(activeWorkbenchIndex, 1);
      next.splice(activeWorkbenchIndex - 1, 0, moved);
      return next;
    });
  }

  const addons = [
    ['Base', 'Platform team', 'Active'],
    ['CRM', 'Operations', 'Review'],
    ['Inventory', 'Supply group', 'Active'],
    ['Analytics', 'Research team', 'Active'],
    ['Media', 'Editorial team', 'Review'],
    ['Timeline', 'Platform team', 'Active'],
  ];
  const filteredAddons = addons
    .filter(([name]) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((left, right) =>
      addonSort === null
        ? 0
        : left[0].localeCompare(right[0]) * (addonSort === 'ascending' ? 1 : -1)
    );
  const pageCount = Math.max(1, Math.ceil(filteredAddons.length / 3));
  const currentPage = Math.min(page, pageCount);
  const visibleAddons = filteredAddons.slice((currentPage - 1) * 3, currentPage * 3);
  const allVisibleAddonsSelected =
    visibleAddons.length > 0 && visibleAddons.every(([name]) => selectedAddons.includes(name));

  function toggleVisibleAddons() {
    setSelectedAddons((current) =>
      allVisibleAddonsSelected
        ? current.filter((name) => !visibleAddons.some(([visibleName]) => visibleName === name))
        : [...new Set([...current, ...visibleAddons.map(([name]) => name)])]
    );
  }

  function toggleTheme() {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }

  return (
    <TooltipProvider>
      <div className="catalog-shell">
        <a className="skip-link" href="#catalog-main">
          Skip to components
        </a>
        <aside className="catalog-sidebar" aria-label="Catalog navigation">
          <a className="catalog-brand" href="#top" aria-label="MoonWitness UI catalog home">
            <img className="catalog-brand-symbol" src={symbolDark} alt="" />
            <span>
              <strong>MOONWITNESS</strong>
              <small>UI CATALOG</small>
            </span>
          </a>
          <nav className="catalog-nav" aria-label="Component sections">
            <span className="catalog-nav-label">LIBRARY</span>
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
          </nav>
          <div className="catalog-sidebar-footer">
            <span>Shared tokens · RC.1</span>
            <span>Keyboard friendly</span>
          </div>
        </aside>

        <main id="catalog-main" className="catalog-main">
          <header className="catalog-topbar" id="top">
            <div>
              <span className="catalog-breadcrumb">Design system / UI package</span>
              <span className="catalog-version">v1.0.0-rc.1</span>
            </div>
            <Button variant="outline" size="sm" onClick={toggleTheme} aria-pressed={dark}>
              {dark ? 'Use light theme' : 'Use dark theme'}
            </Button>
          </header>

          <div className="catalog-content">
            <PageHeader
              title={
                <>
                  One system. <span className="catalog-highlight">Every screen.</span>
                </>
              }
              description="A practical catalog of the shared MoonWitness UI package. Explore real components, keyboard behavior, themes, and responsive states."
              actions={<Badge variant="primary">88 typed icons</Badge>}
            />
            <Panel
              className="catalog-intro-panel"
              title="MoonWitness visual system"
              description="Shared assets, readable controls, and expressive editorial details are built from the public @moonwitness/ui package."
            >
              <div className="catalog-intro-meta">
                <span>
                  <strong>88</strong> typed icons
                </span>
                <span>
                  <strong>4</strong> new compositions
                </span>
                <span>
                  <strong>AA</strong> contrast checked
                </span>
              </div>
            </Panel>
            <Section
              id="foundations"
              title="Foundations"
              description="Semantic color, type, identity, and surface primitives. Switch themes to inspect both token maps."
            >
              <Example
                title="Semantic colors"
                description="Theme-aware surfaces and status colors keep meaning stable."
              >
                <div className="swatch-grid">
                  {[
                    ['Page', 'var(--mw-background)'],
                    ['Surface', 'var(--mw-surface)'],
                    ['Primary', 'var(--mw-primary)'],
                    ['Destructive', 'var(--mw-destructive)'],
                    ['Success', 'var(--mw-success)'],
                    ['Info', 'var(--mw-info)'],
                  ].map(([label, color]) => (
                    <div className="swatch" key={label}>
                      <span style={{ backgroundColor: color }} />
                      <small>{label}</small>
                    </div>
                  ))}
                </div>
              </Example>
              <Example
                title="Identity & status"
                description="Avatar initials stay accessible; badges retain text labels across themes."
              >
                <div className="catalog-inline">
                  <Avatar name="MoonWitness" />
                  <Avatar name="System Operator" />
                  <Badge>Draft</Badge>
                  <Badge variant="primary">Active</Badge>
                  <Badge variant="destructive">Blocked</Badge>
                </div>
              </Example>
              <Example
                title="Typed product icons"
                description="Canonical vector paths generate individually importable, tree-shakeable React icons."
              >
                <div className="icon-grid">
                  {iconSamples.map(({ Component, label }) => (
                    <span className="icon-sample" key={label}>
                      <Component aria-hidden="true" /> <small>{label}</small>
                    </span>
                  ))}
                </div>
              </Example>
              <Example
                title="Editorial composition"
                description="These reusable package components create the visual rhythm used by the homepage and Board."
              >
                <SectionRibbon title="Stories" number="01" accent="magenta" />
                <div className="catalog-inline">
                  <PaperNote accent="yellow">Same moon. Different people.</PaperNote>
                  <MetricTile label="Stories in progress" value="12" detail="Example design data" />
                  <ArtworkFrame shape="portrait" caption="Example artwork">
                    <img src={homeHeroMobile} alt="Illustrative night city artwork" />
                  </ArtworkFrame>
                </div>
              </Example>
            </Section>
            <Section
              id="board-proof"
              title="Board dashboard proof"
              description="A dashboard composition inspired by the command-center reference. Values and records below are illustrative design samples, not live MoonWitness data."
            >
              <Example
                title="Command center · sample layout"
                description="Review the masthead, dense navigation, KPI rhythm, operational panels, and responsive collapse using shared package components."
              >
                <div className="catalog-board-proof">
                  <aside className="catalog-board-rail" aria-label="Sample dashboard navigation">
                    <div className="catalog-board-identity">
                      <img src={symbolDark} alt="" />
                      <span>
                        MOONWITNESS<small>COMMAND CENTER</small>
                      </span>
                    </div>
                    <div className="catalog-board-rail-menu" aria-hidden="true">
                      <span className="is-active">
                        <ActivityIcon /> Overview
                      </span>
                      <span>
                        <ModelIcon /> Stories
                      </span>
                      <span>
                        <CompanyIcon /> Companies
                      </span>
                      <span>
                        <UserIcon /> People
                      </span>
                      <span>
                        <SettingsIcon /> Settings
                      </span>
                    </div>
                    <p className="catalog-board-rail-note">
                      DESIGN SAMPLE
                      <br />
                      NOT LIVE DATA
                    </p>
                  </aside>
                  <div className="catalog-board-main">
                    <header className="catalog-board-masthead">
                      <img src={boardMasthead} alt="" />
                      <div>
                        <p>MOONWITNESS NETWORK · SAMPLE VIEW</p>
                        <h3>
                          SHADOW <span>COMMAND CENTER</span>
                        </h3>
                        <strong>Stories observed. People amplified. Worlds connected.</strong>
                      </div>
                    </header>
                    <div className="catalog-board-sample-label">
                      <Badge variant="primary">Contoh desain</Badge>
                      <span>All values are illustrative and do not represent production data.</span>
                    </div>
                    <div className="catalog-board-metrics">
                      <MetricTile
                        label="Partners"
                        value="24"
                        detail="Sample records"
                        accent="magenta"
                        surface="paper"
                        frame="torn"
                        icon={<CompanyIcon />}
                      />
                      <MetricTile
                        label="Active users"
                        value="18"
                        detail="Sample accounts"
                        accent="cyan"
                        surface="paper"
                        frame="torn"
                        icon={<UserIcon />}
                      />
                      <MetricTile
                        label="Companies"
                        value="12"
                        detail="Sample records"
                        accent="yellow"
                        surface="paper"
                        frame="torn"
                        icon={<ModelIcon />}
                      />
                      <MetricTile
                        label="Planned activities"
                        value="07"
                        detail="Sample schedule"
                        accent="violet"
                        surface="paper"
                        frame="torn"
                        icon={<CalendarIcon />}
                      />
                    </div>
                    <div className="catalog-board-panels">
                      <Panel
                        className="catalog-board-work-panel"
                        title="Planned activities"
                        description="Illustrative schedule entries"
                        surface="ink"
                        frame="torn"
                        density="compact"
                        headingLevel={4}
                        actions={
                          <Button variant="outline" size="xs">
                            View sample
                          </Button>
                        }
                      >
                        <ul className="catalog-board-activity-list">
                          <li>
                            <span className="catalog-board-dot" /> <span>Review field notes</span>
                            <Badge>Today</Badge>
                          </li>
                          <li>
                            <span className="catalog-board-dot" />{' '}
                            <span>Prepare story outline</span>
                            <Badge>Tomorrow</Badge>
                          </li>
                          <li>
                            <span className="catalog-board-dot" />{' '}
                            <span>Check source references</span>
                            <Badge>Friday</Badge>
                          </li>
                        </ul>
                      </Panel>
                      <Panel
                        className="catalog-board-work-panel"
                        title="Recent activity"
                        description="Illustrative system events"
                        surface="ink"
                        frame="torn"
                        density="compact"
                        headingLevel={4}
                      >
                        <ul className="catalog-board-event-list">
                          <li>
                            <ActivityIcon aria-hidden="true" />
                            <span>
                              <strong>Draft updated</strong>
                              <small>Sample story · 12 min ago</small>
                            </span>
                          </li>
                          <li>
                            <AttachmentIcon aria-hidden="true" />
                            <span>
                              <strong>Reference added</strong>
                              <small>Sample record · 38 min ago</small>
                            </span>
                          </li>
                          <li>
                            <SecurityIcon aria-hidden="true" />
                            <span>
                              <strong>Access reviewed</strong>
                              <small>Sample workspace · 1 hr ago</small>
                            </span>
                          </li>
                        </ul>
                      </Panel>
                    </div>
                  </div>
                </div>
              </Example>
            </Section>
            <Section
              id="brand"
              title="Brand system"
              description="These lockups come from the canonical vector master in @moonwitness/assets. Use the crown symbol for compact rails and keep the full MoonWitness wordmark wherever it fits."
            >
              <Example
                title="Canonical lockups"
                description="The same editable master produces contrast-safe light and dark variants. The wordmark remains a vector path, not an image of text."
              >
                <div className="brand-variant-grid">
                  <figure className="brand-variant brand-variant-paper">
                    <img
                      src={lockupLight}
                      alt="MoonWitness crown and wordmark, dark ink on paper"
                    />
                    <figcaption>Paper surface · full lockup</figcaption>
                  </figure>
                  <figure className="brand-variant brand-variant-ink">
                    <img src={lockupDark} alt="MoonWitness crown and wordmark, paper ink on dark" />
                    <figcaption>Ink surface · full lockup</figcaption>
                  </figure>
                  <figure className="brand-variant brand-variant-paper brand-variant-symbol">
                    <img src={symbolDark} alt="MoonWitness crown symbol" />
                    <figcaption>Compact rail · crown symbol</figcaption>
                  </figure>
                </div>
              </Example>
            </Section>
            <Section
              id="typography"
              title="Typography"
              description="Expressive brush lettering is reserved for short headlines. Condensed display, readable UI text, and mono metadata keep data and controls clear."
            >
              <Example
                title="Four type roles"
                description="The specimens use local package fonts and semantic typography tokens."
              >
                <div className="type-specimen-list">
                  <div className="type-specimen type-specimen-brush">
                    <span>Brush display · short headlines</span>
                    <strong>FOLLOW THE SIGNAL</strong>
                  </div>
                  <div className="type-specimen type-specimen-condensed">
                    <span>Condensed display · section titles and metrics</span>
                    <strong>02 STORIES IN PROGRESS</strong>
                  </div>
                  <div className="type-specimen type-specimen-body">
                    <span>Space Grotesk · product copy and controls</span>
                    <strong>Different people. Shared context.</strong>
                  </div>
                  <div className="type-specimen type-specimen-mono">
                    <span>JetBrains Mono · identifiers and metadata</span>
                    <strong>MW:STORY:EDITORIAL-001 · 14:32 UTC</strong>
                  </div>
                  <div
                    className="type-specimen type-specimen-body"
                    data-testid="typography-copy-stress"
                  >
                    <span>
                      Space Grotesk · Indonesian copy, punctuation, numbers, and long words
                    </span>
                    <p>
                      Kisah lintas generasi ini memuat pertanggungjawaban, angka Rp1.234.567,
                      tanggal 24/10/2026, tanda baca—termasuk “kutipan”, (kurung), dan tanda
                      tanya?—serta karakter naïve yang harus tetap terbaca.
                    </p>
                  </div>
                </div>
              </Example>
            </Section>
            <Section
              id="materials"
              title="Materials & effects"
              description="Paper, ink, torn frames, brush ribbons, and halftone texture are layered around content. They stay decorative and never replace labels, state, or focus."
            >
              <Example
                title="Editorial materials"
                description="Use stronger material in editorial moments and keep work surfaces calm and readable."
              >
                <SectionRibbon title="A signal worth keeping" number="01" accent="magenta" />
                <div className="material-specimen-grid">
                  <Panel
                    className="material-panel"
                    title="Paper dossier"
                    description="The torn frame is shared UI; content remains selectable HTML."
                    surface="paper"
                    frame="torn"
                    density="compact"
                    headingLevel={3}
                  >
                    <p>People. Places. Stories.</p>
                  </Panel>
                  <PaperNote accent="yellow">Same moon. Different people.</PaperNote>
                  <div className="material-halftone" aria-hidden="true" />
                </div>
                <div className="catalog-zine-proof-grid">
                  <Panel
                    title="Scuffed xerox dossier"
                    description="Dry-brush dashed boundary with stepped hover doodle."
                    surface="ink"
                    frame="scuffed"
                    density="compact"
                    headingLevel={3}
                    className="mw-ui-interactive-surface"
                    actions={<Doodle kind="crown" className="text-[var(--mw-yellow)]" />}
                  >
                    <PageHeader
                      title="ZINE"
                      accentTitle="DOSSIER"
                      accent="magenta"
                      treatment="brush"
                      headingLevel={3}
                    />
                    <div className="catalog-live-row">
                      <LiveIndicator active label="ON AIR" variant="on-air" />
                      <LiveIndicator active={false} label="STANDBY" />
                    </div>
                  </Panel>
                  <MetricTile
                    label="Editorial violet"
                    value="09"
                    detail="Paper-cream torn KPI note"
                    accent="violet"
                    surface="paper"
                    frame="torn"
                    icon={<ActivityIcon />}
                  />
                </div>
              </Example>
              <Example
                title="Motion and reduced motion"
                description="Decorative motion is brief; reduced motion keeps the mark and status visible without animation."
              >
                <div className="catalog-motion-grid">
                  <div>
                    <span>Live state beacon</span>
                    <LiveIndicator active label="ON AIR" variant="on-air" />
                  </div>
                  <div>
                    <span>Focus lines</span>
                    <div className="catalog-motion-lines">
                      <SpeedLines count={20} />
                    </div>
                  </div>
                  <div>
                    <span>Ink underline</span>
                    <InkUnderline />
                  </div>
                  <SignalOrbit className="catalog-motion-orbit">
                    <SpeechBubble>Story saved</SpeechBubble>
                  </SignalOrbit>
                  <div className="catalog-motion-progress">
                    <span>Loading preview…</span>
                    <LoadingProgress label="Loading preview" />
                  </div>
                  <div className="catalog-motion-progress">
                    <span>Submitting action</span>
                    <Button size="sm" disabled aria-busy="true">
                      <LoadingSpinner /> Signing in…
                    </Button>
                  </div>
                </div>
              </Example>
            </Section>
            <Section
              id="icons-materials"
              title="Icons, Materials & Decorations"
              description="Canonical icon scales, exported material SVGs, doodles, and decorative motifs from @moonwitness/assets and @moonwitness/ui."
            >
              <Example
                title="Icon scale contact sheet"
                description="Canonical UI icons verified at 16, 20, 24, and 32 px."
              >
                <div className="catalog-icon-scale-list">
                  {iconScaleSamples.map(({ Component, label }) => (
                    <div className="catalog-icon-scale-row" key={label}>
                      <span className="catalog-icon-scale-label">{label}</span>
                      <div className="catalog-icon-sizes">
                        {iconScaleSizes.map((size) => (
                          <span className="catalog-icon-size-chip" key={size}>
                            <Component aria-hidden="true" width={size} height={size} />
                            <small>{size}px</small>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Example>
              <Example
                title="Canonical material SVGs"
                description="Imported directly from @moonwitness/assets/materials/*.svg as Vite asset URLs."
              >
                <div className="catalog-material-svgs">
                  {materialAssets.map(({ name, src }) => (
                    <figure className="catalog-material-card" key={name}>
                      <img src={src} alt="" />
                      <figcaption>{name}</figcaption>
                    </figure>
                  ))}
                </div>
              </Example>
              <Example
                title="Doodles & decorative motifs"
                description="Non-interactive SVG accents rendered with aria-hidden and pointer-events: none."
              >
                <div className="catalog-decorations-grid">
                  {doodleKinds.map((kind) => (
                    <div className="catalog-decoration-chip" key={kind}>
                      <Doodle kind={kind} />
                      <span>Doodle · {kind}</span>
                    </div>
                  ))}
                  {motifKinds.map((kind) => (
                    <div className="catalog-decoration-chip" key={kind}>
                      <DecorativeMotif kind={kind} />
                      <span>Motif · {kind}</span>
                    </div>
                  ))}
                </div>
              </Example>
            </Section>
            <Section
              id="workbench-proof"
              title="Story Workbench proof"
              description="A 3-column Contoh desain editorial draft specimen pairing a torn paper page navigator, whitespace-preserving editor, and deterministic revision inspector."
            >
              <Example
                wide
                title="Story Workbench · Contoh desain"
                description="Three-column layout on desktop collapsing to a single column at 42rem and below with zero horizontal overflow."
              >
                <div className="catalog-workbench-proof" data-testid="workbench-proof-grid">
                  <Panel
                    className="catalog-workbench-nav"
                    title="Page Navigator"
                    surface="paper"
                    frame="torn"
                    density="compact"
                    headingLevel={4}
                  >
                    <ul className="catalog-workbench-pages" aria-label="Story pages">
                      {workbenchPages.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="catalog-workbench-page-btn"
                            aria-current={entry.id === activeWorkbenchPage.id ? 'page' : undefined}
                            onClick={() => setActiveWorkbenchPageId(entry.id)}
                          >
                            <span>
                              {entry.number} · {entry.title}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="catalog-inline">
                      <Button size="xs" variant="outline" onClick={addWorkbenchPage}>
                        <AddIcon aria-hidden="true" /> Add page
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={activeWorkbenchIndex === 0}
                        onClick={moveActiveWorkbenchPageUp}
                      >
                        Move up
                      </Button>
                    </div>
                  </Panel>

                  <div className="catalog-workbench-editor">
                    <PageHeader
                      treatment="brush"
                      headingLevel={3}
                      title={activeWorkbenchPage.title}
                      description="Contoh desain · Story draft workspace"
                      actions={<Badge variant="primary">INTERNAL</Badge>}
                    />
                    <SectionRibbon
                      title="Draft body"
                      number={activeWorkbenchPage.number}
                      accent="magenta"
                    />
                    <Field
                      htmlFor="workbench-draft-body"
                      label="Draft content"
                      description="Preserves leading spaces, indentation, and tabs."
                    >
                      <Textarea
                        rows={4}
                        value={activeWorkbenchPage.draft}
                        onChange={(event) => updateWorkbenchDraft(event.currentTarget.value)}
                      />
                    </Field>
                    <div className="catalog-workbench-preview" aria-label="Page preview">
                      <div className="catalog-inline">
                        <Badge variant="primary">INTERNAL</Badge>
                        <small>Rendered preview · Page {activeWorkbenchPage.number}</small>
                      </div>
                      <pre className="catalog-workbench-pre">{activeWorkbenchPage.draft}</pre>
                    </div>
                  </div>

                  <Panel
                    className="catalog-workbench-inspector"
                    title="Revision Inspector"
                    surface="paper"
                    density="compact"
                    headingLevel={4}
                  >
                    <dl className="catalog-workbench-meta">
                      <div>
                        <dt>Version</dt>
                        <dd>v1.4.0</dd>
                      </div>
                      <div>
                        <dt>SHA-256</dt>
                        <dd className="catalog-workbench-hash">
                          e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                        </dd>
                      </div>
                      <div>
                        <dt>Visibility</dt>
                        <dd>
                          <Badge>INTERNAL</Badge>
                        </dd>
                      </div>
                      <div>
                        <dt>Sample notice</dt>
                        <dd>Contoh desain · Synthetic sample</dd>
                      </div>
                    </dl>
                  </Panel>
                </div>
              </Example>
            </Section>
            <Section
              id="editorial-proof"
              title="Homepage hero proof"
              description="A responsive composition specimen built from the same shared button, paper note, headline typography, and canonical hero artwork used by the public homepage."
            >
              <Example
                title="Editorial hero · specimen"
                description="Review the left-side text safe area, visual focal point, readable overlay, and CTA placement before changing production composition."
              >
                <div className="catalog-hero-proof">
                  <picture>
                    <source media="(max-width: 600px)" srcSet={homeHeroMobile} />
                    <img src={homeHeroDesktop} alt="" />
                  </picture>
                  <div className="catalog-hero-proof-shade" aria-hidden="true" />
                  <div className="catalog-hero-decor" aria-hidden="true">
                    <DecorativeMotif kind="moon-phases" className="catalog-hero-motif-moons" />
                    <DecorativeMotif kind="orbit" className="catalog-hero-motif-orbit" />
                    <DecorativeMotif kind="eye-target" className="catalog-hero-motif-eye" />
                    <DecorativeMotif kind="globe-grid" className="catalog-hero-motif-globe" />
                    <Doodle kind="crown" className="catalog-hero-doodle-crown" />
                    <Doodle kind="smiley" className="catalog-hero-doodle-smiley" />
                    <Doodle kind="star" className="catalog-hero-doodle-star" />
                    <Doodle kind="bolt" className="catalog-hero-doodle-bolt" />
                  </div>
                  <div className="catalog-hero-proof-copy">
                    <p className="catalog-hero-proof-kicker">PEOPLE · PLACES · STORIES</p>
                    <h3>
                      MOON<span>WITNESS</span>
                    </h3>
                    <p className="catalog-hero-proof-ribbon">Follow the signal</p>
                    <p className="catalog-hero-proof-body">
                      Different people. Shared context. A clearer view of the work that connects us.
                    </p>
                    <Button treatment="brush" size="sm">
                      Explore stories <ArrowRightIcon aria-hidden="true" />
                    </Button>
                  </div>
                  <PaperNote className="catalog-hero-proof-note" accent="yellow">
                    Same moon.
                    <br />
                    Different people.
                  </PaperNote>
                </div>
              </Example>
            </Section>
            <Section
              id="actions"
              title="Actions & feedback"
              description="Show the full action range, disabled states, long labels, and clear feedback."
            >
              <Example
                title="Button variants and sizes"
                description="Native button semantics are preserved at every size."
              >
                <div className="catalog-button-grid">
                  <Button>Primary action</Button>
                  <Button treatment="brush">Brush action</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="destructive">Delete record</Button>
                  <Button variant="ghost">Quiet action</Button>
                  <Button variant="link">Documentation link</Button>
                  <Button size="xs">Extra small</Button>
                  <Button size="lg">Large action</Button>
                  <Button disabled>Disabled</Button>
                  <Button asChild variant="outline">
                    <a href="#brand">Enabled link action</a>
                  </Button>
                  <Button asChild disabled variant="outline">
                    <a
                      href="#brand"
                      data-testid="disabled-button-link"
                      onClick={() => {
                        window.location.hash = 'brand';
                      }}
                    >
                      Disabled link action
                    </a>
                  </Button>
                  <Button className="catalog-long-button">
                    Save these organization preferences and notify every workspace administrator
                  </Button>
                </div>
              </Example>
              <Example
                title="Tooltip & toast"
                description="Tooltip opens on focus or hover; toast reports results, and SFX stays muted until enabled."
              >
                <div className="catalog-inline">
                  <SoundToggle />
                  <Button variant="outline" onClick={() => play('success')}>
                    Play success cue
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">
                        <SearchIcon aria-hidden="true" /> Search
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Search all installed models</TooltipContent>
                  </Tooltip>
                  <Button
                    onClick={() =>
                      toast.success('Settings saved', {
                        description: 'Your workspace preferences are up to date.',
                      })
                    }
                  >
                    Show success toast
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      toast.error('Could not save', {
                        description: 'Check the form and try again.',
                      })
                    }
                  >
                    Show error toast
                  </Button>
                </div>
                <ToastHost />
              </Example>
            </Section>
            <Section
              id="forms"
              title="Forms"
              description="Examples include required fields, descriptions, invalid states, controlled input, and native keyboard access."
            >
              <Example
                title="Field, input & validation"
                description="Labels, help text, and errors are connected through accessible descriptions."
              >
                <div className="catalog-form-grid">
                  <Field
                    htmlFor="catalog-name"
                    label="Display name"
                    required
                    description="Shown in activity and audit screens."
                  >
                    <Input placeholder="Ada Lovelace" />
                  </Field>
                  <Field
                    htmlFor="catalog-email"
                    label="Work email"
                    error="Enter a valid work email address."
                  >
                    <Input type="email" defaultValue="not-an-email" />
                  </Field>
                  <Field
                    htmlFor="catalog-search"
                    label="Filter records"
                    description="Type to filter the sample table below."
                  >
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                      placeholder="Search partners"
                    />
                  </Field>
                  <Field htmlFor="catalog-role-native" label="Native select">
                    <SelectField id="catalog-role-native" defaultValue="member">
                      <option value="admin">Administrator</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </SelectField>
                  </Field>
                  <div className="catalog-field">
                    <label id="catalog-role-label" htmlFor="catalog-role-trigger">
                      Accessible select
                    </label>
                    <Select defaultValue="member">
                      <SelectTrigger id="catalog-role-trigger" aria-labelledby="catalog-role-label">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrator</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="catalog-check-row" htmlFor="catalog-consent">
                    <Checkbox
                      id="catalog-consent"
                      checked={checked}
                      onChange={(event) => setChecked(event.currentTarget.checked)}
                    />
                    <span>Include archived records</span>
                  </label>
                  <label className="catalog-check-row" htmlFor="catalog-consent-indeterminate">
                    <Checkbox
                      id="catalog-consent-indeterminate"
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = indeterminateChecked === 'indeterminate';
                        }
                      }}
                      checked={indeterminateChecked === true}
                      aria-checked={
                        indeterminateChecked === 'indeterminate' ? 'mixed' : indeterminateChecked
                      }
                      onChange={(event) => setIndeterminateChecked(event.currentTarget.checked)}
                    />
                    <span>Select partial archive batch</span>
                  </label>
                  <div className="catalog-field">
                    <label id="catalog-assignment-label" htmlFor="catalog-assignment-trigger">
                      Project assignment
                    </label>
                    <Select value={assignment} onValueChange={setAssignment}>
                      <SelectTrigger
                        id="catalog-assignment-trigger"
                        aria-labelledby="catalog-assignment-label"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        <SelectItem value="editorial">Editorial</SelectItem>
                        <SelectItem value="research">Research</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="catalog-switch-row">
                    <label htmlFor="catalog-switch-publish">Auto-publish snapshots</label>
                    <Switch
                      id="catalog-switch-publish"
                      checked={autoPublish}
                      onCheckedChange={setAutoPublish}
                    />
                  </div>
                  <Field
                    htmlFor="catalog-notes"
                    label="Editorial notes"
                    description="Multiline input preserving whitespace and indentation."
                  >
                    <Textarea
                      rows={3}
                      value={notesValue}
                      onChange={(event) => setNotesValue(event.currentTarget.value)}
                    />
                  </Field>
                </div>
              </Example>
            </Section>
            <Section
              id="overlays"
              title="Overlays & composition"
              description="Dialog, dropdown, tabs, toolbars, and page framing support keyboard-first workflows."
            >
              <Example
                title="Dialog, popover, sheet & dropdown"
                description="Open with Enter or Space, move with arrow keys, close with Escape."
              >
                <div className="catalog-inline">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button>Open dialog</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Confirm workspace change</DialogTitle>
                        <DialogDescription>
                          This sample dialog traps focus, supports Escape, and returns focus to its
                          trigger.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <DialogClose asChild>
                          <Button onClick={() => toast.success('Workspace updated')}>
                            Confirm change
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        More actions <span aria-hidden="true">⌄</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Sample actions</DropdownMenuLabel>
                      <DropdownMenuItem>
                        <EditIcon aria-hidden="true" /> Edit record
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <AddIcon aria-hidden="true" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">
                        <DeleteIcon aria-hidden="true" /> Delete record
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline">Open quick info</Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <PopoverHeader>
                        <PopoverTitle>Revision snapshot</PopoverTitle>
                        <PopoverDescription>
                          Synced across editorial and archive panels.
                        </PopoverDescription>
                      </PopoverHeader>
                    </PopoverContent>
                  </Popover>
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="outline">Open detail sheet</Button>
                    </SheetTrigger>
                    <SheetContent>
                      <SheetHeader>
                        <SheetTitle>Story metadata</SheetTitle>
                        <SheetDescription>
                          Slide-over drawer for inspecting story permissions and history.
                        </SheetDescription>
                      </SheetHeader>
                      <SheetFooter>
                        <SheetClose asChild>
                          <Button variant="outline">Close sheet</Button>
                        </SheetClose>
                      </SheetFooter>
                    </SheetContent>
                  </Sheet>
                </div>
              </Example>
              <Example
                title="Command palette"
                description="Filterable command menu with keyboard selection."
              >
                <Command className="catalog-command-frame">
                  <CommandInput
                    aria-label="Search commands"
                    placeholder="Search workspace commands..."
                  />
                  <CommandList>
                    <CommandEmpty>No commands found.</CommandEmpty>
                    <CommandGroup heading="Workspace actions">
                      <CommandItem onSelect={() => setSelectedCommand('Create story')}>
                        <AddIcon aria-hidden="true" /> Create story
                      </CommandItem>
                      <CommandItem onSelect={() => setSelectedCommand('Inspect revision')}>
                        <HistoryIcon aria-hidden="true" /> Inspect revision
                      </CommandItem>
                      <CommandItem onSelect={() => setSelectedCommand('Export CSV')}>
                        <FileSpreadsheetIcon aria-hidden="true" /> Export CSV
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
                <small data-testid="selected-command-status">
                  Selected command: {selectedCommand}
                </small>
              </Example>
              <Example
                title="Page header treatments"
                description="Compare condensed display vs brush treatment at heading level 3."
              >
                <div className="catalog-page-header-pair">
                  <PageHeader
                    treatment="display"
                    headingLevel={3}
                    title="Display header"
                    description="Structured condensed display header for operational views."
                    actions={<Badge>Display</Badge>}
                  />
                  <PageHeader
                    treatment="brush"
                    headingLevel={3}
                    title="Brush header"
                    description="Expressive brush header for editorial workspaces."
                    actions={<Badge variant="primary">Brush</Badge>}
                  />
                </div>
              </Example>
              <Example
                title="Tabs, toolbar & page header"
                description="Composed patterns keep related actions and content grouped."
              >
                <Tabs defaultValue="overview" className="catalog-tabs">
                  <TabsList aria-label="Sample content views">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                    <TabsTrigger value="access">Access</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview">
                    <Toolbar
                      aria-label="Sample list actions"
                      filters={<Input aria-label="Search items" placeholder="Search items" />}
                      actions={<Button size="sm">Add item</Button>}
                    />
                    <p className="catalog-tab-copy">
                      Overview content with a useful empty border and focus state.
                    </p>
                  </TabsContent>
                  <TabsContent value="activity">
                    <p className="catalog-tab-copy">Recent events are grouped by date and actor.</p>
                  </TabsContent>
                  <TabsContent value="access">
                    <p className="catalog-tab-copy">
                      Role assignments and access rules belong here.
                    </p>
                  </TabsContent>
                </Tabs>
              </Example>
            </Section>
            <Section
              id="data-display"
              title="Data display"
              description="Tables, pagination, loading placeholders, and empty states cover common data conditions."
            >
              <Example
                title="Table & pagination"
                description="Contoh desain: comfortable and compact density tables, native table semantics, row selection, sorting, and bounded page navigation."
              >
                <div className="catalog-table-stack">
                  <Table
                    className="min-w-[36rem]"
                    density="comfortable"
                    scrollLabel="Installed add-ons table horizontal scroll"
                    aria-label="Installed add-ons"
                  >
                    <caption className="sr-only">Sample design: installed add-ons</caption>
                    <TableHead>
                      <TableRow>
                        <TableHeader scope="col" aria-sort={addonSort ?? 'none'}>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              aria-label="Select all add-ons on this page"
                              checked={allVisibleAddonsSelected}
                              onChange={toggleVisibleAddons}
                            />
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label="Sort by addon"
                              onClick={() => {
                                setAddonSort((current) =>
                                  current === 'ascending' ? 'descending' : 'ascending'
                                );
                                setPage(1);
                              }}
                            >
                              Addon{' '}
                              {addonSort === 'ascending'
                                ? '↑'
                                : addonSort === 'descending'
                                  ? '↓'
                                  : '↕'}
                            </Button>
                          </div>
                        </TableHeader>
                        <TableHeader scope="col">Owner</TableHeader>
                        <TableHeader scope="col">Status</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleAddons.map(([name, owner, status]) => (
                        <TableRow key={name}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                aria-label={`Select ${name}`}
                                checked={selectedAddons.includes(name)}
                                onChange={() =>
                                  setSelectedAddons((current) =>
                                    current.includes(name)
                                      ? current.filter((selected) => selected !== name)
                                      : [...current, name]
                                  )
                                }
                              />
                              {name}
                            </div>
                          </TableCell>
                          <TableCell>{owner}</TableCell>
                          <TableCell>
                            <Badge variant={status === 'Active' ? 'primary' : 'default'}>
                              {status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pagination
                    className="catalog-pagination"
                    page={currentPage}
                    pageCount={pageCount}
                    onPageChange={setPage}
                  />
                  <Table
                    density="compact"
                    scrollLabel="Compact revision log horizontal scroll"
                    aria-label="Compact revision log"
                  >
                    <caption className="sr-only">Sample design: compact revision log</caption>
                    <TableHead>
                      <TableRow>
                        <TableHeader scope="col">Revision</TableHeader>
                        <TableHeader scope="col">Editor</TableHeader>
                        <TableHeader scope="col">Visibility</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell>v1.4.0</TableCell>
                        <TableCell>Editorial team</TableCell>
                        <TableCell>
                          <Badge variant="primary">INTERNAL</Badge>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>v1.3.2</TableCell>
                        <TableCell>Research team</TableCell>
                        <TableCell>
                          <Badge>DRAFT</Badge>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Example>
              <Example
                title="Loading & empty states"
                description="Loading state is announced; empty state supplies context and a clear next action."
              >
                <div className="catalog-state-stack">
                  <Skeleton label="Loading a partner record" className="catalog-skeleton" />
                  <EmptyState
                    title="No matching records"
                    description="Change your filters or create a partner to get started."
                    icon={<SearchIcon />}
                    action={
                      <Button size="sm" onClick={() => setQuery('')}>
                        Clear filters
                      </Button>
                    }
                  />
                </div>
              </Example>
            </Section>
            <Section
              id="charts"
              title="Charts"
              description="Data visualizations include loading/error/empty states, locale formatting, and accessible alternatives."
            >
              <Example
                title="Bar & line charts"
                description="Each chart has a labeled table alternative and values formatted with the requested locale."
              >
                <div className="catalog-chart-grid">
                  <BarChart
                    title="Installed addons"
                    data={chartData}
                    locale="en-US"
                    valueLabel="Addons"
                  />
                  <LineChart
                    title="Weekly activity"
                    labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']}
                    series={[
                      { label: 'Jobs', values: [12, 18, 16, 24, 31] },
                      { label: 'Users', values: [7, 9, 14, 12, 22] },
                    ]}
                    locale="en-US"
                  />
                  <BarChart
                    title="Zero values bar example"
                    data={[
                      { label: 'Pending', value: 0 },
                      { label: 'Failed', value: 0 },
                    ]}
                    locale="en-US"
                    valueLabel="Count"
                  />
                  <LineChart
                    title="Zero values line example"
                    labels={['Mon', 'Tue', 'Wed']}
                    series={[
                      { label: 'Pending', values: [0, 0, 0] },
                      { label: 'Failed', values: [0, 0, 0] },
                    ]}
                    locale="en-US"
                  />
                  <BarChart title="Loading example" data={[]} loading />
                  <LineChart title="Line loading example" labels={[]} series={[]} loading />
                  <BarChart title="Error example" data={[]} error="Activity could not be loaded." />
                  <LineChart
                    title="Line error example"
                    labels={[]}
                    series={[]}
                    error="Timeline could not be loaded."
                  />
                  <BarChart title="Empty example" data={[]} emptyMessage="No events yet." />
                  <LineChart
                    title="Line empty example"
                    labels={[]}
                    series={[]}
                    emptyMessage="No timeline points yet."
                  />
                </div>
              </Example>
            </Section>
            <footer className="catalog-footer">
              <span>MoonWitness UI · built from public package exports</span>
              <a href="https://github.com/bjo163/moonwitness-xi/tree/dev/packages/ui">
                Browse package source
              </a>
            </footer>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

export function Catalog() {
  return (
    <SoundProvider>
      <CatalogContent />
    </SoundProvider>
  );
}
