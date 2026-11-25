import { forwardRef, useId, type SVGProps } from 'react';

export type MenuIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const MenuIcon = forwardRef<SVGSVGElement, MenuIconProps>(function MenuIcon(
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
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
});

MenuIcon.displayName = 'MenuIcon';

export { MenuIcon };
