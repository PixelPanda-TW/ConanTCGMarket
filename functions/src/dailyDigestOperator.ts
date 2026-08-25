import type { DailyDigestRecoveryMode } from './dailyDigest.js';

const DEFAULT_MONITOR_LIMIT = 50;
const MAX_MONITOR_LIMIT = 100;
const MAX_UID_LENGTH = 128;
const MAX_CLAIM_ID_LENGTH = 128;

export interface DailyDigestClaimInspection {
  uid: string;
  claimId: string;
  claimState: 'reserved' | 'sending';
  claimRunDate?: string;
  reservedAt: string | null;
  staleReserved: boolean;
  cursorSequence?: number;
  windowEndSequence?: number;
}

export interface DailyDigestOperatorDependencies {
  listActiveClaims(limit: number): Promise<DailyDigestClaimInspection[]>;
  recover(
    uid: string,
    claimId: string,
    mode: DailyDigestRecoveryMode,
  ): Promise<boolean>;
}

export class DailyDigestOperatorError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'DailyDigestOperatorError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoundedIdentifier(
  value: unknown,
  fieldName: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string'
    || value.trim().length === 0
    || value.length > maximumLength) {
    throw new DailyDigestOperatorError(
      400,
      `${fieldName} must contain 1 to ${maximumLength} characters.`,
    );
  }
  return value;
}

export async function handleDailyDigestOperatorRequest(
  input: unknown,
  deps: DailyDigestOperatorDependencies,
): Promise<unknown> {
  if (!isRecord(input)) {
    throw new DailyDigestOperatorError(400, 'Request body must be an object.');
  }

  if (input.action === 'list') {
    const limit = input.limit === undefined ? DEFAULT_MONITOR_LIMIT : input.limit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_MONITOR_LIMIT) {
      throw new DailyDigestOperatorError(
        400,
        `limit must be an integer between 1 and ${MAX_MONITOR_LIMIT}.`,
      );
    }

    const claims = await deps.listActiveClaims((limit as number) + 1);
    return {
      claims: claims.slice(0, limit as number),
      truncated: claims.length > (limit as number),
    };
  }

  if (input.action === 'recover') {
    const uid = readBoundedIdentifier(input.uid, 'uid', MAX_UID_LENGTH);
    const claimId = readBoundedIdentifier(input.claimId, 'claimId', MAX_CLAIM_ID_LENGTH);
    const decision = input.decision;
    if (decision !== 'definitely-unsent' && decision !== 'sent-or-ambiguous') {
      throw new DailyDigestOperatorError(
        400,
        'decision must be definitely-unsent or sent-or-ambiguous.',
      );
    }

    const recovered = await deps.recover(uid, claimId, decision);
    if (!recovered) {
      throw new DailyDigestOperatorError(
        409,
        'The claim changed state, does not exist, or is incompatible with that decision.',
      );
    }
    return { recovered: true };
  }

  throw new DailyDigestOperatorError(400, 'action must be list or recover.');
}
