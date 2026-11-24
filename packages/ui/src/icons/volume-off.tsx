import { forwardRef, useId, type SVGProps } from 'react';

export type VolumeOffIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const VolumeOffIcon = forwardRef<SVGSVGElement, VolumeOffIconProps>(function VolumeOffIcon(
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
      <path d="M4 10v4h4l5 4V6l-5 4H4Zm11-1 6 6m0-6-6 6" />
    </svg>
  );
});

VolumeOffIcon.displayName = 'VolumeOffIcon';

export { VolumeOffIcon };
