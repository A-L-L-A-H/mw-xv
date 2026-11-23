import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

interface DynamicOptions {
  ssr?: boolean;
  loading?: () => ReactNode;
}

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options?: DynamicOptions
): ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const mod = await loader();
    if (typeof mod === 'function') {
      return { default: mod };
    }
    return mod;
  });

  const Loading = options?.loading;

  return function DynamicWrapper(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
