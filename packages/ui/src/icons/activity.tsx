import { forwardRef, useId, type SVGProps } from 'react';

export type ActivityIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const ActivityIcon = forwardRef<SVGSVGElement, ActivityIconProps>(function ActivityIcon(
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
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2m-11-9 2-1.5m13 1.5-2-1.5" />
    </svg>
  );
});

ActivityIcon.displayName = 'ActivityIcon';

export { ActivityIcon };
