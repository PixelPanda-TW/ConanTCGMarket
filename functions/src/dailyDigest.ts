import { Timestamp } from 'firebase-admin/firestore';
import type {
  GmailClient,
  ListingEvent,
  ListingEventPage,
  RecipientDirectory,
} from './domain.js';
import {
  matchesSubscribedCardName,
  readSubscriptionCardNames,
} from './cardNameSubscriptions.js';

const MARKETPLACE_BASE_URL = 'https://pixelpanda-tw.github.io/ConanTCGMarket';
const DAILY_EVENT_PAGE_SIZE = 250;
const DAILY_DIGEST_TIME_ZONE = 'Asia/Taipei';
const DAILY_DIGEST_RESERVED_LEASE_MS = 15 * 60_000;

export const DEFAULT_DAILY_RECIPIENT_CAP = 100;

export const DAILY_DIGEST_SCHEDULE_OPTIONS = {
  schedule: '0 9 * * *',
  timeZone: DAILY_DIGEST_TIME_ZONE,
} as const;

export interface NotificationSubscription {
  uid: string;
  cardNames: string[];
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
  findNewInSequenceRange(
    afterSequence: number,
    throughSequence: number,
    limit: number,
  ): Promise<ListingEventPage>;
}

export interface DailyDigestDeliveryState {
  claim(
    uid: string,
    claimId: string,
    reservedAt: Date,
    windowEndSequence: number,
    runDate: string,
  ): Promise<DailyDigestClaim | null>;
  beginSend(uid: string, claimId: string): Promise<boolean>;
  complete(uid: string, claimId: string): Promise<void>;
  completeWithoutSend(uid: string, claimId: string): Promise<void>;
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
  claimRunDate?: string;
  completedRunDate?: string;
  reservedAt?: Timestamp;
  windowEndSequence?: number;
}

export type DailyDigestRecoveryMode = 'definitely-unsent' | 'sent-or-ambiguous';
export type DailyDigestClaimState = 'reserved' | 'sending';

export interface DailyDigestBatchState {
  getCursor(): Promise<string | null>;
  advance(cursor: string | null): Promise<void>;
}

export interface DailyDigestRun {
  runDate: string;
  windowEndSequence: number;
}

export interface DailyDigestRunStore {
  getOrCreate(runDate: string): Promise<DailyDigestRun>;
}

export interface DailyDigestDependencies {
  subscriptions: DailyDigestSubscriptionStore;
  events: DailyDigestEventStore;
  deliveryState: DailyDigestDeliveryState;
  batchState: DailyDigestBatchState;
  runs: DailyDigestRunStore;
  recipients: RecipientDirectory;
  gmail: GmailClient;
  recipientCap: number;
  createClaimId(): string;
}

export function isDailyDigestReservedClaimStale(
  current: DailyDigestDeliveryRecord,
  now: Date,
): boolean {
  return current.claimState === 'reserved'
    && current.reservedAt instanceof Timestamp
    && current.reservedAt.toMillis() + DAILY_DIGEST_RESERVED_LEASE_MS <= now.getTime();
}

