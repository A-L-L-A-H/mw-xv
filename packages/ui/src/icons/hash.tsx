import { forwardRef, useId, type SVGProps } from 'react';

export type HashIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const HashIcon = forwardRef<SVGSVGElement, HashIconProps>(function HashIcon(
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
      <path d="M9 3 6.5 21M17.5 3 15 21M4 9h16M3 15h16" />
    </svg>
  );
});

HashIcon.displayName = 'HashIcon';

export { HashIcon };
