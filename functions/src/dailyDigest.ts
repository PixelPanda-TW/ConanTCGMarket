import { Timestamp } from 'firebase-admin/firestore';
import type {
  GmailClient,
  ListingEvent,
  RecipientDirectory,
} from './domain.js';

const MARKETPLACE_BASE_URL = 'https://pixelpanda-tw.github.io/ConanTCGMarket';
const CHARACTER_QUERY_LIMIT = 30;
const EPOCH = new Date(0);
const DELIVERY_CLAIM_LEASE_MS = 15 * 60_000;
const INGESTION_SETTLE_MS = 5 * 60_000;

export const DEFAULT_DAILY_RECIPIENT_CAP = 100;

export const DAILY_DIGEST_SCHEDULE_OPTIONS = {
  schedule: '0 9 * * *',
  timeZone: 'Asia/Taipei',
} as const;

export interface NotificationSubscription {
  uid: string;
  characterKeys: string[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}

export interface DailyDigestSubscriptionStore {
  listEmailDailyEnabled(
    afterUid: string | null,
    limit: number,
  ): Promise<NotificationSubscription[]>;
}

export interface DailyDigestEventStore {
  findNewByCharacterKeys(
    characterKeys: string[],
    after: Date,
    through: Date,
  ): Promise<ListingEvent[]>;
}

export interface DailyDigestDeliveryState {
  claim(
    uid: string,
    claimId: string,
    claimedAt: Date,
    leaseUntil: Date,
    windowEnd: Date,
  ): Promise<DailyDigestClaim | null>;
  complete(uid: string, claimId: string): Promise<void>;
  release(uid: string, claimId: string): Promise<void>;
}

export interface DailyDigestClaim {
  claimId: string;
  after: Date;
  through: Date;
}

export interface DailyDigestDeliveryRecord {
  cursor?: Timestamp;
  claimId?: string;
  leaseUntil?: Timestamp;
  windowEnd?: Timestamp;
}

export interface DailyDigestBatchState {
  getCursor(): Promise<string | null>;
  advance(cursor: string | null): Promise<void>;
}

export interface DailyDigestDependencies {
  subscriptions: DailyDigestSubscriptionStore;
  events: DailyDigestEventStore;
  deliveryState: DailyDigestDeliveryState;
  batchState: DailyDigestBatchState;
  recipients: RecipientDirectory;
  gmail: GmailClient;
  recipientCap: number;
  createClaimId(): string;
}

export function reserveDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
  claimedAt: Date,
  leaseUntil: Date,
  windowEnd: Date,
): DailyDigestDeliveryRecord | null {
  if (current.claimId && current.leaseUntil && current.leaseUntil.toDate() > claimedAt) {
    return null;
  }

  return {
    ...current,
    claimId,
    leaseUntil: Timestamp.fromDate(leaseUntil),
    windowEnd: Timestamp.fromDate(windowEnd),
  };
}

export function completeDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId || !current.windowEnd) {
    return null;
  }

  return { cursor: current.windowEnd };
}

export function releaseDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId) {
    return null;
  }

  return current.cursor ? { cursor: current.cursor } : {};
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function listingUrl(listingId: string): string {
  return `${MARKETPLACE_BASE_URL}/#/listing/${encodeURIComponent(listingId)}`;
}

function buildGroups(events: ListingEvent[]) {
  const groups = new Map<string, ListingEvent[]>();

  for (const event of events) {
    const listings = groups.get(event.characterName) ?? [];
    listings.push(event);
    groups.set(event.characterName, listings);
  }

  return Array.from(groups, ([characterName, listings]) => ({ characterName, listings }));
}

function buildText(groups: ReturnType<typeof buildGroups>): string {
  const lines = ['柯南 TCG 新上架摘要', ''];

  for (const group of groups) {
    lines.push(`角色：${group.characterName}`);
    for (const listing of group.listings) {
      lines.push(
        `- 價格：NT$ ${listing.listingPrice}`,
        `  稀有度：${listing.rarity}`,
        `  卡片 ID：${listing.cardId}`,
        `  剩餘數量：${listing.remainingQuantity}`,
        `  查看商品：${listingUrl(listing.listingId)}`,
      );
    }
    lines.push('');
  }

  lines.push(`通知設定：${MARKETPLACE_BASE_URL}/#/notifications`);
  return lines.join('\n');
}

