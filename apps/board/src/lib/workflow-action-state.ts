export function workflowActionState({
  isActive,
  configuredTransitionCount,
  allowedTransitionCount,
}: {
  isActive: boolean;
  configuredTransitionCount: number;
  allowedTransitionCount: number;
}) {
  if (!isActive) return 'not_applicable';
  if (configuredTransitionCount === 0) return 'unconfigured';
  if (allowedTransitionCount === 0) return 'permission_denied';
  return 'available';
}
