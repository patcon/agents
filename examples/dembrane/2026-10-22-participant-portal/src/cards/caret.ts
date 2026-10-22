// Where a press lands in a dictated text field's draft, so the textarea that
// takes over from the display can put its caret in the same place.

/** A caret position, as the browser reports it for a point on the page. */
export type CaretHit = { node: Node; offset: number };

export function caretHitAt(x: number, y: number): CaretHit | null {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  // Older Safari has only the non-standard caretRangeFromPoint.
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * The character offset in the textarea for a caret hit in the display. The
 * display holds the draft as its first child, a single text node, and the
 * interim text as another, which the textarea shows from `interimStart`. A
 * press anywhere else after the draft, like below the text, goes to the end
 * of the draft.
 */
export function draftOffset(
  hit: CaretHit | null,
  {
    display,
    draft,
    length,
    interim = null,
    interimStart = length
  }: {
    display: Node;
    draft: Node | null;
    length: number;
    interim?: Node | null;
    interimStart?: number;
  }
): number {
  if (hit?.node === draft) return Math.min(hit.offset, length);
  if (hit?.node === interim) return interimStart + hit.offset;
  // On the display itself, the offset counts children: 0 is before the draft.
  if (hit?.node === display && hit.offset === 0) return 0;
  return length;
}
