import { useState, type ReactNode } from 'react';
import {
  ActivityIcon,
  AddIcon,
  AttachmentIcon,
  CalendarIcon,
  CompanyIcon,
  ModelIcon,
  SecurityIcon,
  SettingsIcon,
  UserIcon,
} from '@moonwitness/ui/icons';
import boardMasthead from '@moonwitness/assets/illustrations/board-masthead.webp';
import authLoginDesktop from '@moonwitness/assets/illustrations/auth-login-desktop.webp';
import symbolDark from '@moonwitness/assets/brand/moonwitness-symbol-dark.svg';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { BarChart, LineChart } from '@moonwitness/ui/components/chart';
import { CharacterDisplay } from '@moonwitness/ui/components/character-stage';
import { ComicPanel } from '@moonwitness/ui/components/comic-panel';
import { Field } from '@moonwitness/ui/components/field';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { AchievementBadge, QuestCard } from '@moonwitness/ui/components/quest-card';
import { SectionRibbon } from '@moonwitness/ui/components/section-ribbon';
import {
  SpeechBubble as UniverseSpeechBubble,
  StickerBadge,
} from '@moonwitness/ui/components/speech-bubble';
import { Textarea } from '@moonwitness/ui/components/textarea';

const chartData = [
  { label: 'Base', value: 42 },
  { label: 'CRM', value: 28 },
  { label: 'Inventory', value: 19 },
];

const zeroSeries = [
  { label: 'Pending', value: 0 },
  { label: 'Failed', value: 0 },
];

const zeroLineSeries = zeroSeries.map(({ label }) => ({ label, values: [0, 0, 0] }));

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

