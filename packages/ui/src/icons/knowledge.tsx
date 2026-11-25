import { forwardRef, useId, type SVGProps } from 'react';

export type KnowledgeIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> & {
  title?: string;
  size?: number | string;
};

const KnowledgeIcon = forwardRef<SVGSVGElement, KnowledgeIconProps>(function KnowledgeIcon(
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
      <path d="M4 5.5c3.2-1.2 5.8-.8 8 1.2 2.2-2 4.8-2.4 8-1.2v14c-3.2-1.2-5.8-.8-8 1.2-2.2-2-4.8-2.4-8-1.2v-14Z" />
      <path d="M12 6.7v14m-5-11h2m6 0h2" />
    </svg>
  );
});

KnowledgeIcon.displayName = 'KnowledgeIcon';

export { KnowledgeIcon };
