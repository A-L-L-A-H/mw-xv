import { forwardRef, useId, type SVGProps } from 'react';

export type WarningIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const WarningIcon = forwardRef<SVGSVGElement, WarningIconProps>(function WarningIcon(
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
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 9v5m0 3h.01" />
    </svg>
  );
});

WarningIcon.displayName = 'WarningIcon';

export { WarningIcon };
