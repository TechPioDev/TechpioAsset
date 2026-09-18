import { describe, expect, it } from 'vitest';
import { pageFromOffset, stepIndex, viewerCounter, viewerMetaLine } from './photo-viewer';

describe('the full-size photo viewer', () => {
  it('reads the page from the scroll offset, past half way counts', () => {
    expect(pageFromOffset(0, 400, 5)).toBe(0);
    expect(pageFromOffset(199, 400, 5)).toBe(0);
    expect(pageFromOffset(201, 400, 5)).toBe(1);
    expect(pageFromOffset(1600, 400, 5)).toBe(4);
  });

  it('clamps an overscroll bounce and survives a list with no width yet', () => {
    expect(pageFromOffset(-80, 400, 5)).toBe(0);
    expect(pageFromOffset(2400, 400, 5)).toBe(4);
    expect(pageFromOffset(800, 0, 5)).toBe(0);
    expect(pageFromOffset(Number.NaN, 400, 5)).toBe(0);
    expect(pageFromOffset(800, 400, 0)).toBe(0);
  });

  it('steps with the arrows and wraps at both ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });

  it('counts only when there is more than one picture', () => {
    expect(viewerCounter(2, 7)).toBe('3 / 7');
    expect(viewerCounter(0, 1)).toBeNull();
  });

  it('leaves the date and author out of a catalogue picture', () => {
    const fmt = (iso: string) => `on ${iso.slice(0, 10)}`;
    expect(
      viewerMetaLine({ stageLabel: 'At handover · Rohit', takenAt: '2026-08-13T10:00:00Z', by: 'Harry Singh' }, fmt),
    ).toBe('At handover · Rohit · on 2026-08-13 · Harry Singh');
    expect(viewerMetaLine({ stageLabel: 'Catalogue picture', takenAt: '', by: null }, fmt)).toBe('Catalogue picture');
  });
});
