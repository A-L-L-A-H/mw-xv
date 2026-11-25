'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSfx, type SfxName } from '@moonwitness/ui/components/audio';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { CharacterDisplay } from '@moonwitness/ui/components/character-stage';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import { ComicPanel, MangaFrame } from '@moonwitness/ui/components/comic-panel';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { QuestCard, RewardPanel } from '@moonwitness/ui/components/quest-card';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { SpeechBubble, StickerBadge } from '@moonwitness/ui/components/speech-bubble';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { toast } from '@moonwitness/ui/components/toast';
import {
  CheckIcon,
  DocumentIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SaveIcon,
  SearchIcon,
  SparkleIcon,
  VolumeIcon,
  VolumeOffIcon,
} from '@moonwitness/ui/icons';
import {
  getStateIllustration,
  type KuroClipId,
  type KuroExpression,
} from '@moonwitness/ui/lib/asset-registry';
import {
  createSceneSoundscapeController,
  type SceneAmbienceId,
  type SceneSoundscapeController,
  type SceneSoundscapeSnapshot,
} from '@moonwitness/ui/lib/scene-soundscape';
import { NotFoundError, type StoryVersionDocument } from '@moonwitness/client';
import { client } from '@/lib/client';

type ImprintKey = 'GOD PROMISE' | 'ROCKSOUL';

type AsmaulCluster =
  'All' | 'Mercy' | 'Sovereignty' | 'Knowledge' | 'Creation' | 'Justice' | 'Guidance';

interface AsmaulConceptEntry {
  readonly id: number;
  readonly arabic: string;
  readonly transliteration: string;
  readonly meaning: string;
  readonly cluster: Exclude<AsmaulCluster, 'All'>;
  readonly visualCue: string;
}

const ASMAUL_CLUSTERS: readonly AsmaulCluster[] = [
  'All',
  'Mercy',
  'Sovereignty',
  'Knowledge',
  'Creation',
  'Justice',
  'Guidance',
];

const ASMAUL_CONCEPTS: readonly AsmaulConceptEntry[] = [
  {
    id: 1,
    arabic: 'الرحمن',
    transliteration: 'Ar-Rahman',
    meaning: 'The Entirely Merciful',
    cluster: 'Mercy',
    visualCue: 'Warm dawn gold wash over archival cotton paper',
  },
  {
    id: 2,
    arabic: 'الرحيم',
    transliteration: 'Ar-Rahim',
    meaning: 'The Especially Merciful',
    cluster: 'Mercy',
    visualCue: 'Soft rose-ochre ink gradient with calm negative space',
  },
  {
    id: 3,
    arabic: 'الملك',
    transliteration: 'Al-Malik',
    meaning: 'The Sovereign Lord',
    cluster: 'Sovereignty',
    visualCue: 'Deep obsidian border with crisp geometric crest',
  },
  {
    id: 4,
    arabic: 'القدوس',
    transliteration: 'Al-Quddus',
    meaning: 'The Pure & Sacred',
    cluster: 'Sovereignty',
    visualCue: 'High-contrast ivory field with hairline ink rule',
  },
  {
    id: 11,
    arabic: 'الخالق',
    transliteration: 'Al-Khaliq',
    meaning: 'The Creator',
    cluster: 'Creation',
    visualCue: 'Radiating architectural compass lines in cyan and ink',
  },
  {
    id: 13,
    arabic: 'المصور',
    transliteration: 'Al-Musawwir',
    meaning: 'The Fashioner of Forms',
    cluster: 'Creation',
    visualCue: 'Layered risograph halftone silhouettes with tactile grain',
  },
  {
    id: 19,
    arabic: 'العليم',
    transliteration: 'Al-Alim',
    meaning: 'The All-Knowing',
    cluster: 'Knowledge',
    visualCue: 'Structured monograph grid with luminous indigo accent',
  },
  {
    id: 46,
    arabic: 'الحكيم',
    transliteration: 'Al-Hakim',
    meaning: 'The All-Wise',
    cluster: 'Knowledge',
    visualCue: 'Balanced golden-ratio folio layout with serif pull-quote',
  },
  {
    id: 29,
    arabic: 'العدل',
    transliteration: 'Al-Adl',
    meaning: 'The Utterly Just',
    cluster: 'Justice',
    visualCue: 'Symmetrical dual-column spread with anchored baseline',
  },
  {
    id: 51,
    arabic: 'الحق',
    transliteration: 'Al-Haqq',
    meaning: 'The Absolute Truth',
    cluster: 'Justice',
    visualCue: 'Stark black-and-paper woodcut contrast, zero ornament',
  },
  {
    id: 93,
    arabic: 'النور',
    transliteration: 'An-Nur',
    meaning: 'The Light',
    cluster: 'Guidance',
    visualCue: 'Central luminous aperture framing typographic focal point',
  },
  {
    id: 94,
    arabic: 'الهادي',
    transliteration: 'Al-Hadi',
    meaning: 'The Guide',
    cluster: 'Guidance',
    visualCue: 'Directional horizon line leading eye across editorial spread',
  },
];

