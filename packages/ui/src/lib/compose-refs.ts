import type { ForwardedRef, MutableRefObject, Ref } from 'react';

type AnyRef<T> = Ref<T> | ForwardedRef<T> | undefined;

/** Assign a value to a callback, object, or forwarded ref. */
export function setRef<T>(ref: AnyRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

/** Combine an external ref with an internal or child ref without losing either. */
export function composeRefs<T>(...refs: AnyRef<T>[]) {
  return (value: T | null): void => {
    for (const ref of refs) setRef(ref, value);
  };
}
