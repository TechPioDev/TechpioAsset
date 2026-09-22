import { describe, expect, it } from 'vitest';
import { PUSH_CATEGORY_BUTTONS, pushActionRoute, pushFallbackRoute } from './push-actions';

describe('notification buttons', () => {
  it('approve and reject open the request with the action ready', () => {
    expect(pushActionRoute('approve', { requestId: 'req_1' })).toBe(
      '/request/req_1?action=approve',
    );
    expect(pushActionRoute('reject', { requestId: 'req_1' })).toBe('/request/req_1?action=reject');
  });

  it('confirm receipt opens the asset with the confirmation ready', () => {
    expect(pushActionRoute('confirm-receipt', { assetId: 'ast_9' })).toBe(
      '/asset/ast_9?action=confirm-receipt',
    );
  });

  it('a tap on the notification itself, or an unknown button, is not an action', () => {
    expect(
      pushActionRoute('expo.modules.notifications.actions.DEFAULT', { requestId: 'r' }),
    ).toBeNull();
    expect(pushActionRoute('delete-everything', { requestId: 'r' })).toBeNull();
    expect(pushActionRoute(null, { requestId: 'r' })).toBeNull();
  });

  it('never follows an id that is not an id', () => {
    expect(pushActionRoute('approve', { requestId: '../settings' })).toBeNull();
    expect(pushActionRoute('approve', { requestId: 42 })).toBeNull();
    expect(pushActionRoute('confirm-receipt', {})).toBeNull();
    expect(pushActionRoute('approve', null)).toBeNull();
  });

  it('falls back to the asset, then the request, when the web link has no phone screen', () => {
    expect(pushFallbackRoute({ assetId: 'a1', requestId: 'r1' })).toBe('/asset/a1');
    expect(pushFallbackRoute({ requestId: 'r1' })).toBe('/request/r1');
    expect(pushFallbackRoute({ linkPath: '/my-assets' })).toBeNull();
  });

  it('every button a category shows is one the router handles', () => {
    for (const buttons of Object.values(PUSH_CATEGORY_BUTTONS)) {
      for (const b of buttons) {
        expect(pushActionRoute(b.identifier, { requestId: 'x', assetId: 'y' })).not.toBeNull();
      }
    }
  });
});
