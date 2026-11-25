import { forwardRef, useId, type SVGProps } from 'react';

export type SmartphoneIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const SmartphoneIcon = forwardRef<SVGSVGElement, SmartphoneIconProps>(function SmartphoneIcon(
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
      <rect x="6" y="2.5" width="12" height="19" rx="2" />
      <path d="M10 5h4m-4 13h4" />
    </svg>
  );
});

SmartphoneIcon.displayName = 'SmartphoneIcon';

export { SmartphoneIcon };
