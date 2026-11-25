import { forwardRef, useId, type SVGProps } from 'react';

export type BookOpenIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const BookOpenIcon = forwardRef<SVGSVGElement, BookOpenIconProps>(function BookOpenIcon(
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
      <path d="M12 6c-2-2-5-2.5-9-1v14c4-1.5 7-1 9 1m0-14c2-2 5-2.5 9-1v14c-4-1.5-7-1-9 1m0-14v14" />
    </svg>
  );
});

BookOpenIcon.displayName = 'BookOpenIcon';

export { BookOpenIcon };
