import type { ResolvedViews } from '@moonwitness/client';

export type BoardViewName = 'list' | 'kanban' | 'calendar' | 'graph' | 'pivot';

export type ActionResult =
  | { type: 'open_window'; model: string; recordId?: number }
  | { type: 'navigate'; path: string }
  | { type: 'reload' }
  | { type: 'notify'; message: string; severity?: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'download'; filename: string; content: string; contentType?: string };

export function availableViews(views: ResolvedViews): BoardViewName[] {
  return [
    'list',
    ...(views.kanban && views.permissions.write ? ['kanban' as const] : []),
    ...(views.calendar ? ['calendar' as const] : []),
    ...(views.graph ? ['graph' as const] : []),
    ...(views.pivot ? ['pivot' as const] : []),
  ];
}

export function parseViewName(value: string | null, views: ResolvedViews): BoardViewName {
  const selected = value as BoardViewName | null;
  return selected && availableViews(views).includes(selected) ? selected : 'list';
}

export function actionResultFrom(value: unknown): ActionResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  switch (candidate.type) {
    case 'open_window':
      return typeof candidate.model === 'string'
        ? {
            type: 'open_window',
            model: candidate.model,
            recordId:
              typeof candidate.recordId === 'number' && Number.isSafeInteger(candidate.recordId)
                ? candidate.recordId
                : undefined,
          }
        : null;
    case 'navigate':
      return typeof candidate.path === 'string' &&
        candidate.path.startsWith('/') &&
        !candidate.path.startsWith('//')
        ? { type: 'navigate', path: candidate.path }
        : null;
    case 'reload':
      return { type: 'reload' };
    case 'notify':
      return typeof candidate.message === 'string'
        ? {
            type: 'notify',
            message: candidate.message,
            severity:
              candidate.severity === 'success' ||
              candidate.severity === 'warning' ||
              candidate.severity === 'error'
                ? candidate.severity
                : 'info',
          }
        : null;
    case 'download':
      return typeof candidate.filename === 'string' && typeof candidate.content === 'string'
        ? {
            type: 'download',
            filename: candidate.filename,
            content: candidate.content,
            contentType:
              typeof candidate.contentType === 'string'
                ? candidate.contentType
                : 'text/csv;charset=utf-8',
          }
        : null;
    default:
      return null;
  }
}

export function downloadTextFile(
  filename: string,
  content: string,
  contentType = 'text/csv;charset=utf-8'
) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]/gu, '_');
  anchor.click();
  URL.revokeObjectURL(url);
}
