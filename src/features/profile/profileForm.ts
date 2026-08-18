import type { ContactType } from '../../domain/models';

export const profileContactTypes = ['line', 'discord', 'threads', 'facebook'] as const;

export interface ProfileFormState {
  displayName: string;
  contactType: ContactType;
  contactValue: string;
}

export type ProfileFormErrors = Partial<Record<keyof ProfileFormState, string>>;

export function canApplyProfileRequest(
  isMounted: boolean,
  requestedUid: string,
  currentUid: string | null,
) {
  return isMounted && requestedUid === currentUid;
}

export function normalizeProfileForm(values: ProfileFormState): ProfileFormState {
  return {
    displayName: values.displayName.trim(),
    contactType: values.contactType.trim() as ContactType,
    contactValue: values.contactValue.trim(),
  };
}

export function validateProfileForm(values: ProfileFormState) {
  const normalizedValues = normalizeProfileForm(values);
  const errors: ProfileFormErrors = {};

  if (normalizedValues.displayName.length === 0) {
    errors.displayName = '請填寫顯示名稱。';
  }

  if (!profileContactTypes.includes(normalizedValues.contactType)) {
    errors.contactType = '請選擇支援的聯絡方式。';
  }

  if (normalizedValues.contactValue.length === 0) {
    errors.contactValue = '請填寫聯絡方式。';
  }

  return { values: normalizedValues, errors };
}
