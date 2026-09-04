export type ContactType = 'line' | 'discord' | 'threads' | 'facebook';

export interface PublicSellerProfile {
  uid: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerContact {
  uid: string;
  contactType: ContactType;
  contactValue: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SellerProfile extends PublicSellerProfile, SellerContact {}

const contactTypes: ContactType[] = ['line', 'discord', 'threads', 'facebook'];

function validateUid(uid: unknown) {
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128) {
    throw new Error('Seller profile requires a uid from 1 to 128 characters.');
  }
  if (uid.trim() !== uid) {
    throw new Error('Seller profile uid must be trimmed.');
  }
}

function validateDate(value: unknown, fieldName: 'createdAt' | 'updatedAt') {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new Error(`Seller profile requires a valid ${fieldName} date.`);
  }
}

export function validatePublicSellerProfile(profile: PublicSellerProfile) {
  validateUid(profile.uid);
  if (
    typeof profile.displayName !== 'string'
    || profile.displayName.length < 1
    || profile.displayName.length > 80
  ) {
    throw new Error('Seller profile displayName must contain 1 to 80 characters.');
  }
  if (profile.displayName.trim() !== profile.displayName) {
    throw new Error('Seller profile displayName must be trimmed.');
  }
  validateDate(profile.createdAt, 'createdAt');
  validateDate(profile.updatedAt, 'updatedAt');
}

export function validateSellerContactStructure(profile: SellerContact) {
  validateUid(profile.uid);
  if (!contactTypes.includes(profile.contactType)) {
    throw new Error('Seller profile requires a supported contactType.');
  }
  if (typeof profile.contactValue !== 'string' || profile.contactValue.length === 0) {
    throw new Error('Seller profile requires contactValue.');
  }
  validateDate(profile.createdAt, 'createdAt');
  validateDate(profile.updatedAt, 'updatedAt');
}

export function validateSellerContact(contact: SellerContact) {
  validateSellerContactStructure(contact);
  const result = normalizeAndValidateContact(contact.contactType, contact.contactValue);
  if (!result.ok || result.value !== contact.contactValue) {
    throw new Error('Seller contact requires a canonical contactValue for contactType.');
  }
}

export function validateSellerProfileStructure(profile: SellerProfile) {
  validatePublicSellerProfile(profile);
  validateSellerContactStructure(profile);
}

export function validateSellerProfile(profile: SellerProfile) {
  validatePublicSellerProfile(profile);
  try {
    validateSellerContact(profile);
  } catch (error) {
    if (error instanceof Error && error.message.includes('canonical contactValue')) {
      throw new Error('Seller profile requires a canonical contactValue for contactType.');
    }
    throw error;
  }
  const contact = normalizeAndValidateContact(profile.contactType, profile.contactValue);
  if (!contact.ok || contact.value !== profile.contactValue) {
    throw new Error('Seller profile requires a canonical contactValue for contactType.');
  }
}
import { normalizeAndValidateContact } from '../sellerContact';
