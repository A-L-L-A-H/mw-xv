'use client';

import { forwardRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { useReducedMotion } from '../lib/use-reduced-motion.js';
import { Button } from './button.js';
import { ComicPanel } from './comic-panel.js';
import { SpeechBubble } from './speech-bubble.js';

export interface ComicTheaterPanelItem {
  id: string;
  beat?: string;
  imageSrc: string;
  imageAlt: string;
  speaker?: string;
  dialogue?: string;
  dialogueId?: string;
  caption?: string;
}

export type ComicTheaterMode = 'stage' | 'webtoon' | 'static';
export type ComicTheaterLang = 'en' | 'id';

export type ComicTheaterProps = Omit<ComponentPropsWithoutRef<'section'>, 'children'> & {
  title: string;
  episodeCode?: string;
  panels: ComicTheaterPanelItem[];
  initialMode?: ComicTheaterMode;
  initialLang?: ComicTheaterLang;
  reducedMotion?: boolean;
  headerActions?: ReactNode;
  onPanelChange?: (index: number, panel: ComicTheaterPanelItem) => void;
};

/**
 * Composable 2.5D / Webtoon / Static Comic Theater built on @moonwitness/ui primitives.
 * Honors prefers-reduced-motion and supports EN/ID bilingual lettering out of the box.
 */
export const ComicTheater = forwardRef<HTMLElement, ComicTheaterProps>(function ComicTheater(
  {
    title,
    episodeCode = 'EP-LAB-01',
    panels,
    initialMode = 'stage',
    initialLang = 'en',
    reducedMotion,
    headerActions,
    onPanelChange,
    className,
    ...props
  },
  ref
) {
  const isReducedMotion = useReducedMotion(reducedMotion);
  const [mode, setMode] = useState<ComicTheaterMode>(initialMode);
  const [lang, setLang] = useState<ComicTheaterLang>(initialLang);
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, panels.length - 1));
  const current = panels[safeIndex];

  function selectPanel(nextIndex: number) {
    if (panels.length === 0) return;
    const clamped = Math.min(Math.max(0, nextIndex), panels.length - 1);
    setActiveIndex(clamped);
    const panel = panels[clamped];
    if (panel && onPanelChange) onPanelChange(clamped, panel);
  }

  function resolveDialogue(panel: ComicTheaterPanelItem) {
    if (lang === 'id' && panel.dialogueId) return panel.dialogueId;
    return panel.dialogue ?? '';
  }

  return (
    <section
      ref={ref}
      className={cn('mw-ui-comic-theater', className)}
      data-comic-mode={mode}
      data-comic-lang={lang}
      data-reduced-motion={isReducedMotion ? 'true' : undefined}
      {...props}
    >
      <div className="mw-ui-comic-theater-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <strong>{episodeCode}</strong> · {title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button type="button" variant={mode === 'stage' ? 'default' : 'ghost'} onClick={() => setMode('stage')}>
            Stage
          </Button>
          <Button type="button" variant={mode === 'webtoon' ? 'default' : 'ghost'} onClick={() => setMode('webtoon')}>
            Webtoon
          </Button>
          <Button type="button" variant={mode === 'static' ? 'default' : 'ghost'} onClick={() => setMode('static')}>
            Static
          </Button>
          <Button type="button" variant="ghost" onClick={() => setLang(lang === 'en' ? 'id' : 'en')}>
            Lang: {lang.toUpperCase()}
          </Button>
          {headerActions}
        </div>
      </div>

      {mode === 'stage' && current ? (
        <ComicPanel
          panelNumber={current.id}
          kicker={current.beat}
          title={current.caption}
          surface="ink"
          frame="comic"
          accent="cyan"
        >
          <img
            src={current.imageSrc}
            alt={current.imageAlt}
            style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }}
          />
          {resolveDialogue(current) ? (
            <SpeechBubble speaker={current.speaker} reducedMotion={isReducedMotion}>
              {resolveDialogue(current)}
            </SpeechBubble>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Button type="button" variant="ghost" disabled={safeIndex <= 0} onClick={() => selectPanel(safeIndex - 1)}>
              Prev Panel
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={safeIndex >= panels.length - 1}
              onClick={() => selectPanel(safeIndex + 1)}
            >
              Next Panel
            </Button>
          </div>
        </ComicPanel>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: mode === 'static' ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
          }}
        >
          {panels.map((panel) => (
            <ComicPanel
              key={panel.id}
              panelNumber={panel.id}
              kicker={panel.beat}
              title={panel.caption}
              surface="paper"
              frame="comic"
              accent="yellow"
            >
              <img
                src={panel.imageSrc}
                alt={panel.imageAlt}
                loading="lazy"
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 4 }}
              />
              {resolveDialogue(panel) ? (
                <SpeechBubble speaker={panel.speaker} reducedMotion={isReducedMotion}>
                  {resolveDialogue(panel)}
                </SpeechBubble>
              ) : null}
            </ComicPanel>
          ))}
        </div>
      )}
    </section>
  );
});
