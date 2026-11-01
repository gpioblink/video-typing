function activeElementFor(element: HTMLElement) {
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.activeElement : element.ownerDocument.activeElement;
}

/** Retain focus across keyed cue replacements, only if typing owned it.
 * A ref detaches before React removes the old input surface, while its active
 * element can still be identified. Work in both the demo and extension shadow.
 */
export function createTypingFocusRef(autoFocus = false) {
  let previous: HTMLDivElement | null = null;
  let restore = autoFocus;
  return (element: HTMLDivElement | null) => {
    if (!element) {
      restore = Boolean(previous?.contains(activeElementFor(previous)));
      previous = null;
      return;
    }

    previous = element;
    if (!restore) return;
    restore = false;
    const active = activeElementFor(element);
    const doc = element.ownerDocument;
    // Never steal focus from Config, a dictionary choice or the native player.
    if (!active || active === doc.body || active === doc.documentElement) {
      element.focus({ preventScroll: true });
    }
  };
}
