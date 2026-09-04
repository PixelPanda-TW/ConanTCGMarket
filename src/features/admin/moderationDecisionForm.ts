import type { ModerationDecision } from '../../domain/models';

export interface ModerationDecisionFormState {
  decision: ModerationDecision;
  rationale: string;
}

export interface ModerationDecisionFormResult {
  values: ModerationDecisionFormState;
  errors: { rationale?: string };
}

export function validateModerationDecisionForm(
  state: ModerationDecisionFormState,
): ModerationDecisionFormResult {
  const rationale = state.rationale.trim();
  const errors: ModerationDecisionFormResult['errors'] = {};
  if (rationale.length === 0) errors.rationale = '請填寫裁決理由。';
  else if (rationale.length > 1000) errors.rationale = '裁決理由須為 1 到 1000 字。';
  return { values: { decision: state.decision, rationale }, errors };
}
