export function toCharacterKey(characterName: string): string {
  const key = characterName.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!key) {
    throw new Error('Character name is required.');
  }

  return key;
}
