import { Timestamp } from 'firebase-admin/firestore';
import type {
  GmailClient,
  ListingEvent,
  RecipientDirectory,
} from './domain.js';

const MARKETPLACE_BASE_URL = 'https://pixelpanda-tw.github.io/ConanTCGMarket';
const CHARACTER_QUERY_LIMIT = 30;

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
    afterSequence: number,
    throughSequence: number,
  ): Promise<ListingEvent[]>;
}

export interface DailyDigestDeliveryState {
  claim(
    uid: string,
    claimId: string,
    reservedAt: Date,
    windowEndSequence: number,
  ): Promise<DailyDigestClaim | null>;
  beginSend(uid: string, claimId: string): Promise<boolean>;
  complete(uid: string, claimId: string): Promise<void>;
  release(uid: string, claimId: string): Promise<void>;
  recover(
    uid: string,
    claimId: string,
    mode: DailyDigestRecoveryMode,
  ): Promise<boolean>;
}

export interface DailyDigestClaim {
  claimId: string;
  afterSequence: number;
  throughSequence: number;
}

export interface DailyDigestDeliveryRecord {
  cursorSequence?: number;
  claimId?: string;
  claimState?: DailyDigestClaimState;
  reservedAt?: Timestamp;
  windowEndSequence?: number;
}

export type DailyDigestRecoveryMode = 'definitely-unsent' | 'sent-or-ambiguous';
export type DailyDigestClaimState = 'reserved' | 'sending';

export interface DailyDigestBatchState {
  getCursor(): Promise<string | null>;
  advance(cursor: string | null): Promise<void>;
}

export interface DailyDigestIngestionWatermarks {
  create(): Promise<number>;
}

export interface DailyDigestDependencies {
  subscriptions: DailyDigestSubscriptionStore;
  events: DailyDigestEventStore;
  deliveryState: DailyDigestDeliveryState;
  batchState: DailyDigestBatchState;
  ingestionWatermarks: DailyDigestIngestionWatermarks;
  recipients: RecipientDirectory;
  gmail: GmailClient;
  recipientCap: number;
  createClaimId(): string;
}

export function reserveDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
  reservedAt: Date,
  windowEndSequence: number,
): DailyDigestDeliveryRecord | null {
  if (current.claimId) {
    return null;
  }

  return {
    ...current,
    claimId,
    claimState: 'reserved',
    reservedAt: Timestamp.fromDate(reservedAt),
    windowEndSequence,
  };
}

export function beginDailyDigestSend(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId || current.claimState !== 'reserved') {
    return null;
  }

  return { ...current, claimState: 'sending' };
}

export function completeDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (
    current.claimId !== claimId
      || current.claimState !== 'sending'
      || current.windowEndSequence === undefined
  ) {
    return null;
  }

  return { cursorSequence: current.windowEndSequence };
}

export function releaseDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId || current.claimState !== 'reserved') {
    return null;
  }

  return current.cursorSequence === undefined
    ? {}
    : { cursorSequence: current.cursorSequence };
}

export function recoverDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
  mode: DailyDigestRecoveryMode,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId) {
    return null;
  }

  if (mode === 'sent-or-ambiguous') {
    if (current.windowEndSequence === undefined) {
      return null;
    }
    return { cursorSequence: current.windowEndSequence };
  }

  if (mode === 'definitely-unsent') {
    if (current.claimState !== 'reserved') {
      return null;
    }
    return current.cursorSequence === undefined
      ? {}
      : { cursorSequence: current.cursorSequence };
  }

  return null;
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
  const windowEnd = await deps.ingestionWatermarks.create();
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
      const claim = await deps.deliveryState.claim(
        subscription.uid,
        claimId,
        now,
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
          claim.afterSequence,
          claim.throughSequence,
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
      const message = {
        to: recipient,
        subject: '柯南 TCG 新上架摘要',
        groups,
        text: buildText(groups),
        html: buildHtml(groups),
      };
      const maySend = await deps.deliveryState.beginSend(subscription.uid, claimId);
      if (!maySend) {
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
        continue;
      }

      attemptedRecipients += 1;
      try {
        await deps.gmail.sendDigest(message);
      } catch {
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
