import { forwardRef, useId, type SVGProps } from 'react';

export type SignalOffIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const SignalOffIcon = forwardRef<SVGSVGElement, SignalOffIconProps>(function SignalOffIcon(
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
      <path d="m3 3 18 18M8.5 8.5A11 11 0 0 0 4 18m5.5-5.5a7 7 0 0 0-2.4 2.4m6.2-6.2a7 7 0 0 1 4.7 2.2m-1.5-5.4A11 11 0 0 1 20 18m-8-1v.1" />
    </svg>
  );
});

SignalOffIcon.displayName = 'SignalOffIcon';

export { SignalOffIcon };
