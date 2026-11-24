import { createElement, forwardRef, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';
import { cn } from '../lib/cn.js';

export type ComicSurface = 'paper' | 'ink' | 'default';
export type ComicFrame = 'comic' | 'torn' | 'scuffed';
export type ComicAccent = 'yellow' | 'magenta' | 'cyan' | 'violet';

export type ComicPanelProps = Omit<ComponentPropsWithoutRef<'section'>, 'children' | 'title'> & {
  panelNumber?: string | number;
  kicker?: ReactNode;
  title?: ReactNode;
  surface?: ComicSurface;
  frame?: ComicFrame;
  accent?: ComicAccent;
  halftone?: boolean;
  headingLevel?: 2 | 3 | 4;
  actions?: ReactNode;
  children: ReactNode;
};

export type MangaFrameProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'title'> & {
  panelNumber?: string | number;
  kicker?: ReactNode;
  title?: ReactNode;
  surface?: ComicSurface;
  frame?: ComicFrame;
  accent?: ComicAccent;
  halftone?: boolean;
  headingLevel?: 2 | 3 | 4;
  actions?: ReactNode;
  children: ReactNode;
};

type PanelShellProps = Omit<ComicPanelProps, 'headingLevel'> & {
  headingLevel: 2 | 3 | 4;
  surface: ComicSurface;
  frame: ComicFrame;
  accent: ComicAccent;
  halftone: boolean;
};

function renderComicShell(
  tag: 'section' | 'div',
  extraClass: string | undefined,
  {
    panelNumber,
    kicker,
    title,
    surface,
    frame,
    accent,
    halftone,
    headingLevel,
    actions,
    children,
    className,
    ...props
  }: PanelShellProps,
  ref: Ref<HTMLElement>
) {
  const Heading = `h${headingLevel}` as const;
  const hasHeader =
    panelNumber !== undefined || kicker !== undefined || title !== undefined || actions !== undefined;

  return createElement(
    tag,
    {
      ref,
      className: cn('mw-ui-comic-panel', extraClass, 'mw-ui-panel', className),
      'data-accent': accent,
      'data-frame': frame,
      'data-halftone': halftone ? 'true' : 'false',
      'data-surface': surface,
      ...props,
    },
    hasHeader ? (
      <header className="mw-ui-panel-header mw-ui-comic-panel-header">
        <div className="mw-ui-comic-panel-meta">
          {panelNumber !== undefined ? <span className="mw-ui-comic-panel-num">{panelNumber}</span> : null}
          {kicker ? <span className="mw-ui-comic-panel-kicker">{kicker}</span> : null}
          {title ? <Heading className="mw-ui-panel-title mw-ui-comic-panel-title">{title}</Heading> : null}
        </div>
        {actions ? <div className="mw-ui-panel-actions mw-ui-comic-panel-actions">{actions}</div> : null}
      </header>
    ) : null,
    <div className="mw-ui-comic-panel-body">{children}</div>
  );
}

/** Editorial comic panel with gutter-safe framing, panel numbering, and halftone surface option. */
export const ComicPanel = forwardRef<HTMLElement, ComicPanelProps>(function ComicPanel(
  {
    surface = 'default',
    frame = 'comic',
    accent = 'yellow',
    halftone = true,
    headingLevel = 3,
    ...rest
  },
  ref
) {
  return renderComicShell('section', undefined, { surface, frame, accent, halftone, headingLevel, ...rest }, ref);
});

/** High-contrast manga frame container with ink-heavy accent offset and comic header slots. */
export const MangaFrame = forwardRef<HTMLDivElement, MangaFrameProps>(function MangaFrame(
  {
    surface = 'ink',
    frame = 'comic',
    accent = 'magenta',
    halftone = true,
    headingLevel = 3,
    ...rest
  },
  ref
) {
  return renderComicShell(
    'div',
    'mw-ui-manga-frame',
    { ...(rest as Omit<PanelShellProps, 'surface' | 'frame' | 'accent' | 'halftone' | 'headingLevel'>), surface, frame, accent, halftone, headingLevel },
    ref
  );
});
