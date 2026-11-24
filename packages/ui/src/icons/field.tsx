import { forwardRef, useId, type SVGProps } from 'react';

export type FieldIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const FieldIcon = forwardRef<SVGSVGElement, FieldIconProps>(function FieldIcon(
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
      <path d="M4 5h16M4 9h9m-9 4h16m-16 4h10" />
      <circle cx="18" cy="9" r="1" />
    </svg>
  );
});

FieldIcon.displayName = 'FieldIcon';

export { FieldIcon };
