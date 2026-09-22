import { describe, expect, it } from 'vitest';
import { WHATS_NEW, notesToShow } from './whats-new';
import appJson from '../../app.json';

describe('what is new after an update', () => {
  it('shows every release since the one last seen, newest first', () => {
    expect(notesToShow('0.3.36', '0.3.34').map((r) => r.version)).toEqual(['0.3.36', '0.3.35']);
  });

  it('shows nothing once seen, or on a downgrade', () => {
    expect(notesToShow('0.3.36', '0.3.36')).toEqual([]);
    expect(notesToShow('0.3.35', '0.3.36')).toEqual([]);
  });

  it('shows just the current release to a phone that has never seen this screen', () => {
    expect(notesToShow('0.3.36', null).map((r) => r.version)).toEqual(['0.3.36']);
  });

  it('shows nothing for a release with no notes', () => {
    expect(notesToShow('0.3.37', '0.3.36')).toEqual([]);
  });

  it('never more than three releases at once', () => {
    expect(notesToShow('0.3.36', '0.1.0').length).toBeLessThanOrEqual(3);
  });

  it('has notes for the version this build is', () => {
    expect(WHATS_NEW[0]!.version).toBe(appJson.expo.version);
  });
});
