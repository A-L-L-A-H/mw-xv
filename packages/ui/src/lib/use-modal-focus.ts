'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(', ');

type ModalEntry = {
  container: HTMLElement;
  previouslyFocused: HTMLElement | null;
};

type ModalState = {
  entries: ModalEntry[];
};

type BodyLock = {
  count: number;
  overflow: string;
};

const modalStates = new WeakMap<Document, ModalState>();
const bodyLocks = new WeakMap<Document, BodyLock>();

function isAvailable(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled') || element.hasAttribute('hidden')) {
    return false;
  }
  if (
    element.hasAttribute('inert') ||
    element.getAttribute('aria-hidden') === 'true' ||
    (element instanceof HTMLInputElement && element.type === 'hidden')
  ) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute('hidden') ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(current);
    if (!style) return false;
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return element.getClientRects().length > 0;
}

function isTabbable(element: HTMLElement): boolean {
  if (!isAvailable(element) || element.tabIndex < 0) return false;
  if (
    element.matches('[contenteditable]:not([contenteditable="false"])') &&
    element.getAttribute('contenteditable') !== 'false'
  ) {
    return true;
  }
  return true;
}

function focusableItems(container: HTMLElement): HTMLElement[] {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isTabbable
  );
  const radios = items.filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && element.type === 'radio'
  );
  return items.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.checked) {
      return true;
    }
    if (!element.name) return true;
    const group = radios.filter(
      (candidate) => candidate.name === element.name && candidate.form === element.form
    );
    if (group.some((candidate) => candidate.checked)) return false;
    return group[0] === element;
  });
}

function focusElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  try {
    element.focus({ preventScroll: true });
    return element.ownerDocument.activeElement === element;
  } catch {
    return false;
  }
}

function lockBody(document: Document): void {
  const existing = bodyLocks.get(document);
  if (existing) {
    existing.count += 1;
    return;
  }
  bodyLocks.set(document, { count: 1, overflow: document.body.style.overflow });
  document.body.style.overflow = 'hidden';
}

function unlockBody(document: Document): void {
  const lock = bodyLocks.get(document);
  if (!lock) return;
  lock.count -= 1;
  if (lock.count > 0) return;
  document.body.style.overflow = lock.overflow;
  bodyLocks.delete(document);
}

function registerModal(document: Document, entry: ModalEntry): ModalState {
  let state = modalStates.get(document);
  if (!state) {
    state = { entries: [] };
    modalStates.set(document, state);
  }

  const ancestorIndex = state.entries.findIndex(
    (candidate) =>
      candidate.container !== entry.container && candidate.container.contains(entry.container)
  );
  if (ancestorIndex >= 0) {
    state.entries.splice(ancestorIndex + 1, 0, entry);
  } else {
    const descendantIndex = state.entries.findIndex((candidate) =>
      entry.container.contains(candidate.container)
    );
    state.entries.splice(descendantIndex < 0 ? state.entries.length : descendantIndex, 0, entry);
  }
  lockBody(document);
  return state;
}

/**
 * Keeps keyboard focus inside a custom modal surface and restores it on close.
 * Only the top modal handles keyboard dismissal; body scroll locks are shared.
 * Prefer the shared Dialog/Sheet primitives when a full overlay is not needed.
 */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(onDismiss?: () => void) {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const container = element;
    if (!container) return;

    const document = container.ownerDocument;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: ModalEntry = { container, previouslyFocused };
    const state = registerModal(document, entry);
    const initialTarget =
      container.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ??
      focusableItems(container)[0] ??
      container;
    focusElement(initialTarget);

    const onKeyDown = (event: KeyboardEvent) => {
      if (state.entries[state.entries.length - 1] !== entry) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusableItems(container);
      if (items.length === 0) {
        event.preventDefault();
        focusElement(container);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !(active instanceof Node) || !container.contains(active);
      if (event.shiftKey && (focusIsOutside || active === first || active === container)) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (focusIsOutside || active === last)) {
        event.preventDefault();
        focusElement(first);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = state.entries.indexOf(entry);
      if (index >= 0) state.entries.splice(index, 1);
      unlockBody(document);
      if (state.entries.length === 0) modalStates.delete(document);

      const active = document.activeElement;
      const activeWasInModal =
        active === document.body ||
        !active?.isConnected ||
        (active instanceof Node && container.contains(active));
      if (!activeWasInModal) return;

      const nextModal = state.entries[state.entries.length - 1];
      const restoreTarget =
        nextModal && previouslyFocused && nextModal.container.contains(previouslyFocused)
          ? previouslyFocused
          : previouslyFocused && isAvailable(previouslyFocused)
            ? previouslyFocused
            : nextModal
              ? (focusableItems(nextModal.container)[0] ?? nextModal.container)
              : null;
      focusElement(restoreTarget);
    };
  }, [element]);

  return ref;
}
