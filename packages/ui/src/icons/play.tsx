import { forwardRef, useId, type SVGProps } from 'react';

export type PlayIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const PlayIcon = forwardRef<SVGSVGElement, PlayIconProps>(function PlayIcon(
  { size = 24, title, ...props },
  ref
) {
  const titleId = useId();
  return (
    <svg
      ref={ref}
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      height={size}
      role={title ? 'img' : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
});

PlayIcon.displayName = 'PlayIcon';

export { PlayIcon };
