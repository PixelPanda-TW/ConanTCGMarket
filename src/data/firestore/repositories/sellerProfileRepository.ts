import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  validateSellerProfile,
  type PublicSellerProfile,
  type SellerContact,
  type SellerProfile,
} from '../../../domain/models';
import { normalizeAndValidateContact } from '../../../domain/sellerContact';
import { auth, functionsClient } from '../../../lib/firebase/app';
import { publicSellerProfileConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const sellerProfileDocument = (uid: string) =>
  doc(firestoreDb, collections.sellerProfiles, uid).withConverter(publicSellerProfileConverter);

function assertAuthenticatedSeller(uid: string) {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Seller profile access requires the authenticated seller.');
  }
}

export async function getSellerProfile(uid: string): Promise<SellerProfile | null> {
  assertAuthenticatedSeller(uid);
  const callable = httpsCallable<Record<string, never>, unknown>(functionsClient, 'getOwnSellerProfile');
  const result = await callable({});
  return result.data === null ? null : readSellerProfileResponse(result.data, uid);
}

export async function getPublicSellerProfile(uid: string): Promise<PublicSellerProfile | null> {
  const snapshot = await getDoc(sellerProfileDocument(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveSellerProfile(profile: SellerProfile): Promise<SellerProfile> {
  assertAuthenticatedSeller(profile.uid);
  const callable = httpsCallable<
    Pick<SellerProfile, 'displayName' | 'contactType' | 'contactValue'>,
    unknown
  >(functionsClient, 'saveSellerProfile');
  const result = await callable({
    displayName: profile.displayName,
    contactType: profile.contactType,
    contactValue: profile.contactValue,
  });
  return readSellerProfileResponse(result.data, profile.uid);
}

export async function getSellerContact(listingId: string): Promise<Pick<
  SellerContact,
  'contactType' | 'contactValue'
>> {
  const normalizedId = listingId.trim();
  if (normalizedId.length < 1 || normalizedId.length > 128) {
    throw new Error('Seller contact disclosure requires a valid Listing ID.');
  }
  const callable = httpsCallable<{ listingId: string }, unknown>(functionsClient, 'getSellerContact');
  const result = await callable({ listingId: normalizedId });
  return readSellerContactResponse(result.data);
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function readSellerProfileResponse(value: unknown, expectedUid: string): SellerProfile {
  if (!isExactRecord(value, [
    'uid', 'displayName', 'contactType', 'contactValue', 'createdAt', 'updatedAt',
  ]) || value.uid !== expectedUid
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) {
    throw new Error('Received an invalid seller profile response.');
  }
  const profile = {
    uid: value.uid,
    displayName: value.displayName,
    contactType: value.contactType,
    contactValue: value.contactValue,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  } as SellerProfile;
  try {
    validateSellerProfile(profile);
  } catch {
    throw new Error('Received an invalid seller profile response.');
  }
  return profile;
}

function readSellerContactResponse(value: unknown): Pick<SellerContact, 'contactType' | 'contactValue'> {
  if (!isExactRecord(value, ['contactType', 'contactValue'])
    || typeof value.contactType !== 'string' || typeof value.contactValue !== 'string'
    || !['line', 'discord', 'threads', 'facebook'].includes(value.contactType)) {
    throw new Error('Received an invalid seller contact response.');
  }
  const result = normalizeAndValidateContact(value.contactType as SellerContact['contactType'], value.contactValue);
  if (!result.ok || result.value !== value.contactValue) {
    throw new Error('Received an invalid seller contact response.');
  }
  return { contactType: value.contactType as SellerContact['contactType'], contactValue: value.contactValue };
}
