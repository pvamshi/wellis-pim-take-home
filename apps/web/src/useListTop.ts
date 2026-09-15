import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Where a page-scrolled list starts in the document, for
 * `useWindowVirtualizer`'s `scrollMargin`.
 *
 * Lists scroll with the page rather than inside a fixed-height box, so they
 * use the whole window. Re-measured after every render, because what sits
 * above a list (an alert, a filter row) changes height.
 */
export function useListTop<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const next = Math.round(element.getBoundingClientRect().top + window.scrollY);
    if (next !== top) setTop(next);
  });

  return { ref, top };
}
