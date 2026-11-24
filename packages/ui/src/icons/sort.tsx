import { forwardRef, useId, type SVGProps } from 'react';

export type SortIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const SortIcon = forwardRef<SVGSVGElement, SortIconProps>(function SortIcon(
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
      <path d="M8 5v14m-4-4 4 4 4-4M16 19V5m-4 4 4-4 4 4" />
    </svg>
  );
});

SortIcon.displayName = 'SortIcon';

export { SortIcon };
