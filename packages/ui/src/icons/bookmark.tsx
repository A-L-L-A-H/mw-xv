import { forwardRef, useId, type SVGProps } from 'react';

export type BookmarkIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const BookmarkIcon = forwardRef<SVGSVGElement, BookmarkIconProps>(function BookmarkIcon(
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
      <path d="M6 3.5h12v17l-6-4-6 4v-17Z" />
    </svg>
  );
});

BookmarkIcon.displayName = 'BookmarkIcon';

export { BookmarkIcon };
