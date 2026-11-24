import { forwardRef, useId, type SVGProps } from 'react';

export type PauseIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const PauseIcon = forwardRef<SVGSVGElement, PauseIconProps>(function PauseIcon(
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
      <path d="M8 5h3v14H8zm5 0h3v14h-3z" />
    </svg>
  );
});

PauseIcon.displayName = 'PauseIcon';

export { PauseIcon };