interface ChecklistItem {
  readonly id: string;
  readonly label: string;
}

const READINESS_CHECKLIST: readonly ChecklistItem[] = [
  { id: 'dna-locked', label: 'Artwork-First Visual DNA cue locked before typesetting' },
  { id: 'typography', label: 'Imprint typography hierarchy verified (cover + interior)' },
  { id: 'provenance', label: 'Manuscript provenance & rights clearance recorded' },
  { id: 'preflight', label: 'Print & digital proof preflight signed off' },
];

interface KuroCompanionState {
  readonly expression: KuroExpression;
  readonly clipId: KuroClipId;
  readonly bubbleVariant: 'speech' | 'shout' | 'thought';
  readonly dialogue: string;
}

function resolveKuroCompanionState(
  completedCount: number,
  imprint: ImprintKey
): KuroCompanionState {
  if (completedCount <= 0) {
    return {
      expression: 'thinking',
      clipId: 'idle',
      bubbleVariant: 'thought',
      dialogue: `0/4 gates verified for ${imprint}. Lock the Visual DNA cue first so layout and press specs stay aligned.`,
    };
  }
  if (completedCount === 1) {
    return {
      expression: 'curious',
      clipId: 'idle',
      bubbleVariant: 'speech',
      dialogue: `1/4 gates verified for ${imprint}. Visual direction is anchored—check cover and interior typography next.`,
    };
  }
  if (completedCount === 2) {
    return {
      expression: 'excited',
      clipId: 'idle',
      bubbleVariant: 'speech',
      dialogue: `2/4 gates verified. Halfway to press—record manuscript provenance and rights clearance.`,
    };
  }
  if (completedCount === 3) {
    return {
      expression: 'excited',
      clipId: 'idle',
      bubbleVariant: 'speech',
      dialogue: `3/4 gates verified. One final proof preflight sign-off unlocks full press readiness.`,
    };
  }
  return {
    expression: 'celebrating',
    clipId: 'celebrate',
    bubbleVariant: 'shout',
    dialogue: `4/4 gates verified! ${imprint} edition is press-ready with Story Architect and Zero Drift unlocked.`,
  };
}

const STUDIO_DRAFT_STORAGE_KEY = 'mw-editorial-studio-draft-v1';
const STUDIO_STORY_ID = 'mw:story:editorial-studio-brief';
const STUDIO_AMBIENCE_SOURCES: Record<SceneAmbienceId, string> = {
  'archive-quiet': '/sounds/ambience-archive-quiet.wav',
  'moon-city-night': '/sounds/ambience-moon-city-night.wav',
  'underground-hum': '/sounds/ambience-underground-hum.wav',
  'street-rain': '/sounds/ambience-street-rain.wav',
};

interface StudioDraftPayload {
  imprint: ImprintKey;
  title: string;
  brief: string;
  checkedIds: readonly string[];
  updatedAt: string;
}

class StudioSfxBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function StudioSfxBridge({
  onPlayReady,
}: {
  onPlayReady: (play: (name: SfxName) => void) => void;
}) {
  const { play } = useSfx();
  useEffect(() => {
    onPlayReady(play);
  }, [onPlayReady, play]);
  return null;
}

