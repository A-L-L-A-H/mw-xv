// CI runs a single job, so there is no other job to delegate these contracts to:
// the unit runner owns them on every machine, local and hosted alike.
export const unitRunnerChecks = [
  { name: 'Board production bundle budget', args: ['run', 'board:budget'] },
  { name: 'Shared UI boundary checks', args: ['run', 'ui:check'] },
  { name: 'API addon boundary check', args: ['run', 'api:addon:check'] },
  { name: 'Addon agent boundary check', args: ['run', 'agent:boundary:check'] },
  { name: 'Architecture boundary check', args: ['run', 'architecture:check'] },
  { name: 'Package standard check', args: ['run', 'standard:check'] },
];
