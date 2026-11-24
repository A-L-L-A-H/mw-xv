import { forwardRef, useId, type SVGProps } from 'react';

export type CodeIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const CodeIcon = forwardRef<SVGSVGElement, CodeIconProps>(function CodeIcon(
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
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18" />
    </svg>
  );
});

CodeIcon.displayName = 'CodeIcon';

export { CodeIcon };
