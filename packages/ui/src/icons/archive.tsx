import { forwardRef, useId, type SVGProps } from 'react';

export type ArchiveIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const ArchiveIcon = forwardRef<SVGSVGElement, ArchiveIconProps>(function ArchiveIcon(
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
      <path d="M4 5h16v4H4zM6 9v11h12V9m-8 4h4" />
    </svg>
  );
});

ArchiveIcon.displayName = 'ArchiveIcon';

export { ArchiveIcon };
