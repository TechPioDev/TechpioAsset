/**
 * The arithmetic behind the full-size photo viewer (v2.63): which page a
 * horizontal scroll has landed on, and where the arrows go next. Nothing here
 * touches React Native, so it runs under vitest.
 */

/**
 * The page a horizontal paging list is showing, from its scroll offset.
 * Rounded, so a swipe counts once it is past half way, and clamped, because
 * an overscroll bounce reports offsets outside the list.
 */
export function pageFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (count <= 0 || pageWidth <= 0 || !Number.isFinite(offsetX)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / pageWidth)));
}

/**
 * Where an arrow lands. It wraps at both ends, as the web viewer's arrows do:
 * comparing a handover shot against the return shot means going round the set
 * more than once.
 */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** "3 / 7" - nothing for a single picture, where a counter is noise. */
export function viewerCounter(index: number, count: number): string | null {
  return count > 1 ? `${index + 1} / ${count}` : null;
}

/**
 * The small line under the title: which picture this is, when it was taken
 * and by whom. A catalogue picture has neither a date nor an author, and an
 * empty date must not render as "Invalid Date".
 */
export function viewerMetaLine(
  photo: { stageLabel: string; takenAt: string; by: string | null },
  formatDate: (iso: string) => string,
): string {
  return [photo.stageLabel, photo.takenAt ? formatDate(photo.takenAt) : null, photo.by]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
