import { forwardRef, useId, type SVGProps } from 'react';

export type AttachmentIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const AttachmentIcon = forwardRef<SVGSVGElement, AttachmentIconProps>(function AttachmentIcon(
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
      <path d="m8.5 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6" />
      <path d="m7.1 13.9 7.8-7.8" />
    </svg>
  );
});

AttachmentIcon.displayName = 'AttachmentIcon';

export { AttachmentIcon };
