import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { ListingEvent } from './domain.js';
import { createDiscordClient } from './discordClient.js';

const event = {
  id: 'listing-1',
  listingId: 'listing-1',
  characterKey: '諸伏景光',
  characterName: '諸伏景光',
  rarity: 'SR',
  cardId: 'CT-P01-001',
  listingPrice: 120,
  remainingQuantity: 2,
  createdAt: Timestamp.fromDate(new Date('2026-08-25T01:00:00.000Z')),
  discordStatus: 'pending',
  attempts: 0,
  sellerId: 'seller-private-id',
  contactValue: 'seller-private-contact',
  email: 'seller@example.com',
} as ListingEvent & Record<string, unknown>;

describe('createDiscordClient', () => {
  it('posts only the approved public Listing fields to Discord', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createDiscordClient({
      getWebhookUrl: () => 'https://discord.example/webhook-secret',
      fetch: request,
    });

    await client.publishNewListing(event);

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.example/webhook-secret');
    expect(init.method).toBe('POST');
    expect(init.headers).toStrictEqual({ 'content-type': 'application/json' });

    const payload = JSON.parse(String(init.body)) as {
      content: string;
      allowed_mentions?: { parse: string[] };
    };
    expect(payload.content).toContain('諸伏景光');
    expect(payload.content).toContain('SR');
    expect(payload.content).toContain('CT-P01-001');
    expect(payload.content).toContain('120');
    expect(payload.content).toContain('2');
    expect(payload.content).toContain('/ConanTCGMarket/#/listing/listing-1');
    expect(payload.content).not.toContain('seller-private-id');
    expect(payload.content).not.toContain('seller-private-contact');
    expect(payload.content).not.toContain('seller@example.com');
    expect(payload).not.toHaveProperty('sellerId');
    expect(payload).not.toHaveProperty('contactValue');
    expect(payload).not.toHaveProperty('email');
    expect(payload.allowed_mentions).toStrictEqual({ parse: [] });
  });

  it('throws a sanitized error for a non-success response', async () => {
    const request = vi.fn().mockResolvedValue(new Response('secret response', { status: 500 }));
    const webhookUrl = 'https://discord.example/webhook-secret';
    const client = createDiscordClient({
      getWebhookUrl: () => webhookUrl,
      fetch: request,
    });

    let message = '';
    try {
      await client.publishNewListing(event);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Discord webhook request failed with status 500.');
    expect(message).not.toContain(webhookUrl);
    expect(message).not.toContain('secret response');
  });

  it('sanitizes network failures that contain the webhook URL', async () => {
    const webhookUrl = 'https://discord.example/webhook-secret';
    const request = vi.fn().mockRejectedValue(new Error(`request failed for ${webhookUrl}`));
    const client = createDiscordClient({
      getWebhookUrl: () => webhookUrl,
      fetch: request,
    });

    await expect(client.publishNewListing(event))
      .rejects.toThrow('Discord webhook request failed.');
    await expect(client.publishNewListing(event))
      .rejects.not.toThrow(webhookUrl);
  });
});
