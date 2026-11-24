import { forwardRef, useId, type SVGProps } from 'react';

export type InboxIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const InboxIcon = forwardRef<SVGSVGElement, InboxIconProps>(function InboxIcon(
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
      <path d="M4 4.5h16l2 10v5H2v-5l2-10Z" />
      <path d="M2.5 14h5l1.7 3h5.6l1.7-3h5" />
    </svg>
  );
});

InboxIcon.displayName = 'InboxIcon';

export { InboxIcon };
