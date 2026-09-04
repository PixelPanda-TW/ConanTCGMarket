import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import {
  getPublicSellerProfile,
  getNotificationSubscription,
  removeNotificationCardName,
  removeNotificationSeller,
  setNotificationEmailDailyEnabled,
} from '../../data/firestore/repositories';
import type { NotificationSubscription, PublicSellerProfile } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';

interface CommittedAuthContext {
  uid: string | null;
  generation: number;
}

export function NotificationSettingsPage() {
  const {
    accountAccessState,
    isActiveAccount,
    isLoading: isAuthLoading,
    signIn,
    user,
  } = useAuth();
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [sellerProfiles, setSellerProfiles] = useState<Record<
    string,
    PublicSellerProfile | null | 'loading'
  >>({});
  const [sellerProfilesScope, setSellerProfilesScope] = useState<string | null>(null);
  const sellerProfileGenerationRef = useRef(0);
  const currentUid = isActiveAccount ? user?.uid ?? null : null;
  const committedContextRef = useRef<CommittedAuthContext>({ uid: currentUid, generation: 0 });
  const saveOperationContextRef = useRef<CommittedAuthContext | null>(null);
  const hasLoadedCurrentUid = currentUid !== null && loadedUid === currentUid;
  const contextualSubscription = hasLoadedCurrentUid ? subscription : null;
  const contextualIsSaving = hasLoadedCurrentUid ? isSaving : false;
  const contextualLoadError = hasLoadedCurrentUid ? loadError : false;
  const contextualSaveError = hasLoadedCurrentUid ? saveError : false;
  const isLoading = currentUid !== null && loadedUid !== currentUid;

  useLayoutEffect(() => {
    const committedContext: CommittedAuthContext = {
      uid: currentUid,
      generation: committedContextRef.current.generation + 1,
    };
    committedContextRef.current = committedContext;
    saveOperationContextRef.current = null;

    return () => {
      if (committedContextRef.current === committedContext) {
        committedContextRef.current = {
          uid: null,
          generation: committedContext.generation + 1,
        };
      }
    };
  }, [currentUid]);

  useEffect(() => {
    const requestContext = committedContextRef.current;
    setSubscription(null);
    setIsSaving(false);
    setLoadError(false);
    setSaveError(false);
    setLoadedUid(null);

    if (isAuthLoading || !user || !isActiveAccount) return;

    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (committedContextRef.current === requestContext) {
          setSubscription(loadedSubscription);
        }
      })
      .catch(() => {
        if (committedContextRef.current === requestContext) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (committedContextRef.current === requestContext) {
          setLoadedUid(user.uid);
        }
      });
  }, [currentUid, isActiveAccount, isAuthLoading, user]);

  const sellerSubscriptions = contextualSubscription?.sellerSubscriptions ?? [];
  const sellerSubscriptionKey = sellerSubscriptions.map((entry) => entry.sellerId).join('\u0000');
  const expectedSellerProfilesScope = currentUid === null
    ? null
    : `${currentUid}\u0000${sellerSubscriptionKey}`;

  useEffect(() => {
    const generation = ++sellerProfileGenerationRef.current;
    setSellerProfiles({});
    setSellerProfilesScope(null);
    if (!hasLoadedCurrentUid || currentUid === null) return;

    const entries = sellerSubscriptions.map((entry) => entry.sellerId);
    const initialProfiles: Record<string, PublicSellerProfile | null | 'loading'> = {};
    for (const sellerId of entries) initialProfiles[sellerId] = 'loading';
    setSellerProfiles(initialProfiles);
    setSellerProfilesScope(expectedSellerProfilesScope);
    void Promise.all(entries.map(async (sellerId) => {
      try {
        return [sellerId, await getPublicSellerProfile(sellerId)] as const;
      } catch {
        return [sellerId, null] as const;
      }
    })).then((profiles) => {
      if (sellerProfileGenerationRef.current === generation) {
        setSellerProfiles(Object.fromEntries(profiles));
      }
    });
  }, [currentUid, expectedSellerProfilesScope, hasLoadedCurrentUid, sellerSubscriptionKey]);

  async function persistSettings(
    mutation: () => Promise<NotificationSubscription | null>,
  ) {
    if (!user || !isActiveAccount) return;

    const requestContext = committedContextRef.current;
    if (saveOperationContextRef.current === requestContext) return;
    saveOperationContextRef.current = requestContext;

    setIsSaving(true);
    setSaveError(false);
    try {
      const nextSubscription = await mutation();
      if (committedContextRef.current === requestContext) {
        setSubscription(nextSubscription);
      }
    } catch {
      if (committedContextRef.current === requestContext) {
        setSaveError(true);
      }
    } finally {
      if (committedContextRef.current === requestContext) {
        setIsSaving(false);
      }
      if (saveOperationContextRef.current === requestContext) {
        saveOperationContextRef.current = null;
      }
    }
  }

  const cardNames = contextualSubscription?.cardNames ?? [];
  const sortedCardNames = [...cardNames]
    .sort((left, right) => left.localeCompare(right, 'zh-Hant'));
  const contextualSellerProfiles = sellerProfilesScope === expectedSellerProfilesScope
    ? sellerProfiles
    : {};
  const sortedSellers = sellerSubscriptions.map((entry) => {
    const profile = contextualSellerProfiles[entry.sellerId];
    return {
      sellerId: entry.sellerId,
      displayName: profile === 'loading'
        ? '賣家名稱載入中'
        : profile?.displayName ?? '無法取得賣家名稱',
    };
  }).sort((left, right) => (
    left.displayName.localeCompare(right.displayName, 'zh-Hant')
      || left.sellerId.localeCompare(right.sellerId)
  ));
  const emailDailyEnabled = contextualSubscription?.emailDailyEnabled ?? false;

  return (
    <PageShell backToMarketplace>
      <section className="notification-settings-page">
        <p className="eyebrow">Buyer subscriptions</p>
        <h1>我的訂閱</h1>

        {isAuthLoading ? (
          <p className="profile-state" role="status" aria-live="polite">登入狀態確認中</p>
        ) : !user ? (
          <div className="profile-state notification-sign-in-guidance">
            <p>請先使用 Google 登入，才能管理卡名訂閱。</p>
            <button type="button" onClick={signIn}>使用 Google 登入</button>
          </div>
        ) : !isActiveAccount ? (
          <AccountAccessNotice state={accountAccessState} />
        ) : isLoading ? (
          <p className="profile-state" role="status" aria-live="polite">我的訂閱載入中</p>
        ) : contextualLoadError ? (
          <p className="profile-state field-error" role="alert">無法載入訂閱，請稍後再試。</p>
        ) : (
          <div className="notification-settings-content">
            <section className="notification-settings-card" aria-labelledby="subscribed-card-names-heading">
              <h2 id="subscribed-card-names-heading">已訂閱卡名</h2>
              {cardNames.length === 0 ? (
                <p>尚未訂閱任何卡名。</p>
              ) : (
                <ul className="subscribed-card-name-list">
                  {sortedCardNames.map((cardName) => (
                    <li key={cardName}>
                      <span>{cardName}</span>
                      <button
                        type="button"
                        aria-label={`移除${cardName}訂閱`}
                        disabled={contextualIsSaving}
                        onClick={() => persistSettings(() => (
                          removeNotificationCardName(user.uid, cardName)
                        ))}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="notification-settings-card" aria-labelledby="subscribed-sellers-heading">
              <h2 id="subscribed-sellers-heading">已訂閱賣家</h2>
              {sellerSubscriptions.length === 0 ? (
                <p>尚未訂閱任何賣家。</p>
              ) : (
                <ul className="subscribed-seller-list">
                  {sortedSellers.map(({ sellerId, displayName }) => (
                    <li key={sellerId}>
                      <span>{displayName}</span>
                      <small>{sellerId}</small>
                      <button
                        type="button"
                        aria-label={`移除賣家 ${displayName}（${sellerId}）訂閱`}
                        disabled={contextualIsSaving}
                        onClick={() => persistSettings(() => (
                          removeNotificationSeller(user.uid, sellerId)
                        ))}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="notification-settings-card" aria-labelledby="daily-email-heading">
              <h2 id="daily-email-heading">每日彙整通知</h2>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={emailDailyEnabled}
                  disabled={contextualIsSaving}
                  onChange={(event) => persistSettings(() => (
                    setNotificationEmailDailyEnabled(user.uid, event.target.checked)
                  ))}
                />
                每日彙整 Email 通知
              </label>
              <p>每日彙整你所訂閱卡名與賣家的新上架商品。</p>
            </section>

            <div className="subscription-feedback" aria-live="polite" aria-atomic="true">
              {contextualIsSaving && <p role="status">訂閱儲存中</p>}
              {contextualSaveError && <p className="field-error" role="alert">無法儲存訂閱，請稍後再試。</p>}
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
