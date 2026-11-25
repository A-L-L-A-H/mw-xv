import { forwardRef, useId, type SVGProps } from 'react';

export type MailIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const MailIcon = forwardRef<SVGSVGElement, MailIconProps>(function MailIcon(
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
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="m4 6 8 6 8-6" />
    </svg>
  );
});

MailIcon.displayName = 'MailIcon';

export { MailIcon };
