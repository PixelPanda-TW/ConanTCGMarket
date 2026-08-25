import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(relativePath: string): Promise<unknown> {
  const contents = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return JSON.parse(contents) as unknown;
}

describe('Firestore deployment configuration', () => {
  it('deploys the composite index required by the due Discord retry query', async () => {
    const firebaseConfig = await readJson('../../firebase.json') as {
      firestore?: { indexes?: string };
    };
    const indexes = await readJson('../../firestore.indexes.json') as {
      indexes?: unknown[];
    };

    expect(firebaseConfig.firestore?.indexes).toBe('firestore.indexes.json');
    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'listingEvents',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'discordStatus', order: 'ASCENDING' },
        { fieldPath: 'attempts', order: 'ASCENDING' },
        { fieldPath: 'nextAttemptAt', order: 'ASCENDING' },
      ],
    });
  });
});
