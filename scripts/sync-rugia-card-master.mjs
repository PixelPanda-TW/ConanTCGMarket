import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildSyncResult,
  normalizeSourceCardId,
} from './card-master-domain.mjs';

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

const sourceCardTypes = new Map([
  ['角色卡', 'character'],
  ['事件卡', 'event'],
  ['情境卡', 'case'],
  ['拍檔卡', 'partner'],
]);

function cardNameFromInfoBox(infoBox) {
  const markedName = infoBox.match(/<a\b(?=[^>]*\bclass=(?:"[^"]*\bfontsize2\b[^"]*"|'[^']*\bfontsize2\b[^']*'))[^>]*>([\s\S]*?)<\/a>/iu)?.[1];
  if (markedName) return textLines(markedName)[0];

  const nameSection = infoBox.match(/<br\s*\/?>\s*([\s\S]*)$/iu)?.[1];
  return nameSection ? textLines(nameSection)[0] : undefined;
}

/**
 * Projects source HTML to the only fields we are allowed to retain.
 * The card title is the first non-empty text line after a `code / 0000 (rarity)` line.
 */
export function extractApprovedCardRecords(html, { onCorrection = () => {} } = {}) {
  const records = [];

  const cardHolders = html.match(/<span\b[^>]*\bclass=(?:['"])cardHolder(?:['"])[^>]*>[\s\S]*?(?=<span\b[^>]*\bclass=(?:['"])cardHolder(?:['"])[^>]*>|$)/giu) ?? [];

  for (const holder of cardHolders) {
    const infoBox = holder.match(/<div\b[^>]*\bclass=(?:['"])infoBox(?:['"])[^>]*>([\s\S]*?)<\/div>/iu)?.[1];
    const sourceType = holder.match(/showCard\(\s*['"][^'"]*['"]\s*,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/u)?.[1];
    if (!sourceType && !infoBox) continue;

    const cardType = sourceCardTypes.get(sourceType);
    if (!cardType) throw new Error(`Rugia Card Master has unknown source card type: ${sourceType ?? 'missing'}.`);

    if (!infoBox) throw new Error('Rugia Card Master card record is missing metadata.');

    const metadata = decodeEntities(infoBox.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim());
    const match = metadata.match(/(?:^|\s)[^\s/]+\s*\/\s*([^\s()]+)\s*\(([^)]+)\)/u);
    const cardName = cardNameFromInfoBox(infoBox);

    if (!match || !cardName || !match[2].trim()) {
      throw new Error('Rugia Card Master card record is missing an approved field.');
    }
    const { cardId, correction } = normalizeSourceCardId(match[1]);
    if (correction) onCorrection(correction);
    records.push({ cardId, cardType, cardName, rarity: match[2].trim() });
  }

  return records;
}

export async function syncRugiaCardMaster(fetchImpl = fetch) {
  const occurrences = [];
  const corrections = [];

  for (const version of productVersions) {
    const response = await fetchImpl(`${sourceUrl}?Version=${version}`, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Rugia Card Master request failed for ${version}: ${response.status}`);

    occurrences.push(...extractApprovedCardRecords(await response.text(), {
      onCorrection: (correction) => corrections.push(correction),
    }));
  }

  return buildSyncResult(occurrences, corrections, { versionCount: productVersions.length });
}

export function formatSyncReport(report) {
  const corrections = report.corrections.length === 0
    ? 'none'
    : report.corrections.map(({ from, to, count }) => `${from}->${to}(${count})`).join(',');
  return `Rugia Card Master sync report: versions=${report.versionCount}, occurrences=${report.occurrenceCount}, canonicalCards=${report.canonicalCardCount}, types(character=${report.cardTypeCounts.character},event=${report.cardTypeCounts.event},case=${report.cardTypeCounts.case},partner=${report.cardTypeCounts.partner}), idFormats(numeric=${report.idFormatCounts.numeric},prefixedP=${report.idFormatCounts.prefixedP}), sharedCardIds=${report.sharedCardIdCount}, duplicateOccurrences=${report.duplicateOccurrenceCount}, corrections=${corrections}, keyCollisions=${report.keyCollisionCount}.`;
}

export async function runSyncCli(
  outputPath,
  { sync = syncRugiaCardMaster, write = writeFile, log = console.log } = {},
) {
  const { cards, report } = await sync();
  if (cards.length === 0) throw new Error('Rugia Card Master response did not contain any approved card records.');
  if (report.keyCollisionCount !== 0) {
    throw new Error(`Rugia Card Master has ${report.keyCollisionCount} card key collision(s); refusing to write artifact.`);
  }
  await write(outputPath, `${JSON.stringify(cards, null, 2)}\n`, 'utf8');
  log(`Wrote ${cards.length} approved Card Master records to ${outputPath}.`);
  log(formatSyncReport(report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error('Usage: npm run sync:cards -- <output-file>');
  await runSyncCli(outputPath);
}
