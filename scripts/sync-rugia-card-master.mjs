import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = 'https://rugiacreation.com/conan/search';

function decodeEntities(value) {
  return value.replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)));
}

function textLines(html) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
    .replace(/<[^>]+>/gu, '\n'))
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

/**
 * Projects source HTML to the only fields we are allowed to retain.
 * The card title is the first non-empty text line after a `code / 0000 (rarity)` line.
 */
export function extractApprovedCardRecords(html) {
  const records = [];
  const seen = new Set();
  const lines = textLines(html);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const match = lines[index].match(/^[^/]+\/\s*(\d{4})\s*\(([^)]+)\)$/u);
    if (!match || seen.has(match[1])) continue;
    const characterName = lines[index + 1];
    if (!characterName || /^(image|圖片)$/iu.test(characterName)) continue;
    seen.add(match[1]);
    records.push({ cardId: match[1], characterName, rarity: match[2].trim() });
  }

  return records;
}

export async function syncRugiaCardMaster(fetchImpl = fetch) {
  const response = await fetchImpl(sourceUrl, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Rugia Card Master request failed: ${response.status}`);
  return extractApprovedCardRecords(await response.text());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error('Usage: npm run sync:cards -- <output-file>');
  const records = await syncRugiaCardMaster();
  if (records.length === 0) throw new Error('Rugia Card Master response did not contain any four-digit card records.');
  await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${records.length} approved Card Master records to ${outputPath}.`);
}
