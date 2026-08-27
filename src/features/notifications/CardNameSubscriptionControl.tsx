import { useEffect, useRef, useState } from 'react';
import {
  getNotificationSubscription,
  saveNotificationSubscription,
} from '../../data/firestore/repositories';
import { findCoveringSubscription } from '../../domain/cardNameSubscription';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

export interface CardNameSubscriptionControlProps {
  cardName: string;
  isKnownCardName: boolean;
}

export function CardNameSubscriptionControl({
  cardName,
  isKnownCardName,
}: CardNameSubscriptionControlProps) {
  const { isLoading: isAuthLoading, signIn, user } = useAuth();
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [loadedSubscriptionContext, setLoadedSubscriptionContext] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingSubscription, setIsConfirmingSubscription] = useState(false);
  const [emailDeliverySelected, setEmailDeliverySelected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSignInGuidance, setShowSignInGuidance] = useState(false);
  const activeContextRef = useRef(0);
  const subscriptionContext = isKnownCardName && user
    ? `${user.uid}\u0000${cardName}`
    : null;
  const isSubscriptionLoading = subscriptionContext !== null
    && loadedSubscriptionContext !== subscriptionContext;

  useEffect(() => {
    const requestContext = activeContextRef.current + 1;
    activeContextRef.current = requestContext;
    setSubscription(null);
    setIsSaving(false);
    setIsConfirmingSubscription(false);
    setEmailDeliverySelected(false);
    setLoadError(null);
    setSaveError(null);
    setShowSignInGuidance(false);
    setLoadedSubscriptionContext(null);

    if (!subscriptionContext || !user) return;

    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (activeContextRef.current === requestContext) setSubscription(loadedSubscription);
      })
      .catch(() => {
        if (activeContextRef.current === requestContext) {
          setLoadError('無法讀取卡名通知，請稍後再試。');
        }
      })
      .finally(() => {
        if (activeContextRef.current === requestContext) {
          setLoadedSubscriptionContext(subscriptionContext);
        }
      });

    return () => {
      if (activeContextRef.current === requestContext) activeContextRef.current += 1;
    };
  }, [subscriptionContext]);

  if (!isKnownCardName) return null;

  const exactSubscription = subscription?.cardNames.includes(cardName) ?? false;
  const coveringName = findCoveringSubscription(subscription?.cardNames ?? [], cardName);
  const coveredByAnotherName = coveringName !== undefined && coveringName !== cardName;

  async function toggleSubscription() {
    if (!user) {
      setShowSignInGuidance(true);
      return;
    }

    if (!exactSubscription) {
      setIsConfirmingSubscription(true);
      return;
    }

    await persistSubscription(
      (subscription?.cardNames ?? []).filter((name) => name !== cardName),
      subscription?.emailDailyEnabled ?? false,
    );
  }

  async function confirmSubscription() {
    if (!user || !emailDeliverySelected) return;

    await persistSubscription([...(subscription?.cardNames ?? []), cardName], true);
  }

  async function persistSubscription(cardNames: string[], emailDailyEnabled: boolean) {
    if (!user) return;

    const nextSubscription: NotificationSubscription = {
      uid: user.uid,
      cardNames,
      emailDailyEnabled,
      updatedAt: new Date(),
    };
    const requestContext = activeContextRef.current;

    setIsSaving(true);
    setSaveError(null);
    try {
      await saveNotificationSubscription(nextSubscription);
      if (activeContextRef.current === requestContext) {
        setSubscription(nextSubscription);
        setIsConfirmingSubscription(false);
      }
    } catch {
      if (activeContextRef.current === requestContext) {
        setSaveError('無法更新卡名通知，請稍後再試。');
      }
    } finally {
      if (activeContextRef.current === requestContext) setIsSaving(false);
    }
  }

  if (isAuthLoading || isSubscriptionLoading) {
    return <p className="subscription-status" aria-live="polite">卡名通知載入中</p>;
  }

  if (loadError) {
    return <p className="field-error subscription-status" role="alert">{loadError}</p>;
  }

  if (coveredByAnotherName) {
    return (
      <div className="card-name-subscription-control">
        <p className="subscription-coverage" aria-live="polite">
          已由「{coveringName}」訂閱涵蓋
        </p>
        <a className="subscription-management-link" href="#/notifications">管理我的訂閱</a>
      </div>
    );
  }

  return (
    <div className="card-name-subscription-control">
      <button type="button" onClick={toggleSubscription} disabled={isSaving}>
        {isSaving && exactSubscription
          ? '儲存中'
          : exactSubscription ? `取消訂閱${cardName}` : `訂閱${cardName}`}
      </button>
      {isConfirmingSubscription && (
        <section className="subscription-confirmation" aria-labelledby="subscription-confirmation-heading">
          <h2 id="subscription-confirmation-heading">選擇通知方式</h2>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={emailDeliverySelected}
              disabled={isSaving}
              onChange={(event) => setEmailDeliverySelected(event.target.checked)}
            />
            以 Google 登入信箱接收每日摘要
          </label>
          <p>寄送至你的 Google 登入信箱（已驗證）</p>
          <div className="subscription-confirmation-actions">
            <button
              type="button"
              onClick={confirmSubscription}
              disabled={!emailDeliverySelected || isSaving}
            >
              {isSaving ? '儲存中' : '確認訂閱'}
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={isSaving}
              onClick={() => {
                setIsConfirmingSubscription(false);
                setEmailDeliverySelected(false);
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}
      {showSignInGuidance && (
        <div className="subscription-sign-in-guidance">
          <p>登入後即可訂閱卡名通知</p>
          <button type="button" onClick={signIn}>使用 Google 登入</button>
        </div>
      )}
      <div className="subscription-feedback" aria-live="polite">
        {saveError && <p className="field-error" role="alert">{saveError}</p>}
      </div>
    </div>
  );
}
