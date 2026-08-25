import { defineSecret } from 'firebase-functions/params';
import type { DiscordClient, ListingEvent } from './domain.js';

const MARKETPLACE_BASE_URL = 'https://pixelpanda-tw.github.io/ConanTCGMarket';

export const discordListingsWebhookUrl = defineSecret('DISCORD_LISTINGS_WEBHOOK_URL');

interface FetchResponse {
  ok: boolean;
  status: number;
}

interface DiscordClientDependencies {
  getWebhookUrl(): string;
  fetch(input: string, init: RequestInit): Promise<FetchResponse>;
}

function buildMessage(event: ListingEvent): string {
  const listingUrl = `${MARKETPLACE_BASE_URL}/#/listing/${encodeURIComponent(event.listingId)}`;

  return [
    '🃏 柯南 TCG 新上架',
    `角色：${event.characterName}`,
    `稀有度：${event.rarity}`,
    `卡片 ID：${event.cardId}`,
    `價格：NT$ ${event.listingPrice}`,
    `剩餘數量：${event.remainingQuantity}`,
    `查看商品：${listingUrl}`,
  ].join('\n');
}

export function createDiscordClient(
  dependencies: DiscordClientDependencies = {
    getWebhookUrl: () => discordListingsWebhookUrl.value(),
    fetch: globalThis.fetch,
  },
): DiscordClient {
  return {
    async publishNewListing(event: ListingEvent): Promise<void> {
      const webhookUrl = dependencies.getWebhookUrl();
      let response: FetchResponse;

      try {
        response = await dependencies.fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: buildMessage(event) }),
        });
      } catch {
        throw new Error('Discord webhook request failed.');
      }

      if (!response.ok) {
        throw new Error(`Discord webhook request failed with status ${response.status}.`);
      }
    },
  };
}
