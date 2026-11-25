import { forwardRef, useId, type SVGProps } from 'react';

export type SendIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const SendIcon = forwardRef<SVGSVGElement, SendIconProps>(function SendIcon(
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
      <path d="m21.5 2.5-7 19-4-8-8-4 19-7Z" />
      <path d="m10.5 13.5 5-5" />
    </svg>
  );
});

SendIcon.displayName = 'SendIcon';

export { SendIcon };
