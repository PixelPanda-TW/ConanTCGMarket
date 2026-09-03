import { describe, expect, it } from 'vitest';
import { canonicalHomeHash, getAppRoute } from './route';

describe('app routes', () => {
  it('maps the profile hash to the profile route', () => {
    expect(getAppRoute('#/profile')).toBe('profile');
  });

  it('canonicalizes the retired cards hash to the marketplace home', () => {
    expect(canonicalHomeHash('#/cards')).toBe('#');
    expect(getAppRoute(canonicalHomeHash('#/cards'))).toBe('marketplace');
  });

  it('maps the sell hash to the sell route', () => {
    expect(getAppRoute('#/sell')).toBe('sell');
  });

  it('maps the notifications hash to the notification settings route', () => {
    expect(getAppRoute('#/notifications')).toBe('notifications');
  });

  it('keeps unknown and empty hashes on the marketplace route', () => {
    expect(getAppRoute('')).toBe('marketplace');
    expect(getAppRoute('#/unknown')).toBe('marketplace');
  });

  it('canonicalizes the legacy home hash without a slash', () => {
    expect(canonicalHomeHash('#/')).toBe('#');
    expect(canonicalHomeHash('#/sell')).toBe('#/sell');
  });
});