export function reserveDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
  reservedAt: Date,
  windowEndSequence: number,
  runDate?: string,
): DailyDigestDeliveryRecord | null {
  if (current.cursorSequence !== undefined
    && windowEndSequence < current.cursorSequence) {
    return null;
  }

  if (runDate
    && current.completedRunDate
    && current.completedRunDate >= runDate) {
    return null;
  }

  let available = current;
  if (current.claimId) {
    const staleReserved = isDailyDigestReservedClaimStale(current, reservedAt);
    if (!staleReserved) {
      return null;
    }

    available = {
      ...(current.cursorSequence !== undefined
        ? { cursorSequence: current.cursorSequence }
        : {}),
      ...(current.completedRunDate
        ? { completedRunDate: current.completedRunDate }
        : {}),
    };
  }

  return {
    ...available,
    claimId,
    claimState: 'reserved',
    ...(runDate ? { claimRunDate: runDate } : {}),
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

  return {
    cursorSequence: current.windowEndSequence,
    ...(current.claimRunDate ? { completedRunDate: current.claimRunDate } : {}),
  };
}

export function completeDailyDigestWithoutSend(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (
    current.claimId !== claimId
      || current.claimState !== 'reserved'
      || current.windowEndSequence === undefined
  ) {
    return null;
  }

  return {
    cursorSequence: current.windowEndSequence,
    ...(current.claimRunDate ? { completedRunDate: current.claimRunDate } : {}),
  };
}

export function releaseDailyDigestDelivery(
  current: DailyDigestDeliveryRecord,
  claimId: string,
): DailyDigestDeliveryRecord | null {
  if (current.claimId !== claimId || current.claimState !== 'reserved') {
    return null;
  }

  return {
    ...(current.cursorSequence === undefined
      ? {}
      : { cursorSequence: current.cursorSequence }),
    ...(current.completedRunDate
      ? { completedRunDate: current.completedRunDate }
      : {}),
  };
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
    if (current.claimState !== 'sending' || current.windowEndSequence === undefined) {
      return null;
    }
    return {
      cursorSequence: current.windowEndSequence,
      ...(current.claimRunDate ? { completedRunDate: current.claimRunDate } : {}),
    };
  }

  if (mode === 'definitely-unsent') {
    if (current.claimState !== 'reserved') {
      return null;
    }
    return {
      ...(current.cursorSequence === undefined
        ? {}
        : { cursorSequence: current.cursorSequence }),
      ...(current.completedRunDate
        ? { completedRunDate: current.completedRunDate }
        : {}),
    };
  }

  return null;
}

