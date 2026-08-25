import type {
  GmailClient,
  ListingEvent,
  RecipientDirectory,
} from './domain.js';

const MARKETPLACE_BASE_URL = 'https://pixelpanda-tw.github.io/ConanTCGMarket';
const CHARACTER_QUERY_LIMIT = 30;
const EPOCH = new Date(0);

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
  listEmailDailyEnabled(): Promise<NotificationSubscription[]>;
}

export interface DailyDigestEventStore {
  findNewByCharacterKeys(
    characterKeys: string[],
    after: Date,
    through: Date,
  ): Promise<ListingEvent[]>;
}

export interface DailyDigestDeliveryState {
  getCursor(uid: string): Promise<Date | null>;
  advance(uid: string, cursor: Date): Promise<void>;
}

export interface DailyDigestDependencies {
  subscriptions: DailyDigestSubscriptionStore;
  events: DailyDigestEventStore;
  deliveryState: DailyDigestDeliveryState;
  recipients: RecipientDirectory;
  gmail: GmailClient;
  recipientCap: number;
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
  const subscriptions = await deps.subscriptions.listEmailDailyEnabled();
  const recipientCap = Math.max(0, Math.floor(deps.recipientCap));

  for (const subscription of subscriptions.slice(0, recipientCap)) {
    if (!subscription.emailDailyEnabled || subscription.characterKeys.length === 0) {
      continue;
    }

    const recipient = await deps.recipients.getVerifiedEmail(subscription.uid);
    if (!recipient) {
      continue;
    }

    const cursor = await deps.deliveryState.getCursor(subscription.uid) ?? EPOCH;
    const eventsByListingId = new Map<string, ListingEvent>();

    for (const characterKeys of chunks(subscription.characterKeys, CHARACTER_QUERY_LIMIT)) {
      const events = await deps.events.findNewByCharacterKeys(characterKeys, cursor, now);
      for (const event of events) {
        eventsByListingId.set(event.listingId, event);
      }
    }

    const events = Array.from(eventsByListingId.values()).sort((left, right) => (
      left.createdAt.toMillis() - right.createdAt.toMillis()
        || left.listingId.localeCompare(right.listingId)
    ));
    if (events.length === 0) {
      continue;
    }

    const groups = buildGroups(events);
    try {
      await deps.gmail.sendDigest({
        to: recipient,
        subject: '柯南 TCG 新上架摘要',
        groups,
        text: buildText(groups),
        html: buildHtml(groups),
      });
    } catch {
      continue;
    }

    await deps.deliveryState.advance(subscription.uid, now);
  }
}