export function EditorialStudioPanel() {
  const [imprint, setImprint] = useState<ImprintKey>('GOD PROMISE');
  const [title, setTitle] = useState<string>('Covenant of Light — Monograph Vol. I');
  const [brief, setBrief] = useState<string>(
    'Meditative editorial edition pairing archival ink brushwork with contemplative verse and wide breathing margins.'
  );
  const [checkedIds, setCheckedIds] = useState<readonly string[]>(['dna-locked']);
  const [animateCompanion, setAnimateCompanion] = useState<boolean>(false);

  const [cluster, setCluster] = useState<AsmaulCluster>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const sfxPlayRef = useRef<(name: SfxName) => void>(() => {});
  const soundscapeRef = useRef<SceneSoundscapeController | null>(null);
  const [ambienceScene, setAmbienceScene] = useState<SceneAmbienceId>('archive-quiet');
  const [soundscapeSnapshot, setSoundscapeSnapshot] = useState<SceneSoundscapeSnapshot>({
    muted: true,
    activeSceneId: null,
    playing: false,
  });

  const [draftSaving, setDraftSaving] = useState<boolean>(false);
  const [draftLoading, setDraftLoading] = useState<boolean>(false);
  const [exportingFormat, setExportingFormat] = useState<'json' | 'markdown' | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleSfxReady = useCallback((play: (name: SfxName) => void) => {
    sfxPlayRef.current = play;
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage?.getItem(STUDIO_DRAFT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<StudioDraftPayload>;
          if (parsed.imprint === 'GOD PROMISE' || parsed.imprint === 'ROCKSOUL') {
            setImprint(parsed.imprint);
          }
          if (typeof parsed.title === 'string' && parsed.title.trim()) {
            setTitle(parsed.title);
          }
          if (typeof parsed.brief === 'string') {
            setBrief(parsed.brief);
          }
          if (Array.isArray(parsed.checkedIds)) {
            setCheckedIds(
              parsed.checkedIds.filter((item): item is string => typeof item === 'string')
            );
          }
        }
      } catch {
        /* Storage may be unavailable in restricted contexts. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = createSceneSoundscapeController({
      sources: STUDIO_AMBIENCE_SOURCES,
      maxVolume: 0.18,
    });
    soundscapeRef.current = controller;
    const unsubscribe = controller.subscribe((nextSnap) => {
      setSoundscapeSnapshot(nextSnap);
    });
    return () => {
      unsubscribe();
      controller.dispose();
      soundscapeRef.current = null;
    };
  }, []);

  const handleToggleSoundscape = () => {
    const controller = soundscapeRef.current;
    if (!controller) return;
    controller.activateUserGesture();
    controller.enterScene(ambienceScene);
    const nextMuted = !soundscapeSnapshot.muted;
    controller.setMuted(nextMuted);
    sfxPlayRef.current('signal');
  };

  const handleAmbienceSceneChange = (nextScene: SceneAmbienceId) => {
    setAmbienceScene(nextScene);
    const controller = soundscapeRef.current;
    if (!controller) return;
    controller.enterScene(nextScene);
    if (!soundscapeSnapshot.muted) {
      controller.activateUserGesture();
    }
  };

  const visualDnaCue = useMemo(() => {
    const tone =
      imprint === 'GOD PROMISE'
        ? 'Sacred minimalist monograph · warm archival paper · gold-leaf & deep ink accents'
        : 'Raw tactile zine-press · high-contrast risograph · electric cyan/magenta duotone';
    const briefSnippet = brief.trim().slice(0, 96) || 'Awaiting manuscript brief.';
    return `${imprint} DNA :: ${tone} | Anchor: "${briefSnippet}"`;
  }, [imprint, brief]);

  const filteredConcepts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ASMAUL_CONCEPTS.filter((entry) => {
      if (cluster !== 'All' && entry.cluster !== cluster) return false;
      if (!q) return true;
      return `${entry.transliteration} ${entry.meaning} ${entry.cluster} ${entry.visualCue}`
        .toLowerCase()
        .includes(q);
    });
  }, [cluster, searchQuery]);

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
      if (!exists) {
        sfxPlayRef.current(next.length === READINESS_CHECKLIST.length ? 'success' : 'signal');
      }
      return next;
    });
  };

  const handleSaveDraft = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      const msg = 'Edition title is required before saving a draft.';
      setDraftError(msg);
      toast.error(msg);
      sfxPlayRef.current('alert');
      return;
    }

    setDraftSaving(true);
    setDraftError(null);
    setDraftNotice(null);

    const payload: StudioDraftPayload = {
      imprint,
      title: trimmedTitle,
      brief,
      checkedIds,
      updatedAt: new Date().toISOString(),
    };

    try {
      window.localStorage?.setItem(STUDIO_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      const companyId = client.getCompanyId();
      if (companyId) {
        let nextVersion = 1;
        try {
          const existing = await client.getStoryVersion(STUDIO_STORY_ID);
          nextVersion = existing.version + 1;
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
        const doc: StoryVersionDocument = {
          schema_version: 1,
          story_id: STUDIO_STORY_ID,
          version: nextVersion,
          title: trimmedTitle,
          visibility: 'INTERNAL',
          pages: [
            {
              page_id: 'mw:story-page:editorial-studio-brief-1',
              page_order: 1,
              original_text: JSON.stringify(payload, null, 2),
            },
          ],
        };
        const stored = await client.storeStoryVersion(doc);
        const msg = `Draft saved locally and archived to company revision v${stored.version}.`;
        setDraftNotice(msg);
        toast.success(msg);
      } else {
        const msg = 'Draft saved to local browser storage.';
        setDraftNotice(msg);
        toast.success(msg);
      }
      sfxPlayRef.current('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to persist editorial studio draft.';
      setDraftError(msg);
      toast.error(msg);
      sfxPlayRef.current('alert');
    } finally {
      setDraftSaving(false);
    }
  };

  const handleLoadRemoteDraft = async () => {
    setDraftLoading(true);
    setDraftError(null);
    setDraftNotice(null);
    try {
      const stored = await client.getStoryVersion(STUDIO_STORY_ID);
      const raw = stored.story.pages[0]?.original_text;
      if (!raw) throw new Error('Stored editorial brief revision is empty.');
      const parsed = JSON.parse(raw) as Partial<StudioDraftPayload>;
      if (parsed.imprint === 'GOD PROMISE' || parsed.imprint === 'ROCKSOUL') {
        setImprint(parsed.imprint);
      }
      if (typeof parsed.title === 'string') setTitle(parsed.title);
      if (typeof parsed.brief === 'string') setBrief(parsed.brief);
      if (Array.isArray(parsed.checkedIds)) {
        setCheckedIds(parsed.checkedIds.filter((item): item is string => typeof item === 'string'));
      }
      window.localStorage?.setItem(STUDIO_DRAFT_STORAGE_KEY, raw);
      const msg = `Loaded company draft revision v${stored.version}.`;
      setDraftNotice(msg);
      toast.success(msg);
      sfxPlayRef.current('signal');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load saved draft revision.';
      setDraftError(msg);
      toast.error(msg);
      sfxPlayRef.current('alert');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleExportBrief = (format: 'json' | 'markdown') => {
    setExportingFormat(format);
    setDraftError(null);
    try {
      const slug = (title.trim() || 'editorial-brief')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
      const filename = `${slug || 'editorial-brief'}.${format === 'json' ? 'json' : 'md'}`;
      const content =
        format === 'json'
          ? JSON.stringify(
              {
                imprint,
                title: title.trim() || 'Untitled Edition',
                brief,
                visualDnaCue,
                readinessChecklist: READINESS_CHECKLIST.map((item) => ({
                  ...item,
                  verified: checkedIds.includes(item.id),
                })),
                completedCount: checkedIds.length,
                totalChecklistCount: READINESS_CHECKLIST.length,
                exportedAt: new Date().toISOString(),
              },
              null,
              2
            )
          : [
              `# ${title.trim() || 'Untitled Edition'}`,
              '',
              `- **Imprint**: ${imprint}`,
              `- **Visual DNA**: ${visualDnaCue}`,
              `- **Readiness**: ${checkedIds.length}/${READINESS_CHECKLIST.length} gates verified`,
              '',
              '## Manuscript Brief',
              '',
              brief.trim() || '_No manuscript brief entered._',
              '',
              '## Publication Readiness Checklist',
              '',
              ...READINESS_CHECKLIST.map(
                (item) => `- [${checkedIds.includes(item.id) ? 'x' : ' '}] ${item.label}`
              ),
              '',
            ].join('\n');

      const blob = new Blob([content], {
        type:
          format === 'json' ? 'application/json;charset=utf-8;' : 'text/markdown;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const msg = `Exported ${format.toUpperCase()} brief (${filename}).`;
      setDraftNotice(msg);
      toast.success(msg);
      sfxPlayRef.current('signal');
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to export ${format} brief.`;
      setDraftError(msg);
      toast.error(msg);
      sfxPlayRef.current('alert');
    } finally {
      setExportingFormat(null);
    }
  };

  const resetAsmaulFilters = () => {
    setCluster('All');
    setSearchQuery('');
  };

  const completedCount = checkedIds.length;
  const totalChecklistCount = READINESS_CHECKLIST.length;
  const readinessPercent = Math.round((completedCount / totalChecklistCount) * 100);
  const isPressReady = completedCount === totalChecklistCount;
  const kuroState = resolveKuroCompanionState(completedCount, imprint);

  const noSearchArt = getStateIllustration('no-search-results');
  const emptyCollectionArt = getStateIllustration('empty-collection');
  const discoverArt = getStateIllustration('discover');

  return (
    <div className="space-y-6">
      <StudioSfxBoundary>
        <StudioSfxBridge onPlayReady={handleSfxReady} />
      </StudioSfxBoundary>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          label="Active Imprint"
          value={imprint}
          detail="Artwork-First Editorial Pipeline"
          accent="yellow"
          icon={<SparkleIcon className="size-4" />}
        />
        <MetricTile
          label="Publication Readiness"
          value={`${readinessPercent}%`}
          detail={`${completedCount} / ${totalChecklistCount} gates verified`}
          accent="green"
          icon={<CheckIcon className="size-4" />}
        />
        <MetricTile
          label="Asmaul Husna Index"
          value={`${filteredConcepts.length} / ${ASMAUL_CONCEPTS.length}`}
          detail="6 thematic concept clusters"
          accent="cyan"
          icon={<DocumentIcon className="size-4" />}
        />
      </div>

      <ComicPanel
        panelNumber="01"
        kicker="SIGNAL RIOT · COMPANION STAGE"
        title="Kuro Signal Studio Desk"
        surface="paper"
        frame="comic"
        accent="magenta"
        halftone
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StickerBadge tone={isPressReady ? 'yellow' : 'magenta'} tilt="left">
              {kuroState.expression.toUpperCase()}
            </StickerBadge>
            <SelectField
              aria-label="Studio ambient soundscape track"
              value={ambienceScene}
              onChange={(event) => handleAmbienceSceneChange(event.target.value as SceneAmbienceId)}
              className="h-8 text-xs"
            >
              <option value="archive-quiet">Archive Quiet</option>
              <option value="moon-city-night">Moon City Night</option>
              <option value="underground-hum">Underground Hum</option>
              <option value="street-rain">Street Rain</option>
            </SelectField>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={!soundscapeSnapshot.muted}
              aria-label={
                soundscapeSnapshot.muted ? 'Enable ambient soundscape' : 'Mute ambient soundscape'
              }
              onClick={handleToggleSoundscape}
            >
              {soundscapeSnapshot.muted ? (
                <>
                  <VolumeOffIcon aria-hidden="true" className="size-3.5" /> Ambience: Muted
                </>
              ) : (
                <>
                  <VolumeIcon aria-hidden="true" className="size-3.5" /> Ambience: On
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={animateCompanion}
              onClick={() => setAnimateCompanion((prev) => !prev)}
            >
              {animateCompanion ? (
                <>
                  <PauseIcon aria-hidden="true" className="size-3.5" /> Static Expression
                </>
              ) : (
                <>
                  <PlayIcon aria-hidden="true" className="size-3.5" /> Play {kuroState.clipId} Clip
                </>
              )}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <CharacterDisplay
            characterId="kuro-signal"
            expression={kuroState.expression}
            animated={animateCompanion}
            clipId={kuroState.clipId}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-3">
            <SpeechBubble
              speaker={`Kuro Signal · ${completedCount}/${totalChecklistCount} Gates`}
              tail="left"
              variant={kuroState.bubbleVariant}
              role="status"
              aria-live="polite"
            >
              {kuroState.dialogue}
            </SpeechBubble>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary">{imprint}</Badge>
              <Badge variant={isPressReady ? 'cyan' : 'magenta'}>
                Clip: kuro-signal-{kuroState.clipId}
              </Badge>
              <span className="font-mono text-xs text-ink-soft">
                Reduced motion automatically holds static portrait artwork.
              </span>
            </div>
          </div>
        </div>
      </ComicPanel>

      <Tabs defaultValue="editorial" className="space-y-4">
        <TabsList>
          <TabsTrigger value="editorial">GOD PROMISE &amp; ROCKSOUL Editorial</TabsTrigger>
          <TabsTrigger value="asmaul-husna">Asmaul Husna Concept Explorer</TabsTrigger>
          <TabsTrigger value="husna-graph">Asmaul Husna Knowledge Graph</TabsTrigger>
          <TabsTrigger value="extensions">Extension Hub Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="editorial">
          <div className="space-y-4">
            <Panel
              title="Artwork-First Editorial Workflow"
              description="Define the manuscript brief, synthesize the Visual DNA cue, and verify publication readiness before press."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="primary">{imprint}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={draftSaving}
                    onClick={() => void handleSaveDraft()}
                  >
                    <SaveIcon aria-hidden="true" className="size-3.5" />
                    {draftSaving ? 'Saving Draft…' : 'Save Draft'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={draftLoading}
                    onClick={() => void handleLoadRemoteDraft()}
                  >
                    <RefreshIcon aria-hidden="true" className="size-3.5" />
                    {draftLoading ? 'Loading…' : 'Load Archive'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportingFormat !== null}
                    onClick={() => handleExportBrief('json')}
                  >
                    <DownloadIcon aria-hidden="true" className="size-3.5" />
                    {exportingFormat === 'json' ? 'Exporting…' : 'Export JSON'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportingFormat !== null}
                    onClick={() => handleExportBrief('markdown')}
                  >
                    <DownloadIcon aria-hidden="true" className="size-3.5" />
                    {exportingFormat === 'markdown' ? 'Exporting…' : 'Export Markdown'}
                  </Button>
                </div>
              }
            >
              {draftError ? (
                <div className="mb-4">
                  <ErrorState
                    role="alert"
                    headingLevel={3}
                    title="Editorial draft persistence failed"
                    description={draftError}
                    retrying={draftSaving || draftLoading}
                    onRetry={() => void handleSaveDraft()}
                  />
                </div>
              ) : null}
              {draftNotice && !draftError ? (
                <p
                  role="status"
                  className="mb-4 border border-ink/20 bg-paper p-2.5 font-mono text-xs text-ink"
                >
                  {draftNotice}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-imprint">Imprint</Label>
                    <SelectField
                      id="studio-imprint"
                      value={imprint}
                      onChange={(event) => setImprint(event.target.value as ImprintKey)}
                    >
                      <option value="GOD PROMISE">GOD PROMISE</option>
                      <option value="ROCKSOUL">ROCKSOUL</option>
                    </SelectField>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="studio-title">Edition Title</Label>
                    <Input
                      id="studio-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Enter manuscript or issue title"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="studio-brief">Manuscript Brief</Label>
                    <Textarea
                      id="studio-brief"
                      rows={4}
                      value={brief}
                      onChange={(event) => setBrief(event.target.value)}
                      placeholder="Describe thematic arc, visual mood, and target reader..."
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2 rounded-md border border-ink/20 bg-paper p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold uppercase tracking-wide text-ink">
                        Artwork-First Visual DNA Cue
                      </span>
                      <Badge variant="cyan">Live Synthesis</Badge>
                    </div>
                    <p className="text-sm font-semibold text-ink">{title || 'Untitled Edition'}</p>
                    <p className="font-mono text-xs leading-relaxed text-ink-soft">
                      {visualDnaCue}
                    </p>
                  </div>

                  <div className="space-y-2 rounded-md border border-ink/15 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold uppercase tracking-wide text-ink">
                        Publication Readiness Checklist
                      </span>
                      <Badge variant={isPressReady ? 'primary' : 'magenta'}>
                        {isPressReady ? 'PRESS READY' : 'IN REVIEW'}
                      </Badge>
                    </div>
                    <div className="space-y-2.5 pt-1">
                      {READINESS_CHECKLIST.map((item) => {
                        const checked = checkedIds.includes(item.id);
                        return (
                          <div key={item.id} className="flex items-center gap-2.5">
                            <Checkbox
                              id={`check-${item.id}`}
                              checked={checked}
                              onChange={() => toggleCheck(item.id)}
                            />
                            <Label htmlFor={`check-${item.id}`} className="cursor-pointer text-xs">
                              {item.label}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <QuestCard
                title="Publication Readiness Quest"
                description="Complete all four editorial verification gates before releasing an edition to press."
                completedSteps={completedCount}
                totalSteps={totalChecklistCount}
                status={isPressReady ? 'completed' : 'active'}
                badgeId="badge-story-architect"
                rewardLabel={
                  isPressReady ? 'Unlocked: Story Architect & Zero Drift' : 'Unlocks at 4/4 gates'
                }
              />
              <RewardPanel
                title="Studio Mastery Unlocks"
                description="Badges unlock deterministically from verified checklist gates."
                completedCount={completedCount}
                totalCount={totalChecklistCount}
                headingLevel={3}
                badges={[
                  {
                    badgeId: 'badge-story-architect',
                    title: 'Story Architect',
                    rank: 'Architect',
                    unlocked: isPressReady,
                  },
                  {
                    badgeId: 'badge-zero-drift',
                    title: 'Zero Drift',
                    rank: 'Vanguard',
                    unlocked: isPressReady,
                  },
                ]}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="asmaul-husna">
          <MangaFrame
            panelNumber="02"
            kicker="THEMATIC INDEX · 6 CLUSTERS"
            title="Asmaul Husna Concept Explorer"
            surface="paper"
            frame="comic"
            accent="cyan"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StickerBadge tone="magenta" tilt="left">
                  6 CLUSTERS
                </StickerBadge>
                <StickerBadge tone="yellow" tilt="right">
                  {filteredConcepts.length} SHOWN
                </StickerBadge>
                <Button type="button" variant="outline" size="sm" onClick={resetAsmaulFilters}>
                  Reset Filters
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-md border border-ink/15 bg-card p-3 sm:flex-row sm:items-center">
                <CharacterDisplay characterId="vesper-ink" size="sm" />
                <SpeechBubble speaker="Vesper Ink · Archivist" tail="left" variant="speech">
                  {filteredConcepts.length === 0
                    ? 'No concept entries match the active cluster and search terms. Reset filters to restore all 12 anchors.'
                    : `Showing ${filteredConcepts.length} of ${ASMAUL_CONCEPTS.length} visual anchors in ${cluster === 'All' ? 'all 6 clusters' : cluster}.`}
                </SpeechBubble>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="relative sm:col-span-8">
                  <SearchIcon
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search name, meaning, or visual cue..."
                    aria-label="Search Asmaul Husna concepts"
                    className="pl-8"
                  />
                </div>
                <div className="sm:col-span-4">
                  <SelectField
                    aria-label="Filter by thematic cluster"
                    value={cluster}
                    onChange={(event) => setCluster(event.target.value as AsmaulCluster)}
                  >
                    {ASMAUL_CLUSTERS.map((item) => (
                      <option key={item} value={item}>
                        {item === 'All' ? 'All Clusters (6)' : item}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </div>

              {filteredConcepts.length === 0 ? (
                <EmptyState
                  title="No Asmaul Husna concept entries match"
                  description="No Asmaul Husna concept entries match the current filter."
                  icon={
                    <img
                      src={noSearchArt.src}
                      alt=""
                      className="h-32 w-32 object-contain"
                      decoding="async"
                    />
                  }
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={resetAsmaulFilters}>
                      Reset Filters
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredConcepts.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col justify-between gap-2 rounded-md border border-ink/15 bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-lg font-bold text-ink">{entry.arabic}</div>
                          <div className="font-mono text-xs font-semibold text-ink">
                            {entry.id}. {entry.transliteration}
                          </div>
                        </div>
                        <Badge variant="cyan">{entry.cluster}</Badge>
                      </div>
                      <p className="text-xs font-medium text-ink-soft">{entry.meaning}</p>
                      <p className="border-t border-ink/10 pt-2 font-mono text-[11px] text-ink-faint">
                        DNA: {entry.visualCue}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </MangaFrame>
        </TabsContent>

        <TabsContent value="husna-graph">
          <Panel>
            <EmptyState
              title="Knowledge graph belum tersedia"
              description="Explorer graf Asmaul Husna belum dipasang di workspace ini."
              icon={
                <img
                  src={emptyCollectionArt.src}
                  alt=""
                  className="h-32 w-32 object-contain"
                  decoding="async"
                />
              }
            />
          </Panel>
        </TabsContent>

        <TabsContent value="extensions">
          <Panel>
            <EmptyState
              title="Extension hub belum tersedia"
              description="Katalog ekstensi belum dipasang di workspace ini."
              icon={
                <img
                  src={discoverArt.src}
                  alt=""
                  className="h-32 w-32 object-contain"
                  decoding="async"
                />
              }
            />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
