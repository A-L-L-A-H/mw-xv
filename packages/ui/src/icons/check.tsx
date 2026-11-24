import { forwardRef, useId, type SVGProps } from 'react';

export type CheckIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const CheckIcon = forwardRef<SVGSVGElement, CheckIconProps>(function CheckIcon(
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
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
});

CheckIcon.displayName = 'CheckIcon';

export { CheckIcon };
