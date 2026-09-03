export type ContactType = 'line' | 'discord' | 'threads' | 'facebook';

export interface SellerProfile {
  uid: string;
  displayName: string;
  contactType: ContactType;
  contactValue: string;
  createdAt: Date;
  updatedAt: Date;
}

const contactTypes: ContactType[] = ['line', 'discord', 'threads', 'facebook'];

export function validateSellerProfileStructure(profile: SellerProfile) {
  if (typeof profile.uid !== 'string' || profile.uid.length === 0) {
    throw new Error('Seller profile requires uid.');
  }

  if (typeof profile.displayName !== 'string' || profile.displayName.length === 0) {
    throw new Error('Seller profile requires displayName.');
  }

  if (!contactTypes.includes(profile.contactType)) {
    throw new Error('Seller profile requires a supported contactType.');
  }

  if (typeof profile.contactValue !== 'string' || profile.contactValue.length === 0) {
    throw new Error('Seller profile requires contactValue.');
  }

  if (!(profile.createdAt instanceof Date) || Number.isNaN(profile.createdAt.valueOf())) {
    throw new Error('Seller profile requires a valid createdAt date.');
  }

  if (!(profile.updatedAt instanceof Date) || Number.isNaN(profile.updatedAt.valueOf())) {
    throw new Error('Seller profile requires a valid updatedAt date.');
  }
}

export function validateSellerProfile(profile: SellerProfile) {
  validateSellerProfileStructure(profile);
  const contact = normalizeAndValidateContact(profile.contactType, profile.contactValue);
  if (!contact.ok || contact.value !== profile.contactValue) {
    throw new Error('Seller profile requires a canonical contactValue for contactType.');
  }
}
import { normalizeAndValidateContact } from '../sellerContact';
