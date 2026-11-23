export declare function workflowActionState(state: {
  isActive: boolean;
  configuredTransitionCount: number;
  allowedTransitionCount: number;
}): 'not_applicable' | 'unconfigured' | 'permission_denied' | 'available';
