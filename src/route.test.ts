import { describe, expect, it } from 'vitest';
import { canonicalHomeHash, getAppRoute, getReportListingId } from './route';

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

  it('maps the private Card Master console hash', () => {
    expect(getAppRoute('#/admin/cards')).toBe('admin-cards');
  });

  it('maps an exact canonical Listing report hash and returns its ID', () => {
    expect(getAppRoute('#/listing/listing_ABC-123/report')).toBe('listing-report');
    expect(getReportListingId('#/listing/listing_ABC-123/report')).toBe('listing_ABC-123');
  });

  it.each([
    '#/listing//report',
    '#/listing/listing%2Fchild/report',
    '#/listing/ listing-1/report',
    `#/listing/${'x'.repeat(201)}/report`,
    '#/listing/listing-1/report/extra',
  ])('rejects a noncanonical Listing report hash %s', (hash) => {
    expect(getReportListingId(hash)).toBeNull();
    expect(getAppRoute(hash)).toBe('marketplace');
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
