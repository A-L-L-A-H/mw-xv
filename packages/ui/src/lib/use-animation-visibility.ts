import { useCallback, useEffect, useState, type Ref } from 'react';

/** Pause decorative and pending-state CSS animations while their element is offscreen. */
export function useAnimationVisibility<T extends Element>(externalRef?: Ref<T>) {
  const [element, setElement] = useState<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const ref = useCallback(
    (node: T | null) => {
      setElement(node);
      if (typeof externalRef === 'function') externalRef(node);
      else if (externalRef) externalRef.current = node;
    },
    [externalRef]
  );

  useEffect(() => {
    if (!element) {
      setIsVisible(false);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) =>
        setIsVisible(Boolean(entry && entry.isIntersecting && entry.intersectionRatio > 0)),
      { threshold: 0 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return {
    ref,
    isVisible,
    visibilityClass: isVisible ? 'mw-ui-motion-visible' : 'mw-ui-motion-paused',
  };
}
