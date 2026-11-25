import { forwardRef, useId, type SVGProps } from 'react';

export type EditIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const EditIcon = forwardRef<SVGSVGElement, EditIconProps>(function EditIcon(
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
      <path d="m14.5 5.5 4 4M4 20l4.5-1 10.8-10.8a2.8 2.8 0 0 0-4-4L4.5 15 4 20Z" />
      <path d="M13 20h7" />
    </svg>
  );
});

EditIcon.displayName = 'EditIcon';

export { EditIcon };