function buildHtml(groups: ReturnType<typeof buildGroups>): string {
  const sections = groups.map((group) => {
    const listings = group.listings.map((listing) => `
      <li>
        <div>價格：NT$ ${listing.listingPrice}</div>
        <div>稀有度：${escapeHtml(listing.rarity)}</div>
        <div>卡片 ID：${escapeHtml(listing.cardId)}</div>
        <div>剩餘數量：${listing.remainingQuantity}</div>
        <a href="${escapeHtml(listingUrl(listing.listingId))}">查看商品</a>
      </li>`).join('');

    return `<section><h2>${escapeHtml(group.characterName)}</h2><ul>${listings}</ul></section>`;
  }).join('');

  return `<!doctype html><html><body><h1>柯南 TCG 新上架摘要</h1>${sections}<p><a href="${MARKETPLACE_BASE_URL}/#/notifications">通知設定</a></p></body></html>`;
}

export async function runDailyDigest(
  now: Date,
  deps: DailyDigestDependencies,
): Promise<void> {
  const recipientCap = Math.max(0, Math.floor(deps.recipientCap));
  if (recipientCap === 0) {
    return;
  }

  const pageSize = recipientCap;
  let scanCursor = await deps.batchState.getCursor();
  let attemptedRecipients = 0;

  while (attemptedRecipients < recipientCap) {
    const subscriptions = await deps.subscriptions.listEmailDailyEnabled(scanCursor, pageSize);
    if (subscriptions.length === 0) {
      await deps.batchState.advance(null);
      return;
    }

    for (const subscription of subscriptions) {
      if (!subscription.emailDailyEnabled || subscription.characterKeys.length === 0) {
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        continue;
      }

      const recipient = await deps.recipients.getVerifiedEmail(subscription.uid);
      if (!recipient) {
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        continue;
      }

      const claimId = deps.createClaimId();
      const windowEnd = new Date(now.getTime() - INGESTION_SETTLE_MS);
      const claim = await deps.deliveryState.claim(
        subscription.uid,
        claimId,
        now,
        new Date(now.getTime() + DELIVERY_CLAIM_LEASE_MS),
        windowEnd,
      );
      if (!claim) {
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        continue;
      }

      const eventsByListingId = new Map<string, ListingEvent>();

      for (const characterKeys of chunks(subscription.characterKeys, CHARACTER_QUERY_LIMIT)) {
        const events = await deps.events.findNewByCharacterKeys(
          characterKeys,
          claim.after ?? EPOCH,
          claim.through,
        );
        for (const event of events) {
          eventsByListingId.set(event.listingId, event);
        }
      }

      const events = Array.from(eventsByListingId.values()).sort((left, right) => (
        left.createdAt.toMillis() - right.createdAt.toMillis()
          || left.listingId.localeCompare(right.listingId)
      ));
      if (events.length === 0) {
        await deps.deliveryState.release(subscription.uid, claimId);
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        continue;
      }

      const groups = buildGroups(events);
      attemptedRecipients += 1;
      try {
        await deps.gmail.sendDigest({
          to: recipient,
          subject: '柯南 TCG 新上架摘要',
          groups,
          text: buildText(groups),
          html: buildHtml(groups),
        });
      } catch {
        await deps.deliveryState.release(subscription.uid, claimId);
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        if (attemptedRecipients >= recipientCap) return;
        continue;
      }

      await deps.deliveryState.complete(subscription.uid, claimId);
      scanCursor = subscription.uid;
      await deps.batchState.advance(scanCursor);
      if (attemptedRecipients >= recipientCap) return;
    }

    if (subscriptions.length < pageSize) {
      await deps.batchState.advance(null);
      return;
    }
  }
}
