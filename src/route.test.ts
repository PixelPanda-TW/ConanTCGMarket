import { describe, expect, it } from 'vitest';
import { getAppRoute } from './route';

describe('app routes', () => {
  it('maps the profile hash to the profile route', () => {
    expect(getAppRoute('#/profile')).toBe('profile');
  });

  it('maps the cards hash to the card master route', () => {
    expect(getAppRoute('#/cards')).toBe('cards');
  });

  it('keeps unknown and empty hashes on the marketplace route', () => {
    expect(getAppRoute('')).toBe('marketplace');
    expect(getAppRoute('#/unknown')).toBe('marketplace');
  });
});
