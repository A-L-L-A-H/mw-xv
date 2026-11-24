import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type SpeechBubbleVariant = 'speech' | 'shout' | 'thought';
export type SpeechBubbleTail = 'left' | 'right' | 'top' | 'bottom';

export type SpeechBubbleProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  variant?: SpeechBubbleVariant;
  tail?: SpeechBubbleTail;
  speaker?: ReactNode;
  children: ReactNode;
};

/** Directional comic speech, shout, or thought bubble with optional speaker attribution. */
export const SpeechBubble = forwardRef<HTMLDivElement, SpeechBubbleProps>(function SpeechBubble(
  { variant = 'speech', tail = 'bottom', speaker, children, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('mw-ui-speech-bubble', className)}
      data-tail={tail}
      data-variant={variant}
      {...props}
    >
      {speaker ? <span className="mw-ui-speech-bubble-speaker">{speaker}</span> : null}
      <div className="mw-ui-speech-bubble-body">{children}</div>
    </div>
  );
});

export type StickerBadgeTone = 'yellow' | 'magenta' | 'cyan' | 'violet';
export type StickerBadgeTilt = 'left' | 'right' | 'flat';

export type StickerBadgeProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  tone?: StickerBadgeTone;
  tilt?: StickerBadgeTilt;
  children: ReactNode;
};

/** High-contrast zine sticker badge for callouts and tags; tilt stays strictly decorative. */
export const StickerBadge = forwardRef<HTMLSpanElement, StickerBadgeProps>(function StickerBadge(
  { tone = 'yellow', tilt = 'left', children, className, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn('mw-ui-sticker-badge', className)}
      data-tilt={tilt}
      data-tone={tone}
      {...props}
    >
      {children}
    </span>
  );
});
