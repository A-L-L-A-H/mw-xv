export function modelViewErrorState(error) {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : Number.NaN;

  if (status === 403) {
    return {
      title: 'Access denied',
      description: 'Your account does not have permission to view this model.',
    };
  }
  if (status === 404) {
    return {
      title: 'Model unavailable',
      description: 'This model is not available in the current workspace.',
    };
  }
  return {
    title: 'Failed to load model views',
    description: 'The model view could not be loaded. Check your connection and try again.',
  };
}
