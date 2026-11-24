import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { getBadgeAsset, type GameAssetSlug } from '../lib/asset-registry.js';
import { cn } from '../lib/cn.js';

export type QuestStatus = 'locked' | 'active' | 'completed';

export type QuestCardProps = Omit<ComponentPropsWithoutRef<'article'>, 'children' | 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  completedSteps: number;
  totalSteps: number;
  status?: QuestStatus;
  rewardLabel?: ReactNode;
  badgeId?: GameAssetSlug;
  basePath?: string;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
};

const STATUS_LABELS: Record<QuestStatus, string> = {
  locked: 'Locked',
  active: 'Active',
  completed: 'Completed',
};

function clampStepProgress(completed: number, total: number) {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 1;
  const safeCompleted = Number.isFinite(completed)
    ? Math.min(safeTotal, Math.max(0, Math.trunc(completed)))
    : 0;
  return { safeCompleted, safeTotal, percent: Math.round((safeCompleted / safeTotal) * 100) };
}

function StepBar({
  wrapClass,
  fillClass,
  label,
  completed,
  total,
  percent,
  text,
}: {
  wrapClass: string;
  fillClass: string;
  label: string;
  completed: number;
  total: number;
  percent: number;
  text: string;
}) {
  return (
    <div
      className={wrapClass}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-valuetext={text}
    >
      <span className={fillClass} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Quest progression card with non-color status text, step progressbar, and optional reward badge. */
export const QuestCard = forwardRef<HTMLElement, QuestCardProps>(function QuestCard(
  {
    title,
    description,
    completedSteps,
    totalSteps,
    status = 'active',
    rewardLabel,
    badgeId,
    basePath = '',
    action,
    headingLevel = 3,
    className,
    ...props
  },
  ref
) {
  const Heading = `h${headingLevel}` as const;
  const { safeCompleted, safeTotal, percent } = clampStepProgress(completedSteps, totalSteps);

  return (
    <article
      ref={ref}
      className={cn('mw-ui-comic-panel', 'mw-ui-panel', 'mw-ui-quest-card', className)}
      data-status={status}
      {...props}
    >
      <header className="mw-ui-panel-header mw-ui-comic-panel-header mw-ui-quest-card-header">
        <div className="mw-ui-comic-panel-meta mw-ui-quest-card-heading">
          {badgeId ? (
            <img
              src={getBadgeAsset(badgeId, { basePath }).src}
              alt=""
              aria-hidden="true"
              className="mw-ui-quest-card-badge-img"
              decoding="async"
            />
          ) : null}
          <div>
            <Heading className="mw-ui-panel-title mw-ui-comic-panel-title mw-ui-quest-card-title">
              {title}
            </Heading>
            {description ? <p className="mw-ui-quest-card-desc">{description}</p> : null}
          </div>
        </div>
        <span className="mw-ui-comic-panel-kicker mw-ui-quest-card-status">{STATUS_LABELS[status]}</span>
      </header>
      <StepBar
        wrapClass="mw-ui-quest-card-progress"
        fillClass="mw-ui-quest-card-fill"
        label="Quest step progress"
        completed={safeCompleted}
        total={safeTotal}
        percent={percent}
        text={`${safeCompleted} of ${safeTotal} steps (${percent}%)`}
      />
      <footer className="mw-ui-comic-panel-header mw-ui-quest-card-footer">
        <span className="mw-ui-comic-panel-kicker mw-ui-quest-card-steps">
          {safeCompleted}/{safeTotal} steps ({percent}%)
        </span>
        {rewardLabel ? <span className="mw-ui-comic-panel-kicker mw-ui-quest-card-reward">{rewardLabel}</span> : null}
        {action ? <div className="mw-ui-quest-card-action">{action}</div> : null}
      </footer>
    </article>
  );
});

export type AchievementBadgeProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'title'> & {
  badgeId: GameAssetSlug;
  title: ReactNode;
  unlocked?: boolean;
  rank?: string;
  basePath?: string;
};

/** Achievement badge item displaying canonical game artwork alongside explicit lock state text. */
export const AchievementBadge = forwardRef<HTMLDivElement, AchievementBadgeProps>(
  function AchievementBadge({ badgeId, title, unlocked = false, rank, basePath = '', className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('mw-ui-achievement-badge', className)}
        data-badge={badgeId}
        data-unlocked={unlocked ? 'true' : 'false'}
        {...props}
      >
        <img
          src={getBadgeAsset(badgeId, { basePath }).src}
          alt=""
          aria-hidden="true"
          className="mw-ui-achievement-badge-icon"
          decoding="async"
        />
        <div className="mw-ui-achievement-badge-meta">
          <span className="mw-ui-achievement-badge-title">{title}</span>
          <span className="mw-ui-achievement-badge-state">
            {rank ? `${rank} · ` : ''}
            {unlocked ? 'Unlocked' : 'Locked'}
          </span>
        </div>
      </div>
    );
  }
);

export interface RewardBadgeEntry {
  readonly badgeId: GameAssetSlug;
  readonly title: ReactNode;
  readonly unlocked?: boolean;
  readonly rank?: string;
}

export type RewardPanelProps = Omit<ComponentPropsWithoutRef<'section'>, 'children' | 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  completedCount: number;
  totalCount: number;
  unlockedCount?: number;
  badges?: readonly RewardBadgeEntry[];
  basePath?: string;
  headingLevel?: 2 | 3 | 4;
};

/** Summarizes verified completion progress and unlocked achievement badges. */
export const RewardPanel = forwardRef<HTMLElement, RewardPanelProps>(function RewardPanel(
  {
    title = 'Mission Progress',
    description,
    completedCount,
    totalCount,
    unlockedCount,
    badges = [],
    basePath = '',
    headingLevel = 2,
    className,
    ...props
  },
  ref
) {
  const Heading = `h${headingLevel}` as const;
  const { safeCompleted, safeTotal, percent } = clampStepProgress(completedCount, totalCount);
  const resolvedUnlocked = unlockedCount ?? badges.filter((entry) => Boolean(entry.unlocked)).length;

  return (
    <section
      ref={ref}
      className={cn('mw-ui-comic-panel', 'mw-ui-panel', 'mw-ui-reward-panel', className)}
      {...props}
    >
      <header className="mw-ui-panel-header mw-ui-comic-panel-header mw-ui-reward-panel-header">
        <div>
          <Heading className="mw-ui-panel-title mw-ui-comic-panel-title mw-ui-reward-panel-title">
            {title}
          </Heading>
          {description ? <p className="mw-ui-reward-panel-desc">{description}</p> : null}
        </div>
        <span className="mw-ui-comic-panel-kicker mw-ui-reward-panel-summary">
          {safeCompleted}/{safeTotal} complete · {resolvedUnlocked} unlocked
        </span>
      </header>
      <StepBar
        wrapClass="mw-ui-reward-panel-bar"
        fillClass="mw-ui-reward-panel-fill"
        label="Overall progression"
        completed={safeCompleted}
        total={safeTotal}
        percent={percent}
        text={`${safeCompleted} of ${safeTotal} completed (${percent}%)`}
      />
      {badges.length > 0 ? (
        <div className="mw-ui-reward-panel-badges">
          {badges.map((badge) => (
            <AchievementBadge key={badge.badgeId} {...badge} basePath={basePath} />
          ))}
        </div>
      ) : null}
    </section>
  );
});
