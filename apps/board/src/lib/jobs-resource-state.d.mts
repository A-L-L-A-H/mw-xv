export declare function jobsResourceState(state: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  isEmpty?: boolean;
}): 'error' | 'loading' | 'unavailable' | 'empty' | 'ready';
