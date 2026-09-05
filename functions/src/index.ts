import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import { error as logError, info as logInfo } from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  AccountModerationError,
  drainAccountModerationOperation,
  reconcileAccountModerationOperation,
  republishSuspendedListing as republishSuspendedListingData,
  restoreModerationTarget as restoreModerationTargetData,
  suspendModerationTarget as suspendModerationTargetData,
  type AccountModerationReconciliationDependencies,
  type AccountModerationReconciliationTransaction,
  type AccountRestorationDependencies,
  type AccountRestorationTransaction,
  type AccountSuspensionDependencies,
  type AccountSuspensionTransaction,
  type ListingRepublishDependencies,
  type ListingRepublishTransaction,
} from './accountModeration.js';
import {
  AccountAppealError,
  accountAppealId,
  getOwnAccountAppeal as getOwnAccountAppealData,
  submitAccountAppeal as submitAccountAppealData,
  type AccountAppealSubmissionDependencies,
  type AccountAppealSubmissionTransaction,
  type StoredAccountAppeal,
} from './accountAppeals.js';
import {
  cleanupExpiredAppealDrafts as cleanupExpiredAppealDraftsData,
  type AppealCleanupDependencies,
} from './appealCleanup.js';
import {
  decideAccountAppeal as decideAccountAppealData,
  getAccountAppeal as getAccountAppealData,
  getAccountAppealEvidence as getAccountAppealEvidenceData,
  listAccountAppeals as listAccountAppealsData,
  type AccountAppealDecisionDependencies,
  type AccountAppealDecisionTransaction,
  type AccountAppealEvidenceDependencies,
  type AccountAppealListDependencies,
  type AccountAppealReadDependencies,
} from './accountAppealReview.js';
import {
  AdminCardMasterError,
  handleAddCardMasterEntry,
  handleDisableCardMasterEntry,
  handleEditCardMasterEntry,
  handleListCardMasterArchives,
  handleMergeCardMasterEntries,
  type AdminCardMasterDependencies,
  type AdminCardMasterTransaction,
  type CardMasterArchive,
  type CardMasterArchivePageDependencies,
  type CardMasterArchivePageTransaction,
  type CardMasterAudit,
} from './adminCardMaster.js';
import {
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  DEFAULT_DAILY_RECIPIENT_CAP,
  beginDailyDigestSend,
  completeDailyDigestDelivery,
  completeDailyDigestWithoutSend,
  isDailyDigestReservedClaimStale,
  recoverDailyDigestDelivery,
  releaseDailyDigestDelivery,
  reserveDailyDigestDelivery,
  runDailyDigest as runDailyDigestData,
  type DailyDigestDependencies,
  type DailyDigestDeliveryRecord,
  type NotificationSubscription,
} from './dailyDigest.js';
import {
  DailyDigestOperatorError,
  handleDailyDigestOperatorRequest,
  type DailyDigestOperatorDependencies,
} from './dailyDigestOperator.js';
import { readListingEventPage } from './domain.js';
import {
  createGmailClient,
  createRecipientDirectory,
  gmailOAuthClientId,
  gmailOAuthClientSecret,
  gmailOAuthRefreshToken,
  gmailSenderAddress,
} from './gmailClient.js';
import {
  captureListingEvent as captureListingEventData,
  type ListingEventStore,
} from './listingEvents.js';
import {
  ListingLifecycleError,
  handleDeleteUnsoldListing,
  handleRecordListingSale,
  handleUpdateSellerListing,
  type ListingLifecycleDependencies,
  type ListingLifecycleTransaction,
  type ListingMutation,
} from './listingLifecycle.js';
import {
  ModerationReviewError,
  decideModerationCase as decideModerationCaseData,
  getModerationCase as getModerationCaseData,
  getModerationEvidence as getModerationEvidenceData,
  listModerationCases as listModerationCasesData,
  type ModerationCaseDetailDependencies,
  type ModerationCaseListDependencies,
  type ModerationDecisionDependencies,
  type ModerationDecisionTransaction,
  type ModerationEvidenceDependencies,
} from './moderationReview.js';
import {
  cleanupExpiredReportDrafts as cleanupExpiredReportDraftsData,
  type ReportCleanupDependencies,
  type ReportCleanupTransaction,
} from './reportCleanup.js';
import {
  ReportTicketError,
  createReportDraft,
  submitReport,
  type CreateReportDraftDependencies,
  type CreateReportDraftTransaction,
  type SubmitReportDependencies,
  type SubmitReportTransaction,
} from './reportTickets.js';
import {
  SecureSellerProfileError,
  handleGetOwnSellerProfile,
  handleGetSellerContact,
  handleSaveSellerProfile,
  type ContactAccessAudit,
  type SecureSellerProfileDependencies,
  type SecureSellerProfileTransaction,
} from './sellerProfiles.js';

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();

function firestoreDataWithDates(data: DocumentData | undefined): Record<string, unknown> | null {
  if (!data) return null;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    value instanceof Timestamp ? value.toDate() : value,
  ]));
}

function storedAudit(audit: ContactAccessAudit): DocumentData {
  return {
    requesterUid: audit.requesterUid,
    ...(audit.sellerUid ? { sellerUid: audit.sellerUid } : {}),
    listingId: audit.listingId,
    outcome: audit.outcome,
    createdAt: Timestamp.fromDate(audit.createdAt),
  };
}

function storedCardMasterArchive(archive: CardMasterArchive): DocumentData {
  return {
    ...archive,
    actedAt: Timestamp.fromDate(archive.actedAt),
  };
}

function storedCardMasterAudit(audit: CardMasterAudit): DocumentData {
  return {
    ...audit,
    actedAt: Timestamp.fromDate(audit.actedAt),
  };
}

