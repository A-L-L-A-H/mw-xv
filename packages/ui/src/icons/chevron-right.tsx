import { forwardRef, useId, type SVGProps } from 'react';

export type ChevronRightIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const ChevronRightIcon = forwardRef<SVGSVGElement, ChevronRightIconProps>(function ChevronRightIcon(
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
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
});

ChevronRightIcon.displayName = 'ChevronRightIcon';

export { ChevronRightIcon };
