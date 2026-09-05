export interface AccountModerationFormState {
  action: 'suspend' | 'restore';
  reason: string;
}

export interface AccountModerationFormResult {
  values: AccountModerationFormState;
  errors: { reason?: string };
}

export function validateAccountModerationForm(
  state: AccountModerationFormState,
): AccountModerationFormResult {
  const reason = state.reason.trim();
  const errors: AccountModerationFormResult['errors'] = {};
  if (reason.length === 0) errors.reason = '請填寫處理理由。';
  else if (reason.length > 1000) errors.reason = '處理理由須為 1 到 1000 字。';
  return { values: { action: state.action, reason }, errors };
}
