import { forwardRef, useId, type SVGProps } from 'react';

export type HomeIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const HomeIcon = forwardRef<SVGSVGElement, HomeIconProps>(function HomeIcon(
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
      <path d="m3 11 9-7 9 7v9h-6v-6H9v6H3v-9Z" />
    </svg>
  );
});

HomeIcon.displayName = 'HomeIcon';

export { HomeIcon };
