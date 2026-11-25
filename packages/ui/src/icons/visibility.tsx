import { forwardRef, useId, type SVGProps } from 'react';

export type VisibilityIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const VisibilityIcon = forwardRef<SVGSVGElement, VisibilityIconProps>(function VisibilityIcon(
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
      <path d="M2.5 12s3.2-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.2 5.5-9.5 5.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
});

VisibilityIcon.displayName = 'VisibilityIcon';

export { VisibilityIcon };
