import type { ModerationEvidenceData } from '../../data/firestore/repositories';

export interface ModerationEvidenceUrl {
  url: string;
  revoke(): void;
}

export function createModerationEvidenceUrl(
  evidence: ModerationEvidenceData,
): ModerationEvidenceUrl {
  const decoded = atob(evidence.dataBase64);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: evidence.contentType }));
  let revoked = false;
  return {
    url,
    revoke() {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    },
  };
}
