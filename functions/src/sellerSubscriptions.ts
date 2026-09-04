import { Timestamp } from 'firebase-admin/firestore';
import type { ListingEvent } from './domain.js';

const MAX_SELLER_SUBSCRIPTIONS = 100;
const MAX_SELLER_ID_LENGTH = 128;

export interface StoredSellerSubscription {
  sellerId: string;
  followedAt: Timestamp;
}

function hasExactFields(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('sellerId') && keys.includes('followedAt');
}

export function readSellerSubscriptions(value: unknown): StoredSellerSubscription[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELLER_SUBSCRIPTIONS) return null;

  const result: StoredSellerSubscription[] = [];
  let previousSellerId: string | null = null;
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (!hasExactFields(entry)
      || typeof entry.sellerId !== 'string'
      || entry.sellerId.length === 0
      || entry.sellerId.length > MAX_SELLER_ID_LENGTH
      || entry.sellerId !== entry.sellerId.trim()
      || !(entry.followedAt instanceof Timestamp)
      || (previousSellerId !== null && previousSellerId >= entry.sellerId)) {
      return null;
    }

    result.push({ sellerId: entry.sellerId, followedAt: entry.followedAt });
    previousSellerId = entry.sellerId;
  }
  return result;
}

export function matchesSubscribedSeller(
  subscriptions: readonly StoredSellerSubscription[],
  event: ListingEvent,
): boolean {
  if (!event.sellerId) return false;
  return subscriptions.some((subscription) => (
    subscription.sellerId === event.sellerId
      && event.capturedAt.toMillis() >= subscription.followedAt.toMillis()
  ));
}
