# Stale reservation clock fix report

Date: 2026-08-25
Scope: Daily digest retry lease timing only.

## RED

Added `reclaims a stale pre-send reservation on retry despite a historical
scheduler time` in `functions/src/dailyDigest.test.ts`. It seeds a pre-send
reservation at `2026-08-26T01:00:00Z`, then retries the same scheduled event at
`01:16:00Z`.

Before the fix, `npm run test:daily-digest` failed only this regression: Gmail
was called zero times because the retry passed the historical `scheduleTime`
back into the stale-reservation comparison.

## GREEN

`runDailyDigest` now accepts `scheduledTime` for the Taipei date/run identity
and a separately injectable `executionTime` (defaulting to `new Date()`) for
the reservation timestamp and stale-lease comparison. The scheduler still
passes its fixed `event.scheduleTime`; production lease timing therefore uses
the actual execution clock.

The run watermark/date remain keyed exclusively to `scheduledTime`. No sending
transition, at-most-once Gmail behavior, or operator recovery mode was changed.

## Verification

- `npm run test:daily-digest` — 40/40 tests passed.
- `npm test` — 92/92 Functions tests passed.
- `npm run build` — TypeScript build passed.
