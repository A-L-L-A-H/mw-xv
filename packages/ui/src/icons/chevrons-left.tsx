import { forwardRef, useId, type SVGProps } from 'react';

export type ChevronsLeftIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const ChevronsLeftIcon = forwardRef<SVGSVGElement, ChevronsLeftIconProps>(function ChevronsLeftIcon(
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
      <path d="m17 5-7 7 7 7M9 5l-7 7 7 7" />
    </svg>
  );
});

ChevronsLeftIcon.displayName = 'ChevronsLeftIcon';

export { ChevronsLeftIcon };
