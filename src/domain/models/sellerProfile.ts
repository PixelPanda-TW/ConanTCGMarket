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

export function validateSellerProfile(profile: SellerProfile) {
  if (!profile.uid) {
    throw new Error('Seller profile requires uid.');
  }

  if (!profile.displayName) {
    throw new Error('Seller profile requires displayName.');
  }

  if (!contactTypes.includes(profile.contactType)) {
    throw new Error('Seller profile requires a supported contactType.');
  }

  if (!profile.contactValue) {
    throw new Error('Seller profile requires contactValue.');
  }
}