const adminCardMasterDependencies: AdminCardMasterDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: AdminCardMasterTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getCard(key) {
          const snapshot = await transaction.get(firestore.collection('cards').doc(key));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getArchive(key) {
          const snapshot = await transaction.get(
            firestore.collection('cardMasterArchives').doc(key),
          );
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        setCard(key, data) {
          transaction.set(firestore.collection('cards').doc(key), data);
        },
        deleteCard(key) {
          transaction.delete(firestore.collection('cards').doc(key));
        },
        createArchive(key, data) {
          transaction.create(
            firestore.collection('cardMasterArchives').doc(key),
            storedCardMasterArchive(data),
          );
        },
        createAudit(key, data) {
          transaction.create(
            firestore.collection('cardMasterAuditLogs').doc(key),
            storedCardMasterAudit(data),
          );
        },
      };
      return operation(port);
    });
  },
};

const cardMasterArchivePageDependencies: CardMasterArchivePageDependencies = {
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: CardMasterArchivePageTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async listArchives(cursor, limit) {
          let query = firestore.collection('cardMasterArchives')
            .orderBy('actedAt', 'desc')
            .orderBy(FieldPath.documentId())
            .limit(limit);
          if (cursor) {
            query = query.startAfter(Timestamp.fromMillis(cursor.actedAt), cursor.key);
          }
          const snapshot = await transaction.get(query);
          return snapshot.docs.map((document) => ({
            key: document.id,
            data: firestoreDataWithDates(document.data()) ?? {},
          }));
        },
      };
      return operation(port);
    });
  },
};

