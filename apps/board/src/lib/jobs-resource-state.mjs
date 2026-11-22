export function jobsResourceState({ isLoading, isError, hasData, isEmpty = false }) {
  if (isError) return 'error';
  if (isLoading) return 'loading';
  if (!hasData) return 'unavailable';
  if (isEmpty) return 'empty';
  return 'ready';
}
