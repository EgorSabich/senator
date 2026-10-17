/**
 * Owner, 2026-10-18: a list that opens or closes must stay where it is.
 * When a fold header (anything with aria-expanded) is tapped, the header is held at the same place on the screen while
 * the content below animates — the page never jumps, also when a long section closes above the visible part.
 */
const HOLD_MS = 600;

function scrollerOf(el: Element): { by: (dy: number) => void } {
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const oy = getComputedStyle(p).overflowY;
    if (
      (oy === "auto" || oy === "scroll") &&
      p.scrollHeight > p.clientHeight + 1
    )
      return { by: (dy) => p.scrollBy(0, dy) };
  }
  return { by: (dy) => window.scrollBy(0, dy) };
}

export function installFoldAnchor() {
  document.addEventListener(
    "click",
    (e) => {
      const head = (e.target as Element | null)?.closest?.("[aria-expanded]");
      if (!head || head.hasAttribute("aria-haspopup")) return;
      const top0 = head.getBoundingClientRect().top;
      // a header that is already off the screen is brought back into view, not held off it
      const target = Math.max(8, Math.min(top0, window.innerHeight - 80));
      const scroller = scrollerOf(head);
      const until = performance.now() + HOLD_MS;
      const step = () => {
        if (!head.isConnected) return;
        const d = head.getBoundingClientRect().top - target;
        if (Math.abs(d) > 0.5) scroller.by(d);
        if (performance.now() < until) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    true,
  );
}
