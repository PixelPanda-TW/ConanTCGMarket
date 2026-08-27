import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import {
  getNotificationSubscription,
  saveNotificationSubscription,
} from '../../data/firestore/repositories';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

interface CommittedAuthContext {
  uid: string | null;
  generation: number;
}

export function NotificationSettingsPage() {
  const { isLoading: isAuthLoading, signIn, user } = useAuth();
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const currentUid = user?.uid ?? null;
  const committedContextRef = useRef<CommittedAuthContext>({ uid: currentUid, generation: 0 });
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

    if (isAuthLoading || !user) return;

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
  }, [currentUid, isAuthLoading]);

  async function persistSettings(cardNames: string[], emailDailyEnabled: boolean) {
    if (!user) return;

    const nextSubscription: NotificationSubscription = {
      uid: user.uid,
      cardNames,
      emailDailyEnabled,
      updatedAt: new Date(),
    };
    const requestContext = committedContextRef.current;

    setIsSaving(true);
    setSaveError(false);
    try {
      await saveNotificationSubscription(nextSubscription);
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
    }
  }

  const cardNames = contextualSubscription?.cardNames ?? [];
  const sortedCardNames = [...cardNames]
    .sort((left, right) => left.localeCompare(right, 'zh-Hant'));
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
                        onClick={() => persistSettings(
                          cardNames.filter((name) => name !== cardName),
                          emailDailyEnabled,
                        )}
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
                  onChange={(event) => persistSettings(cardNames, event.target.checked)}
                />
                每日彙整 Email 通知
              </label>
              <p>每日彙整你所訂閱卡名的新上架商品。</p>
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