function ShowcaseExample({
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

export function BoardProofShowcase() {
  return (
    <ShowcaseExample
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
                  <span className="catalog-board-dot" /> <span>Prepare story outline</span>
                  <Badge>Tomorrow</Badge>
                </li>
                <li>
                  <span className="catalog-board-dot" /> <span>Check source references</span>
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
    </ShowcaseExample>
  );
}

export function WorkbenchProofShowcase() {
  const [workbenchPages, setWorkbenchPages] = useState(initialWorkbenchPages);
  const [activeWorkbenchPageId, setActiveWorkbenchPageId] = useState('page-1');

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

  return (
    <ShowcaseExample
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="catalog-workbench-page-btn"
                  aria-current={entry.id === activeWorkbenchPage.id ? 'page' : undefined}
                  onClick={() => setActiveWorkbenchPageId(entry.id)}
                >
                  {entry.number} · {entry.title}
                </Button>
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
          <SectionRibbon title="Draft body" number={activeWorkbenchPage.number} accent="magenta" />
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
    </ShowcaseExample>
  );
}

export function ChartsShowcase() {
  return (
    <ShowcaseExample
      title="Bar & line charts"
      description="Each chart has a labeled table alternative and locale formatting."
    >
      <div className="catalog-chart-grid">
        <BarChart title="Installed addons" data={chartData} locale="en-US" valueLabel="Addons" />
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
          data={zeroSeries}
          locale="en-US"
          valueLabel="Count"
        />
        <LineChart
          title="Zero values line example"
          labels={['Mon', 'Tue', 'Wed']}
          series={zeroLineSeries}
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
    </ShowcaseExample>
  );
}

export function VisualUniverseShowcase() {
  return (
    <ShowcaseExample
      wide
      title="Comic framing & character stage · Contoh desain"
      description="Contoh desain: ComicPanel, SpeechBubble, StickerBadge, CharacterDisplay, QuestCard, and AchievementBadge."
    >
      <div className="catalog-raw-art-stack" data-testid="visual-universe-specimen">
        <ComicPanel
          panelNumber="01"
          kicker="CONTOH DESAIN"
          title="Signal Riot Companion"
          surface="paper"
          accent="magenta"
          actions={
            <div className="catalog-inline">
              <StickerBadge tone="yellow" tilt="left">
                CONTOH DESAIN
              </StickerBadge>
              <StickerBadge tone="magenta" tilt="right">
                SIGNAL RIOT
              </StickerBadge>
            </div>
          }
        >
          <div className="catalog-inline">
            <CharacterDisplay
              characterId="kuro-signal"
              expression="excited"
              size="md"
              basePath={import.meta.env.BASE_URL}
            />
            <UniverseSpeechBubble speaker="Kuro Signal" tail="left" variant="shout">
              Contoh desain: 3/4 readiness gates locked. One preflight check remaining!
            </UniverseSpeechBubble>
          </div>
        </ComicPanel>
        <QuestCard
          title="Editorial Gate Check"
          description="Contoh desain: deterministic step progress without invented metrics."
          completedSteps={3}
          totalSteps={4}
          status="active"
          badgeId="badge-story-architect"
          rewardLabel="Unlocks at 4/4"
          basePath={import.meta.env.BASE_URL}
        />
        <div className="catalog-inline">
          <AchievementBadge
            badgeId="badge-story-architect"
            title="Story Architect"
            rank="Architect"
            unlocked
            basePath={import.meta.env.BASE_URL}
          />
          <AchievementBadge
            badgeId="badge-zero-drift"
            title="Zero Drift"
            rank="Vanguard"
            unlocked={false}
            basePath={import.meta.env.BASE_URL}
          />
        </div>
      </div>
    </ShowcaseExample>
  );
}

type CoveragePanelSpec = {
  title: string;
  description: string;
  facts?: readonly (readonly [string, ReactNode])[];
  boundary?: string;
  image?: string;
};

function CoverageShowcase({
  testId,
  panels,
}: {
  testId: string;
  panels: readonly CoveragePanelSpec[];
}) {
  return (
    <div className="auth-coverage-grid" data-testid={testId}>
      {panels.map(({ title, description, facts, boundary, image }) => (
        <Panel key={title} title={title} description={description}>
          {image ? <img className="auth-coverage-art" src={image} alt="" /> : null}
          {facts ? (
            <dl className="auth-coverage-facts">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {boundary ? <p className="auth-coverage-boundary">{boundary}</p> : null}
        </Panel>
      ))}
    </div>
  );
}

export function AuthCoverageShowcase() {
  return (
    <CoverageShowcase
      testId="auth-route-specimen"
      panels={[
        {
          title: 'Registered access screens',
          description: 'Existing routes own credential entry and API status states.',
          image: authLoginDesktop,
          facts: [
            ['Sign in', <code>/login</code>],
            ['Registration', <code>/register</code>],
            ['States', 'Idle · submitting · returned error'],
          ],
        },
        {
          title: 'Session list not exposed',
          description:
            'Auth refresh-token internals stay inside the auth API with no session-management screen.',
          boundary: 'Catalog boundary specimen · no session route or token fixture is represented.',
        },
      ]}
    />
  );
}

export function IntegrationCoverageShowcase() {
  return (
    <CoverageShowcase
      testId="integration-boundary-specimen"
      panels={[
        {
          title: 'Webhook endpoint contract',
          description:
            'Model: integration.webhook_endpoint · create, read, update and delete are granted only to base.group_superadmin.',
          facts: [
            ['Fields', 'name · company · url · event_types · enabled'],
            ['Secret reference', 'Reference only; secret material stays outside the UI.'],
            ['Empty', 'No endpoints returned by the authorized consumer.'],
            ['Unavailable', 'Endpoint records could not be loaded.'],
          ],
        },
        {
          title: 'Webhook delivery contract',
          description:
            'Model: integration.webhook_delivery · no custom integration route or production Board screen is registered.',
          facts: [
            [
              'Fields',
              'endpoint · company · event_type · status · attempts · response_status · delivered_at',
            ],
            ['Delivery states', 'delivered · retrying · dead'],
            ['Error state', 'Delivery details unavailable; private error fields stay hidden.'],
            ['Permission denied', 'Requires the existing superadmin model access grant.'],
          ],
          boundary:
            'Catalog boundary specimen · schema and permission states only; no endpoint, delivery, count, or route fixture is represented.',
        },
      ]}
    />
  );
}

export function RequestCoverageShowcase() {
  return (
    <CoverageShowcase
      testId="request-workflow-specimen"
      panels={[
        {
          title: 'Purchase request',
          description:
            'Stores request details; approval status belongs to request.purchase_approval.',
          facts: [
            ['Fields', 'title · description · amount_minor · currency · company · vendor'],
            ['User access', 'Read, create and update; delete is denied.'],
            ['Empty', 'No requests available.'],
            ['Unavailable', 'Request records could not be loaded.'],
          ],
        },
        {
          title: 'Approval lifecycle',
          description: 'Workflow state and permissions come from the registered workflow.',
          facts: [
            ['States', 'draft → submitted → approved or rejected'],
            ['Submit', 'User, superadmin or system; draft to submitted.'],
            ['Approve / reject', 'Superadmin or system; approval requires a distinct actor.'],
            ['Permission denied', 'Actions unavailable outside registered roles.'],
          ],
          boundary:
            'Catalog boundary specimen · schema and workflow states only; no request amounts, vendors, routes or records are shown.',
        },
      ]}
    />
  );
}

export function OrmStorageCoverageShowcase() {
  return (
    <CoverageShowcase
      testId="orm-storage-specimen"
      panels={[
        {
          title: 'Attachment storage provider',
          description: 'LocalFileAttachmentStorage / S3AttachmentStorage (no domain models).',
          facts: [
            ['Providers', 'Local file · S3-compatible (Garage)'],
            ['Lifecycle', 'Ready · uploading/downloading · unavailable · permission denied'],
          ],
          boundary:
            'Catalog boundary specimen · schema states only; no attachment fixture represented.',
        },
        {
          title: 'Orphan reconciliation',
          description:
            'PruneOrphanResult / ReconcileResult report scanned, orphaned, deleted, and failed keys.',
          facts: [['States', 'Ready · unavailable · scanning · truncated']],
        },
      ]}
    />
  );
}

export function AiCoverageShowcase() {
  return (
    <CoverageShowcase
      testId="ai-specimen"
      panels={[
        {
          title: 'Agents & models',
          description: 'Models: ai.agent, ai.provider_profile, ai.model_profile.',
          facts: [
            ['Agent states', 'draft · active · retired · emergency stop'],
            ['Profile states', 'active · retired (developmentOnly grant)'],
          ],
        },
        {
          title: 'Runs & obligations',
          description: 'Models: ai.agent_run, ai.obligation, ai.work_contract.',
          facts: [
            ['Run states', 'queued · running · succeeded · failed · cancelled'],
            ['Contract states', 'draft · active · completed · rejected'],
          ],
        },
      ]}
    />
  );
}