const secureSellerProfileDependencies: SecureSellerProfileDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: SecureSellerProfileTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getPublicProfile(uid) {
          const snapshot = await transaction.get(firestore.collection('sellerProfiles').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getSellerContact(uid) {
          const snapshot = await transaction.get(firestore.collection('sellerContacts').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getListing(id) {
          const snapshot = await transaction.get(firestore.collection('listings').doc(id));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getRequesterCount(key) {
          const snapshot = await transaction.get(
            firestore.collection('sellerContactRequesterLimits').doc(key),
          );
          return snapshot.exists ? snapshot.data()?.count as number : 0;
        },
        async getSellerCount(key) {
          const snapshot = await transaction.get(
            firestore.collection('sellerContactSellerLimits').doc(key),
          );
          return snapshot.exists ? snapshot.data()?.count as number : 0;
        },
        saveProfilePair(uid, profile, contact) {
          transaction.set(firestore.collection('sellerProfiles').doc(uid), {
            displayName: profile.displayName,
            createdAt: Timestamp.fromDate(profile.createdAt),
            updatedAt: Timestamp.fromDate(profile.updatedAt),
          });
          transaction.set(firestore.collection('sellerContacts').doc(uid), {
            contactType: contact.contactType,
            contactValue: contact.contactValue,
            createdAt: Timestamp.fromDate(contact.createdAt),
            updatedAt: Timestamp.fromDate(contact.updatedAt),
          });
        },
        setRequesterCount(key, count) {
          transaction.set(firestore.collection('sellerContactRequesterLimits').doc(key), {
            count,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        setSellerCount(key, count) {
          transaction.set(firestore.collection('sellerContactSellerLimits').doc(key), {
            count,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        createAudit(audit) {
          transaction.create(
            firestore.collection('sellerContactAccessLogs').doc(audit.id),
            storedAudit(audit),
          );
        },
      };
      return operation(port);
    });
  },
  async writeAudit(audit) {
    await firestore.collection('sellerContactAccessLogs').doc(audit.id).create(storedAudit(audit));
  },
};

function throwCallableError(error: unknown, operation: string): never {
  if (error instanceof SecureSellerProfileError
    || error instanceof ListingLifecycleError
    || error instanceof AdminCardMasterError
    || error instanceof ReportTicketError
    || error instanceof ModerationReviewError
    || error instanceof AccountModerationError
    || error instanceof AccountAppealError) {
    throw new HttpsError(error.code, error.message);
  }
  logError(`${operation} failed.`, {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  throw new HttpsError('unavailable', '服務目前無法使用，請稍後再試。');
}

export const listCardMasterArchives = onCall(async (request) => {
  try {
    return await handleListCardMasterArchives({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, cardMasterArchivePageDependencies);
  } catch (error) {
    throwCallableError(error, 'Card Master archive list');
  }
});

export const addCardMasterEntry = onCall(async (request) => {
  try {
    return await handleAddCardMasterEntry({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, adminCardMasterDependencies);
  } catch (error) {
    throwCallableError(error, 'Card Master add');
  }
});

export const editCardMasterEntry = onCall(async (request) => {
  try {
    return await handleEditCardMasterEntry({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, adminCardMasterDependencies);
  } catch (error) {
    throwCallableError(error, 'Card Master edit');
  }
});

export const disableCardMasterEntry = onCall(async (request) => {
  try {
    return await handleDisableCardMasterEntry({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, adminCardMasterDependencies);
  } catch (error) {
    throwCallableError(error, 'Card Master disable');
  }
});

export const mergeCardMasterEntries = onCall(async (request) => {
  try {
    return await handleMergeCardMasterEntries({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, adminCardMasterDependencies);
  } catch (error) {
    throwCallableError(error, 'Card Master merge');
  }
});

export const saveSellerProfile = onCall(async (request) => {
  try {
    return await handleSaveSellerProfile({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Seller profile save');
  }
});

export const getOwnSellerProfile = onCall(async (request) => {
  try {
    return await handleGetOwnSellerProfile({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Own seller profile read');
  }
});

export const getSellerContact = onCall(async (request) => {
  try {
    return await handleGetSellerContact({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Seller contact disclosure');
  }
});

function storedListingMutation(patch: ListingMutation | Record<string, unknown>): DocumentData {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    value === null ? FieldValue.delete() : value instanceof Date ? Timestamp.fromDate(value) : value,
  ]));
}

const listingLifecycleDependencies: ListingLifecycleDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: ListingLifecycleTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getListing(id) {
          const snapshot = await transaction.get(firestore.collection('listings').doc(id));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async hasSaleForListing(id) {
          const saleQuery = firestore.collection('sales').where('listingId', '==', id).limit(1);
          return !(await transaction.get(saleQuery)).empty;
        },
        createSale(id, sale) {
          transaction.create(firestore.collection('sales').doc(id), {
            ...sale,
            soldAt: Timestamp.fromDate(sale.soldAt),
          });
        },
        updateListing(id, patch) {
          transaction.update(
            firestore.collection('listings').doc(id),
            storedListingMutation(patch),
          );
        },
        deleteListing(id) {
          transaction.delete(firestore.collection('listings').doc(id));
        },
      };
      return operation(port);
    });
  },
};

export const recordListingSale = onCall(async (request) => {
  try {
    return await handleRecordListingSale({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing sale');
  }
});

export const updateSellerListing = onCall(async (request) => {
  try {
    return await handleUpdateSellerListing({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing update');
  }
});

export const deleteUnsoldListing = onCall(async (request) => {
  try {
    return await handleDeleteUnsoldListing({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing deletion');
  }
});

const createReportDraftDependencies: CreateReportDraftDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: CreateReportDraftTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async getListing(id) {
          const snapshot = await transaction.get(firestore.collection('listings').doc(id));
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async getRequestPointer(key) {
          const snapshot = await transaction.get(
            firestore.collection('moderationReportRequestKeys').doc(key),
          );
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async getReport(id) {
          const snapshot = await transaction.get(
            firestore.collection('moderationReports').doc(id),
          );
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async getDailyLimit(key) {
          const snapshot = await transaction.get(
            firestore.collection('moderationReportLimits').doc(key),
          );
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        createReport(id, data) {
          transaction.create(firestore.collection('moderationReports').doc(id), data);
        },
        createRequestPointer(key, data) {
          transaction.create(firestore.collection('moderationReportRequestKeys').doc(key), data);
        },
        setDailyLimit(key, data) {
          transaction.set(firestore.collection('moderationReportLimits').doc(key), data);
        },
      };
      return operation(port);
    });
  },
};

function getReportBucket() {
  return getStorage().bucket();
}

function isStorageObjectNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === '404' || code === 'storage/object-not-found';
}

function reportTransactionPort(
  transaction: FirebaseFirestore.Transaction,
): SubmitReportTransaction {
  return {
    async getAccountAccess(uid) {
      const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getReport(id) {
      const snapshot = await transaction.get(firestore.collection('moderationReports').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getCase(id) {
      const snapshot = await transaction.get(firestore.collection('moderationCases').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    setSubmittedReport(id, data) {
      transaction.set(firestore.collection('moderationReports').doc(id), data);
    },
    createOpenCase(id, data) {
      transaction.create(firestore.collection('moderationCases').doc(id), data);
    },
  };
}

const submitReportDependencies: SubmitReportDependencies = {
  now: () => new Date(),
  async getEvidenceMetadata(path) {
    try {
      const [metadata] = await getReportBucket().file(path).getMetadata();
      return metadata;
    } catch (error) {
      if (isStorageObjectNotFound(error)) return null;
      throw error;
    }
  },
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => (
      operation(reportTransactionPort(transaction))
    ));
  },
};

export const createModerationReportDraft = onCall(async (request) => {
  try {
    const result = await createReportDraft({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, createReportDraftDependencies);
    return { reportId: result.reportId, expiresAt: result.expiresAt.toDate().toISOString() };
  } catch (error) {
    throwCallableError(error, 'Moderation report draft creation');
  }
});

export const submitModerationReport = onCall(async (request) => {
  try {
    return await submitReport({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, submitReportDependencies);
  } catch (error) {
    throwCallableError(error, 'Moderation report submission');
  }
});

function accountAppealSubmissionPort(
  transaction: FirebaseFirestore.Transaction,
): AccountAppealSubmissionTransaction {
  const read = async (collectionName: string, id: string) => {
    const snapshot = await transaction.get(firestore.collection(collectionName).doc(id));
    return snapshot.exists ? snapshot.data() ?? null : null;
  };
  return {
    getAccountAccess: (uid) => read('accountAccess', uid),
    getOperation: (id) => read('accountModerationOperations', id),
    getAppeal: (id) => read('accountAppeals', id),
    getRequestPointer: (id) => read('accountAppealRequestKeys', id),
    getDailyLimit: (id) => read('accountAppealLimits', id),
    createAppeal(id, data) {
      transaction.create(firestore.collection('accountAppeals').doc(id), data);
    },
    createRequestPointer(id, data) {
      transaction.create(firestore.collection('accountAppealRequestKeys').doc(id), data);
    },
    setDailyLimit(id, data) {
      transaction.set(firestore.collection('accountAppealLimits').doc(id), data);
    },
    createAudit(id, data) {
      transaction.create(firestore.collection('accountAppealAuditLogs').doc(id), data);
    },
  };
}

const accountAppealSubmissionDependencies: AccountAppealSubmissionDependencies = {
  now: () => new Date(),
  async getEvidenceMetadata(path) {
    try {
      const [metadata] = await getReportBucket().file(path).getMetadata();
      const size = Number(metadata.size);
      return {
        generation: metadata.generation,
        contentType: metadata.contentType,
        size,
      };
    } catch (error) {
      if (isStorageObjectNotFound(error)) return null;
      throw error;
    }
  },
  async runTransaction(operation) {
    return firestore.runTransaction(
      (transaction) => operation(accountAppealSubmissionPort(transaction)),
    );
  },
};

function appealDto(appeal: StoredAccountAppeal | null) {
  if (appeal === null) return null;
  const common = {
    appealId: appeal.appealId,
    status: appeal.status,
    targetUid: appeal.targetUid,
    suspensionActionId: appeal.suspensionActionId,
    statement: appeal.statement,
    evidence: appeal.evidence.map(({ slot, contentType, size }) => ({ slot, contentType, size })),
    submittedAt: appeal.submittedAt.toDate().toISOString(),
    updatedAt: appeal.updatedAt.toDate().toISOString(),
  };
  return appeal.status === 'submitted' ? common : {
    ...common,
    decidedAt: appeal.decidedAt.toDate().toISOString(),
    decidedBy: appeal.decidedBy,
    decisionRationale: appeal.decisionRationale,
  };
}

export const getOwnAccountAppeal = onCall(async (request) => {
  try {
    const result = await getOwnAccountAppealData({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, {
      async getAccountAccess(uid) {
        const snapshot = await firestore.collection('accountAccess').doc(uid).get();
        return snapshot.exists ? snapshot.data() ?? null : null;
      },
      async getAppeal(id) {
        const snapshot = await firestore.collection('accountAppeals').doc(id).get();
        return snapshot.exists ? snapshot.data() ?? null : null;
      },
    });
    return { appeal: appealDto(result) };
  } catch (error) {
    throwCallableError(error, 'Own account appeal read');
  }
});

const accountAppealListDependencies: AccountAppealListDependencies = {
  getAccountAccess: getModerationAccountAccess,
  async listAppeals(input) {
    let query = firestore.collection('accountAppeals')
      .where('status', '==', input.status)
      .orderBy('submittedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(input.limit);
    if (input.cursor) {
      query = query.startAfter(Timestamp.fromMillis(input.cursor.submittedAt), input.cursor.key);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
  },
};

const accountAppealReadDependencies: AccountAppealReadDependencies = {
  getAccountAccess: getModerationAccountAccess,
  async getAppeal(id) {
    const snapshot = await firestore.collection('accountAppeals').doc(id).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
};

const accountAppealEvidenceDependencies: AccountAppealEvidenceDependencies = {
  ...accountAppealReadDependencies,
  async getEvidenceMetadata(path) {
    try {
      const [metadata] = await getReportBucket().file(path).getMetadata();
      return { generation: metadata.generation, contentType: metadata.contentType, size: metadata.size };
    } catch (error) {
      if (isStorageObjectNotFound(error)) return null;
      throw error;
    }
  },
  async downloadEvidence(path, generation) {
    const [bytes] = await getReportBucket().file(path, { generation }).download({ validation: 'md5' });
    return bytes;
  },
};

function accountAppealDecisionPort(
  transaction: FirebaseFirestore.Transaction,
): AccountAppealDecisionTransaction {
  const read = async (collectionName: string, id: string) => {
    const snapshot = await transaction.get(firestore.collection(collectionName).doc(id));
    return snapshot.exists ? snapshot.data() ?? null : null;
  };
  return {
    getAccountAccess: (uid) => read('accountAccess', uid),
    getAppeal: (id) => read('accountAppeals', id),
    getOperation: (id) => read('accountModerationOperations', id),
    updateAppeal(id, patch) {
      transaction.update(firestore.collection('accountAppeals').doc(id), patch);
    },
    setAccountAccess(uid, data) {
      transaction.set(firestore.collection('accountAccess').doc(uid), data);
    },
    updateOperation(id, patch) {
      transaction.update(firestore.collection('accountModerationOperations').doc(id), patch);
    },
    createAccountModerationAudit(id, data) {
      transaction.create(firestore.collection('accountModerationAuditLogs').doc(id), data);
    },
    createAppealAudit(id, data) {
      transaction.create(firestore.collection('accountAppealAuditLogs').doc(id), data);
    },
  };
}

const accountAppealDecisionDependencies: AccountAppealDecisionDependencies = {
  now: () => new Date(),
  async runTransaction(operation) {
    return firestore.runTransaction(
      (transaction) => operation(accountAppealDecisionPort(transaction)),
    );
  },
};

export const listAccountAppeals = onCall(async (request) => {
  try {
    return await listAccountAppealsData({
      authUid: request.auth?.uid ?? null, adminClaim: request.auth?.token.admin, data: request.data,
    }, accountAppealListDependencies);
  } catch (error) { throwCallableError(error, 'Account appeal list'); }
});

export const getAccountAppeal = onCall(async (request) => {
  try {
    return await getAccountAppealData({
      authUid: request.auth?.uid ?? null, adminClaim: request.auth?.token.admin, data: request.data,
    }, accountAppealReadDependencies);
  } catch (error) { throwCallableError(error, 'Account appeal detail'); }
});

export const getAccountAppealEvidence = onCall(async (request) => {
  try {
    return await getAccountAppealEvidenceData({
      authUid: request.auth?.uid ?? null, adminClaim: request.auth?.token.admin, data: request.data,
    }, accountAppealEvidenceDependencies);
  } catch (error) { throwCallableError(error, 'Account appeal evidence'); }
});

export const decideAccountAppeal = onCall(async (request) => {
  try {
    return await decideAccountAppealData({
      authUid: request.auth?.uid ?? null, adminClaim: request.auth?.token.admin, data: request.data,
    }, accountAppealDecisionDependencies);
  } catch (error) { throwCallableError(error, 'Account appeal decision'); }
});

export const submitAccountAppeal = onCall(async (request) => {
  try {
    const result = await submitAccountAppealData({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, accountAppealSubmissionDependencies);
    return { appeal: appealDto(result) };
  } catch (error) {
    throwCallableError(error, 'Account appeal submission');
  }
});

async function getModerationAccountAccess(uid: string) {
  const snapshot = await firestore.collection('accountAccess').doc(uid).get();
  return snapshot.exists ? snapshot.data() ?? null : null;
}

const moderationCaseListDependencies: ModerationCaseListDependencies = {
  getAccountAccess: getModerationAccountAccess,
  async listCases(input) {
    let query: FirebaseFirestore.Query = firestore.collection('moderationCases');
    if (input.status !== 'all') {
      query = query.where('status', '==', input.status);
    }
    query = query
      .orderBy('openedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(input.limit);
    if (input.cursor) {
      query = query.startAfter(Timestamp.fromMillis(input.cursor.openedAt), input.cursor.key);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
  },
  async getReports(ids) {
    const references = ids.map((id) => firestore.collection('moderationReports').doc(id));
    const snapshots = await firestore.getAll(...references);
    return snapshots.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.exists ? snapshot.data() ?? null : null,
    }));
  },
};

const moderationCaseDetailDependencies: ModerationCaseDetailDependencies = {
  getAccountAccess: getModerationAccountAccess,
  async getCase(id) {
    const snapshot = await firestore.collection('moderationCases').doc(id).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  async getReport(id) {
    const snapshot = await firestore.collection('moderationReports').doc(id).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  async getAccountModerationOperation(id) {
    const snapshot = await firestore.collection('accountModerationOperations').doc(id).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  async listAccountModerationAudit(targetUid, limit) {
    const snapshot = await firestore.collection('accountModerationAuditLogs')
      .where('targetUid', '==', targetUid)
      .orderBy('at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
  },
};

const moderationEvidenceDependencies: ModerationEvidenceDependencies = {
  ...moderationCaseDetailDependencies,
  async getEvidenceMetadata(path) {
    try {
      const [metadata] = await getReportBucket().file(path).getMetadata();
      return metadata;
    } catch (error) {
      if (isStorageObjectNotFound(error)) return null;
      throw error;
    }
  },
  async downloadEvidence(path, generation) {
    const [bytes] = await getReportBucket().file(path, { generation }).download({ validation: 'md5' });
    return bytes;
  },
};

function moderationDecisionPort(
  transaction: FirebaseFirestore.Transaction,
): ModerationDecisionTransaction {
  return {
    async getCase(id) {
      const snapshot = await transaction.get(firestore.collection('moderationCases').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getReport(id) {
      const snapshot = await transaction.get(firestore.collection('moderationReports').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getAccountAccess(uid) {
      const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    setCase(id, data) {
      transaction.set(firestore.collection('moderationCases').doc(id), data);
    },
    setAccountAccess(uid, data) {
      transaction.set(firestore.collection('accountAccess').doc(uid), data);
    },
  };
}

const moderationDecisionDependencies: ModerationDecisionDependencies = {
  now: () => new Date(),
  getAccountAccess: getModerationAccountAccess,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => (
      operation(moderationDecisionPort(transaction))
    ));
  },
};

function accountSuspensionPort(
  transaction: FirebaseFirestore.Transaction,
): AccountSuspensionTransaction {
  return {
    async getAccountAccess(uid) {
      const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getCase(id) {
      const snapshot = await transaction.get(firestore.collection('moderationCases').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getReport(id) {
      const snapshot = await transaction.get(firestore.collection('moderationReports').doc(id));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getOperation(id) {
      const snapshot = await transaction.get(
        firestore.collection('accountModerationOperations').doc(id),
      );
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    createOperation(id, data) {
      transaction.create(firestore.collection('accountModerationOperations').doc(id), data);
    },
    setAccountAccess(uid, data) {
      transaction.set(firestore.collection('accountAccess').doc(uid), data);
    },
    createAudit(id, data) {
      transaction.create(firestore.collection('accountModerationAuditLogs').doc(id), data);
    },
  };
}

const accountSuspensionDependencies: AccountSuspensionDependencies = {
  now: () => new Date(),
  async runTransaction(operation) {
    return firestore.runTransaction((transaction) => operation(accountSuspensionPort(transaction)));
  },
};

function accountReconciliationPort(
  transaction: FirebaseFirestore.Transaction,
): AccountModerationReconciliationTransaction {
  return {
    async getOperation(id) {
      const snapshot = await transaction.get(
        firestore.collection('accountModerationOperations').doc(id),
      );
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getAccountAccess(uid) {
      const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async listActiveListings(targetUid, limit) {
      const query = firestore.collection('listings')
        .where('sellerId', '==', targetUid)
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(limit);
      const snapshot = await transaction.get(query);
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: firestoreDataWithDates(document.data()),
      }));
    },
    updateListing(id, patch) {
      transaction.update(
        firestore.collection('listings').doc(id),
        storedListingMutation(patch),
      );
    },
    updateOperation(id, patch) {
      transaction.update(firestore.collection('accountModerationOperations').doc(id), patch);
    },
    createAudit(id, data) {
      transaction.create(firestore.collection('accountModerationAuditLogs').doc(id), data);
    },
  };
}

const accountReconciliationDependencies: AccountModerationReconciliationDependencies = {
  now: () => new Date(),
  async runTransaction(operation) {
    return firestore.runTransaction(
      (transaction) => operation(accountReconciliationPort(transaction)),
    );
  },
};

function accountRestorationPort(
  transaction: FirebaseFirestore.Transaction,
): AccountRestorationTransaction {
  const suspension = accountSuspensionPort(transaction);
  return {
    getAccountAccess: suspension.getAccountAccess,
    getCase: suspension.getCase,
    getReport: suspension.getReport,
    getOperation: suspension.getOperation,
    setAccountAccess: suspension.setAccountAccess,
    updateOperation(id, patch) {
      transaction.update(firestore.collection('accountModerationOperations').doc(id), patch);
    },
    createAudit: suspension.createAudit,
  };
}

const accountRestorationDependencies: AccountRestorationDependencies = {
  now: () => new Date(),
  async runTransaction(operation) {
    return firestore.runTransaction((transaction) => operation(accountRestorationPort(transaction)));
  },
};

function listingRepublishPort(
  transaction: FirebaseFirestore.Transaction,
): ListingRepublishTransaction {
  return {
    async getAccountAccess(uid) {
      const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getOperation(id) {
      const snapshot = await transaction.get(
        firestore.collection('accountModerationOperations').doc(id),
      );
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    async getListing(id) {
      const snapshot = await transaction.get(firestore.collection('listings').doc(id));
      return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
    },
    async getAudit(id) {
      const snapshot = await transaction.get(
        firestore.collection('accountModerationAuditLogs').doc(id),
      );
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    updateListing(id, patch) {
      transaction.update(
        firestore.collection('listings').doc(id),
        storedListingMutation(patch),
      );
    },
    createAudit(id, data) {
      transaction.create(firestore.collection('accountModerationAuditLogs').doc(id), data);
    },
  };
}

const listingRepublishDependencies: ListingRepublishDependencies = {
  now: () => new Date(),
  async runTransaction(operation) {
    return firestore.runTransaction((transaction) => operation(listingRepublishPort(transaction)));
  },
};

const ACCOUNT_MODERATION_RECONCILE_LIMIT = 10;

export const listModerationCases = onCall(async (request) => {
  try {
    return await listModerationCasesData({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, moderationCaseListDependencies);
  } catch (error) {
    throwCallableError(error, 'Moderation case list');
  }
});

export const getModerationCase = onCall(async (request) => {
  try {
    return await getModerationCaseData({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, moderationCaseDetailDependencies);
  } catch (error) {
    throwCallableError(error, 'Moderation case detail');
  }
});

export const getModerationEvidence = onCall(
  { memory: '256MiB', timeoutSeconds: 60, maxInstances: 5 },
  async (request) => {
    try {
      return await getModerationEvidenceData({
        authUid: request.auth?.uid ?? null,
        adminClaim: request.auth?.token.admin,
        data: request.data,
      }, moderationEvidenceDependencies);
    } catch (error) {
      throwCallableError(error, 'Moderation evidence retrieval');
    }
  },
);

export const decideModerationCase = onCall(async (request) => {
  try {
    return await decideModerationCaseData({
      authUid: request.auth?.uid ?? null,
      adminClaim: request.auth?.token.admin,
      data: request.data,
    }, moderationDecisionDependencies);
  } catch (error) {
    throwCallableError(error, 'Moderation case decision');
  }
});

export const suspendModerationTarget = onCall(
  { timeoutSeconds: 540, maxInstances: 5 },
  async (request) => {
    try {
      const opened = await suspendModerationTargetData({
        authUid: request.auth?.uid ?? null,
        adminClaim: request.auth?.token.admin,
        data: request.data,
      }, accountSuspensionDependencies);
      return await drainAccountModerationOperation(
        opened.actionId,
        (actionId) => reconcileAccountModerationOperation(
          actionId, accountReconciliationDependencies,
        ),
      );
    } catch (error) {
      throwCallableError(error, 'Account suspension');
    }
  },
);

export const restoreModerationTarget = onCall(
  { timeoutSeconds: 60, maxInstances: 5 },
  async (request) => {
    try {
      return await restoreModerationTargetData({
        authUid: request.auth?.uid ?? null,
        adminClaim: request.auth?.token.admin,
        data: request.data,
      }, accountRestorationDependencies);
    } catch (error) {
      throwCallableError(error, 'Account restoration');
    }
  },
);

export const republishSuspendedListing = onCall(
  { timeoutSeconds: 60, maxInstances: 5 },
  async (request) => {
    try {
      return await republishSuspendedListingData({
        authUid: request.auth?.uid ?? null,
        data: request.data,
      }, listingRepublishDependencies);
    } catch (error) {
      throwCallableError(error, 'Held Listing republish');
    }
  },
);

const reportCleanupDependencies: ReportCleanupDependencies = {
  now: () => new Date(),
  async listExpiredDrafts({ before, after, limit }) {
    let query = firestore.collection('moderationReports')
      .where('status', '==', 'draft')
      .where('expiresAt', '<=', before)
      .orderBy('expiresAt', 'asc')
      .orderBy(FieldPath.documentId())
      .limit(limit);
    if (after) query = query.startAfter(after.expiresAt, after.id);
    const snapshot = await query.get();
    const last = snapshot.docs.at(-1);
    const lastExpiresAt = last?.data().expiresAt;
    return {
      items: snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
      nextAfter: snapshot.docs.length === limit && last && lastExpiresAt instanceof Timestamp
        ? { expiresAt: lastExpiresAt, id: last.id }
        : null,
    };
  },
  async deleteEvidence(path) {
    await getReportBucket().file(path).delete();
  },
  isObjectNotFound: isStorageObjectNotFound,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: ReportCleanupTransaction = {
        async getReport(id) {
          const snapshot = await transaction.get(
            firestore.collection('moderationReports').doc(id),
          );
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        deleteReport(id) {
          transaction.delete(firestore.collection('moderationReports').doc(id));
        },
        deleteRequestPointer(key) {
          transaction.delete(firestore.collection('moderationReportRequestKeys').doc(key));
        },
      };
      return operation(port);
    });
  },
  log(entry) {
    if (entry.event === 'report_cleanup_failed') logError(entry.event, entry);
    else logInfo(entry.event, entry);
  },
};

function readDailyDeliveryRecord(data: DocumentData | undefined): DailyDigestDeliveryRecord {
  const cursorSequence = data?.emailDailyCursorSequence;
  const windowEndSequence = data?.emailDailyWindowEndSequence;
  const claimId = typeof data?.emailDailyClaimId === 'string'
    ? data.emailDailyClaimId as string
    : undefined;
  const storedClaimState = data?.emailDailyClaimState;
  const claimRunDate = typeof data?.emailDailyClaimRunDate === 'string'
    ? data.emailDailyClaimRunDate as string
    : undefined;
  const completedRunDate = typeof data?.emailDailyCompletedRunDate === 'string'
    ? data.emailDailyCompletedRunDate as string
    : undefined;
  return {
    ...(Number.isSafeInteger(cursorSequence) && cursorSequence >= 0
      ? { cursorSequence: cursorSequence as number }
      : {}),
    ...(claimId
      ? {
        claimId,
        claimState: storedClaimState === 'reserved' || storedClaimState === 'sending'
          ? storedClaimState
          : 'sending',
      }
      : {}),
    ...(claimRunDate ? { claimRunDate } : {}),
    ...(completedRunDate ? { completedRunDate } : {}),
    ...(data?.emailDailyReservedAt instanceof Timestamp
      ? { reservedAt: data.emailDailyReservedAt }
      : {}),
    ...(Number.isSafeInteger(windowEndSequence) && windowEndSequence >= 0
      ? { windowEndSequence: windowEndSequence as number }
      : {}),
  };
}

function writeDailyDeliveryRecord(record: DailyDigestDeliveryRecord): DocumentData {
  return {
    ...(record.cursorSequence !== undefined
      ? { emailDailyCursorSequence: record.cursorSequence }
      : {}),
    ...(record.claimId ? { emailDailyClaimId: record.claimId } : {}),
    ...(record.claimState ? { emailDailyClaimState: record.claimState } : {}),
    ...(record.claimRunDate ? { emailDailyClaimRunDate: record.claimRunDate } : {}),
    ...(record.completedRunDate
      ? { emailDailyCompletedRunDate: record.completedRunDate }
      : {}),
    ...(record.reservedAt ? { emailDailyReservedAt: record.reservedAt } : {}),
    ...(record.windowEndSequence !== undefined
      ? { emailDailyWindowEndSequence: record.windowEndSequence }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

const eventStore: Pick<ListingEventStore, 'create'> = {
  async create(event) {
    const eventReference = firestore.collection('listingEvents').doc(event.id);
    const sequenceReference = firestore
      .collection('notificationDigestRuntime')
      .doc('eventSequence');

    await firestore.runTransaction(async (transaction) => {
      const sequenceSnapshot = await transaction.get(sequenceReference);
      const storedSequence = sequenceSnapshot.data()?.lastSequence;
      const lastSequence = Number.isSafeInteger(storedSequence) && storedSequence >= 0
        ? storedSequence as number
        : 0;
      const capturedSequence = lastSequence + 1;
      if (!Number.isSafeInteger(capturedSequence)) {
        throw new Error('Listing event sequence is exhausted.');
      }

      transaction.create(eventReference, {
        ...event,
        capturedAt: FieldValue.serverTimestamp(),
        capturedSequence,
      });
      transaction.set(sequenceReference, {
        lastSequence: capturedSequence,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
};

const dailyDigestDependencies: DailyDigestDependencies = {
  subscriptions: {
    async listEmailDailyEnabled(afterUid, limit) {
      let query = firestore.collection('notificationSubscriptions')
        .where('emailDailyEnabled', '==', true)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterUid) {
        query = query.startAfter(afterUid);
      }
      const snapshot = await query.get();

      return snapshot.docs.map((document): NotificationSubscription => {
        const data = document.data();
        return {
          uid: document.id,
          cardNames: data.cardNames as string[],
          sellerSubscriptions: data.sellerSubscriptions,
          emailDailyEnabled: data.emailDailyEnabled as boolean,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(0),
        };
      });
    },
  },
  events: {
    async findNewInSequenceRange(afterSequence, throughSequence, limit) {
      const snapshot = await firestore.collection('listingEvents')
        .where('capturedSequence', '>', afterSequence)
        .where('capturedSequence', '<=', throughSequence)
        .orderBy('capturedSequence', 'asc')
        .limit(limit)
        .get();

      return readListingEventPage(
        snapshot.docs.map((document) => document.data()),
        afterSequence,
        limit,
      );
    },
  },
  deliveryState: {
    async claim(uid, claimId, reservedAt, windowEndSequence, runDate) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const claimed = reserveDailyDigestDelivery(
          current,
          claimId,
          reservedAt,
          windowEndSequence,
          runDate,
        );
        if (!claimed) {
          return null;
        }

        transaction.set(reference, writeDailyDeliveryRecord(claimed));

        return {
          claimId,
          afterSequence: current.cursorSequence ?? 0,
          throughSequence: claimed.windowEndSequence!,
        };
      });
    },
    async complete(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const completed = completeDailyDigestDelivery(current, claimId);
        if (!completed) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(completed));
      });
    },
    async completeWithoutSend(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const completed = completeDailyDigestWithoutSend(current, claimId);
        if (!completed) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(completed));
      });
    },
    async beginSend(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const sending = beginDailyDigestSend(current, claimId);
        if (!sending) {
          return false;
        }

        transaction.set(reference, writeDailyDeliveryRecord(sending));
        return true;
      });
    },
    async release(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const released = releaseDailyDigestDelivery(current, claimId);
        if (!released) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(released));
      });
    },
    async recover(uid, claimId, mode) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const recovered = recoverDailyDigestDelivery(current, claimId, mode);
        if (!recovered) {
          return false;
        }

        transaction.set(reference, writeDailyDeliveryRecord(recovered));
        return true;
      });
    },
  },
  batchState: {
    async getCursor() {
      const snapshot = await firestore.collection('notificationDigestRuntime').doc('scan').get();
      const cursor = snapshot.data()?.subscriptionCursor;
      return typeof cursor === 'string' ? cursor : null;
    },
    async advance(cursor) {
      await firestore.collection('notificationDigestRuntime').doc('scan').set({
        subscriptionCursor: cursor ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
  },
  runs: {
    async getOrCreate(runDate) {
      const runReference = firestore.collection('notificationDigestRuns').doc(runDate);
      const sequenceReference = firestore.collection('notificationDigestRuntime')
        .doc('eventSequence');
      return firestore.runTransaction(async (transaction) => {
        const [runSnapshot, sequenceSnapshot] = await transaction.getAll(
          runReference,
          sequenceReference,
        );
        if (runSnapshot.exists) {
          const storedRunDate = runSnapshot.data()?.runDate;
          const windowEndSequence = runSnapshot.data()?.windowEndSequence;
          if (storedRunDate !== runDate
            || !Number.isSafeInteger(windowEndSequence)
            || windowEndSequence < 0) {
            throw new Error(`Daily digest run ${runDate} is invalid.`);
          }
          return { runDate, windowEndSequence: windowEndSequence as number };
        }

        const lastSequence = sequenceSnapshot.data()?.lastSequence;
        const windowEndSequence = Number.isSafeInteger(lastSequence) && lastSequence >= 0
          ? lastSequence as number
          : 0;
        transaction.create(runReference, {
          runDate,
          windowEndSequence,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { runDate, windowEndSequence };
      });
    },
  },
  recipients: createRecipientDirectory(),
  gmail: createGmailClient(),
  recipientCap: DEFAULT_DAILY_RECIPIENT_CAP,
  createClaimId: randomUUID,
};

const dailyDigestOperatorDependencies: DailyDigestOperatorDependencies = {
  async listActiveClaims(limit) {
    const inspectedAt = new Date();
    const snapshot = await firestore.collection('notificationDeliveryState')
      .where('emailDailyClaimState', 'in', ['reserved', 'sending'])
      .limit(limit)
      .get();

    return snapshot.docs.flatMap((document) => {
      const record = readDailyDeliveryRecord(document.data());
      if (!record.claimId
        || (record.claimState !== 'reserved' && record.claimState !== 'sending')) {
        return [];
      }
      return [{
        uid: document.id,
        claimId: record.claimId,
        claimState: record.claimState,
        ...(record.claimRunDate ? { claimRunDate: record.claimRunDate } : {}),
        reservedAt: record.reservedAt?.toDate().toISOString() ?? null,
        staleReserved: isDailyDigestReservedClaimStale(record, inspectedAt),
        ...(record.cursorSequence !== undefined
          ? { cursorSequence: record.cursorSequence }
          : {}),
        ...(record.windowEndSequence !== undefined
          ? { windowEndSequence: record.windowEndSequence }
          : {}),
      }];
    });
  },
  recover: (uid, claimId, mode) => dailyDigestDependencies.deliveryState
    .recover(uid, claimId, mode),
};

export const dailyDigestOperator = onRequest(
  {
    invoker: 'private',
    timeoutSeconds: 30,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'POST is required.' });
      return;
    }

    try {
      const result = await handleDailyDigestOperatorRequest(
        request.body,
        dailyDigestOperatorDependencies,
      );
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof DailyDigestOperatorError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      logError('Daily digest operator request failed.', error);
      response.status(500).json({ error: 'Operator request failed.' });
    }
  },
);

export const captureListingEvent = onDocumentCreated(
  {
    document: 'listings/{listingId}',
    retry: true,
    timeoutSeconds: 60,
  },
  async (source) => {
    if (!source.data) {
      return;
    }

    const result = await captureListingEventData({
      params: { listingId: source.params.listingId },
      data: source.data.data(),
    }, { events: eventStore }, { discordEnabled: false });
    if (result.status === 'invalid') {
      logError('Listing event capture skipped a permanently invalid snapshot.', {
        listingId: source.params.listingId,
        reason: result.reason,
      });
    }
  },
);

export const sendDailyDigest = onSchedule(
  {
    ...DAILY_DIGEST_SCHEDULE_OPTIONS,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    timeoutSeconds: 540,
    secrets: [
      gmailOAuthClientId,
      gmailOAuthClientSecret,
      gmailOAuthRefreshToken,
      gmailSenderAddress,
    ],
  },
  async (event) => runDailyDigestData(
    new Date(event.scheduleTime),
    dailyDigestDependencies,
  ),
);

export const cleanupExpiredReportDrafts = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Asia/Taipei',
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    timeoutSeconds: 540,
  },
  async () => {
    const result = await cleanupExpiredReportDraftsData(reportCleanupDependencies);
    logInfo('Expired moderation report cleanup completed.', result);
  },
);

const appealCleanupDependencies: AppealCleanupDependencies = {
  now: () => new Date(),
  async listExpiredDraftEvidence({ before, after, limit }) {
    const [files, nextQuery] = await getReportBucket().getFiles({
      prefix: 'account-appeal-evidence/',
      maxResults: limit,
      ...(after ? { pageToken: after } : {}),
      autoPaginate: false,
    });
    return {
      items: files.flatMap((file) => {
        const createdAt = new Date(file.metadata.timeCreated ?? '');
        const generation = String(file.metadata.generation ?? '');
        return !Number.isNaN(createdAt.valueOf()) && createdAt.valueOf() <= before.valueOf()
          ? [{ path: file.name, generation, createdAt }]
          : [];
      }),
      nextAfter: typeof nextQuery?.pageToken === 'string' ? nextQuery.pageToken : null,
    };
  },
  async getAppealForAction(actionId) {
    const snapshot = await firestore.collection('accountAppeals').doc(accountAppealId(actionId)).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  async deleteEvidence(path, generation) {
    await getReportBucket().file(path, { generation }).delete({ ignoreNotFound: true });
  },
  isObjectNotFound: isStorageObjectNotFound,
  log(entry) {
    logInfo('Appeal draft cleanup item.', entry);
  },
};

export const cleanupExpiredAppealDrafts = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'Asia/Taipei',
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    timeoutSeconds: 540,
  },
  async () => {
    const result = await cleanupExpiredAppealDraftsData(appealCleanupDependencies);
    logInfo('Expired account appeal draft cleanup completed.', result);
  },
);

export const reconcileAccountModerationOperations = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'Asia/Taipei',
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const snapshot = await firestore.collection('accountModerationOperations')
      .where('status', '==', 'hiding')
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(ACCOUNT_MODERATION_RECONCILE_LIMIT)
      .get();
    const results = [];
    for (const document of snapshot.docs) {
      results.push(await drainAccountModerationOperation(
        document.id,
        (actionId) => reconcileAccountModerationOperation(
          actionId, accountReconciliationDependencies,
        ),
      ));
    }
    logInfo('Account moderation reconciliation completed.', {
      processedCount: results.length,
      pendingCount: results.filter(({ status }) => status === 'hiding').length,
    });
  },
);
