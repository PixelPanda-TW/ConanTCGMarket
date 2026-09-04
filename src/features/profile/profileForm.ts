import type { ContactType } from '../../domain/models';
import {
  normalizeAndValidateContact,
  sellerContactFieldDefinition,
} from '../../domain/sellerContact';

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
  let normalizedValues = normalizeProfileForm(values);
  const errors: ProfileFormErrors = {};

  if (normalizedValues.displayName.length === 0) {
    errors.displayName = '請填寫顯示名稱。';
  } else if (normalizedValues.displayName.length > 80) {
    errors.displayName = '顯示名稱最多 80 個字元。';
  }

  if (!profileContactTypes.includes(normalizedValues.contactType)) {
    errors.contactType = '請選擇支援的聯絡方式。';
  } else {
    const contact = normalizeAndValidateContact(
      normalizedValues.contactType,
      normalizedValues.contactValue,
    );
    if (contact.ok) {
      normalizedValues = { ...normalizedValues, contactValue: contact.value };
    } else {
      errors.contactValue = contact.reason === 'required'
        ? '請填寫聯絡方式。'
        : sellerContactFieldDefinition(normalizedValues.contactType).invalidMessage;
    }
  }

  return { values: normalizedValues, errors };
}