export function dailyDigestRunDate(now: Date): string {
  if (Number.isNaN(now.valueOf())) {
    throw new Error('Daily digest run requires a valid scheduled time.');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_DIGEST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts
    .find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function escapeHtml(value: unknown): string {
  return String(value)
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
    const listings = groups.get(event.cardName) ?? [];
    listings.push(event);
    groups.set(event.cardName, listings);
  }

  return Array.from(groups, ([cardName, listings]) => ({ cardName, listings }));
}

function buildText(groups: ReturnType<typeof buildGroups>): string {
  const lines = ['柯南 TCG 新上架摘要', ''];

  for (const group of groups) {
    lines.push(`卡名：${group.cardName}`);
    for (const listing of group.listings) {
      lines.push(
        `- 類型：${listing.cardType}`,
        `  卡名：${listing.cardName}`,
        `  價格：NT$ ${listing.listingPrice}`,
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
        <div>類型：${escapeHtml(listing.cardType)}</div>
        <div>卡名：${escapeHtml(listing.cardName)}</div>
        <div>價格：NT$ ${escapeHtml(listing.listingPrice)}</div>
        <div>稀有度：${escapeHtml(listing.rarity)}</div>
        <div>卡片 ID：${escapeHtml(listing.cardId)}</div>
        <div>剩餘數量：${escapeHtml(listing.remainingQuantity)}</div>
        <a href="${escapeHtml(listingUrl(String(listing.listingId)))}">查看商品</a>
      </li>`).join('');

    return `<section><h2>${escapeHtml(group.cardName)}</h2><ul>${listings}</ul></section>`;
  }).join('');

  return `<!doctype html><html><body><h1>柯南 TCG 新上架摘要</h1>${sections}<p><a href="${MARKETPLACE_BASE_URL}/#/notifications">通知設定</a></p></body></html>`;
}

export async function runDailyDigest(
  scheduledTime: Date,
  deps: DailyDigestDependencies,
  executionTime = new Date(),
): Promise<void> {
  const recipientCap = Math.max(0, Math.floor(deps.recipientCap));
  if (recipientCap === 0) {
    return;
  }

  const runDate = dailyDigestRunDate(scheduledTime);
  const run = await deps.runs.getOrCreate(runDate);
  const windowEnd = run.windowEndSequence;
  let scanCursor = await deps.batchState.getCursor();
  let claimedRecipients = 0;

  while (claimedRecipients < recipientCap) {
    const pageSize = recipientCap - claimedRecipients;
    const subscriptions = await deps.subscriptions.listEmailDailyEnabled(scanCursor, pageSize);
    if (subscriptions.length === 0) {
      await deps.batchState.advance(null);
      return;
    }

    type PageClaim = {
      subscription: NotificationSubscription;
      cardNames: string[];
      recipient: string;
      claimId: string;
      claim: DailyDigestClaim;
      eventsByListingId: Map<string, ListingEvent>;
      state: 'reserved' | 'sending' | 'done';
    };
    const claimsByUid = new Map<string, PageClaim>();

    const releaseReservedClaims = async () => {
      await Promise.allSettled(Array.from(claimsByUid.values(), (pageClaim) => (
        pageClaim.state === 'reserved'
          ? deps.deliveryState.release(pageClaim.subscription.uid, pageClaim.claimId)
          : Promise.resolve()
      )));
    };

    try {
      for (const subscription of subscriptions) {
        const cardNames = readSubscriptionCardNames(subscription.cardNames);
        if (subscription.emailDailyEnabled !== true
          || !cardNames
          || cardNames.length === 0) {
          continue;
        }

        const recipient = await deps.recipients.getVerifiedEmail(subscription.uid);
        if (!recipient) {
          continue;
        }

        const claimId = deps.createClaimId();
        const claim = await deps.deliveryState.claim(
          subscription.uid,
          claimId,
          executionTime,
          windowEnd,
          runDate,
        );
        if (!claim) {
          continue;
        }
        claimedRecipients += 1;

        claimsByUid.set(subscription.uid, {
          subscription,
          cardNames,
          recipient,
          claimId,
          claim,
          eventsByListingId: new Map(),
          state: 'reserved',
        });
      }
    } catch (error) {
      await releaseReservedClaims();
      throw error;
    }

    if (claimsByUid.size > 0) {
      let eventCursor = Math.min(...Array.from(
        claimsByUid.values(),
        (pageClaim) => pageClaim.claim.afterSequence,
      ));

      try {
        while (eventCursor < windowEnd) {
          const eventPage = await deps.events.findNewInSequenceRange(
            eventCursor,
            windowEnd,
            DAILY_EVENT_PAGE_SIZE,
          );
          for (const event of eventPage.events) {
            for (const pageClaim of claimsByUid.values()) {
              if (event.capturedSequence > pageClaim.claim.afterSequence
                && event.capturedSequence <= pageClaim.claim.throughSequence
                && matchesSubscribedCardName(pageClaim.cardNames, event.cardName)) {
                pageClaim.eventsByListingId.set(event.listingId, event);
              }
            }
          }

          if (!eventPage.hasMore) break;
          if (eventPage.nextAfterSequence <= eventCursor) {
            throw new Error('Daily digest event pagination did not advance.');
          }
          eventCursor = eventPage.nextAfterSequence;
        }
      } catch (error) {
        await releaseReservedClaims();
        throw error;
      }
    }

    try {
      for (const subscription of subscriptions) {
        const pageClaim = claimsByUid.get(subscription.uid);
        if (pageClaim) {
          const events = Array.from(pageClaim.eventsByListingId.values())
            .sort((left, right) => (
              left.createdAt.toMillis() - right.createdAt.toMillis()
                || left.listingId.localeCompare(right.listingId)
            ));
          if (events.length === 0) {
            await deps.deliveryState.completeWithoutSend(subscription.uid, pageClaim.claimId);
            pageClaim.state = 'done';
          } else {
            const groups = buildGroups(events);
            const message = {
              to: pageClaim.recipient,
              subject: '柯南 TCG 新上架摘要',
              groups,
              text: buildText(groups),
              html: buildHtml(groups),
            };
            const maySend = await deps.deliveryState.beginSend(
              subscription.uid,
              pageClaim.claimId,
            );
            if (maySend) {
              pageClaim.state = 'sending';
              try {
                await deps.gmail.sendDigest(message);
              } catch {
                scanCursor = subscription.uid;
                await deps.batchState.advance(scanCursor);
                continue;
              }

              await deps.deliveryState.complete(subscription.uid, pageClaim.claimId);
              pageClaim.state = 'done';
            }
          }
        }
        scanCursor = subscription.uid;
        await deps.batchState.advance(scanCursor);
      }
    } catch (error) {
      await releaseReservedClaims();
      throw error;
    }

    if (claimedRecipients >= recipientCap) return;

    if (subscriptions.length < pageSize) {
      await deps.batchState.advance(null);
      return;
    }
  }
}
