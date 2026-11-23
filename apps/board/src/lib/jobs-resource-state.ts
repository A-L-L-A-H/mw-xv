export function jobsResourceState({
  isLoading,
  isError,
  hasData,
  isEmpty = false,
}: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  isEmpty?: boolean;
}) {
  if (isError) return 'error';
  if (isLoading) return 'loading';
  if (!hasData) return 'unavailable';
  if (isEmpty) return 'empty';
  return 'ready';
}
