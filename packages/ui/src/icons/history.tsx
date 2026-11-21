import { useId, type SVGProps } from 'react';

export type HistoryIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

export function HistoryIcon({ size = 24, title, ...props }: HistoryIconProps) {
  const titleId = useId();
  return (
    <svg
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
      <path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5M12 7.5v4.5l3 2" />
    </svg>
  );
}
