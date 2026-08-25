import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = 'https://rugiacreation.com/conan/search';
const productVersions = [
  'PR',
  ...Array.from({ length: 11 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 11 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
];

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

function characterNameFromInfoBox(infoBox) {
  const markedName = infoBox.match(/<a\b(?=[^>]*\bclass=(?:"[^"]*\bfontsize2\b[^"]*"|'[^']*\bfontsize2\b[^']*'))[^>]*>([\s\S]*?)<\/a>/iu)?.[1];
  if (markedName) return textLines(markedName)[0];

  return textLines(infoBox.replace(/^[\s\S]*?<br\s*\/?>/iu, ''))[0];
}

/**
 * Projects source HTML to the only fields we are allowed to retain.
 * The card title is the first non-empty text line after a `code / 0000 (rarity)` line.
 */
export function extractApprovedCardRecords(html) {
  const records = [];
  const seen = new Set();

  const cardHolders = html.match(/<span\b[^>]*\bclass=(?:['"])cardHolder(?:['"])[^>]*>[\s\S]*?(?=<span\b[^>]*\bclass=(?:['"])cardHolder(?:['"])[^>]*>|$)/giu) ?? [];

  for (const holder of cardHolders) {
    if (!/showCard\([^)]*['"]角色卡['"]/u.test(holder)) continue;

    const infoBox = holder.match(/<div\b[^>]*\bclass=(?:['"])infoBox(?:['"])[^>]*>([\s\S]*?)<\/div>/iu)?.[1];
    if (!infoBox) continue;

    const metadata = decodeEntities(infoBox.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim());
    const match = metadata.match(/(?:^|\s)[^\s/]+\s*\/\s*(\d{4})\s*\(([^)]+)\)/u);
    const characterName = characterNameFromInfoBox(infoBox);

    if (!match || !characterName || seen.has(match[1])) continue;
    seen.add(match[1]);
    records.push({ cardId: match[1], characterName, rarity: match[2].trim() });
  }

  if (records.length > 0) return records;

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
  const cardsById = new Map();

  for (const version of productVersions) {
    const response = await fetchImpl(`${sourceUrl}?Version=${version}`, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Rugia Card Master request failed for ${version}: ${response.status}`);

    for (const record of extractApprovedCardRecords(await response.text())) {
      const existing = cardsById.get(record.cardId);
      if (existing && existing.characterName !== record.characterName) {
        throw new Error(`Rugia Card Master has conflicting character names for card ID ${record.cardId}.`);
      }
      if (existing) existing.rarities.add(record.rarity);
      else cardsById.set(record.cardId, { cardId: record.cardId, characterName: record.characterName, rarities: new Set([record.rarity]) });
    }
  }

  return Array.from(cardsById.values(), ({ cardId, characterName, rarities }) => ({
    cardId,
    characterName,
    rarities: Array.from(rarities).sort(),
  })).sort((left, right) => left.cardId.localeCompare(right.cardId));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error('Usage: npm run sync:cards -- <output-file>');
  const records = await syncRugiaCardMaster();
  if (records.length === 0) throw new Error('Rugia Card Master response did not contain any four-digit card records.');
  await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${records.length} approved Card Master records to ${outputPath}.`);
}
