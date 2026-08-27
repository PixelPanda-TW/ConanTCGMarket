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
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showSignInGuidance, setShowSignInGuidance] = useState(false);
  const activeContextRef = useRef(0);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const subscriptionContext = isKnownCardName && user
    ? `${user.uid}\u0000${cardName}`
    : null;
  const renderedSubscriptionContextRef = useRef(subscriptionContext);
  renderedSubscriptionContextRef.current = subscriptionContext;
  const isSubscriptionLoading = subscriptionContext !== null
    && loadedSubscriptionContext !== subscriptionContext;
  const hasLoadedSubscriptionContext = loadedSubscriptionContext === subscriptionContext;
  const contextualSubscription = hasLoadedSubscriptionContext ? subscription : null;
  const contextualLoadError = hasLoadedSubscriptionContext ? loadError : null;
  const contextualSaveError = subscriptionContext && hasLoadedSubscriptionContext ? saveError : null;
  const contextualSaveSuccess = subscriptionContext && hasLoadedSubscriptionContext ? saveSuccess : null;

  useEffect(() => {
    if (contextualSaveSuccess) actionButtonRef.current?.focus();
  }, [contextualSaveSuccess]);

  useEffect(() => {
    const requestContext = activeContextRef.current + 1;
    activeContextRef.current = requestContext;
    setSubscription(null);
    setIsSaving(false);
    setIsConfirmingSubscription(false);
    setEmailDeliverySelected(false);
    setLoadError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setShowSignInGuidance(false);
    setLoadedSubscriptionContext(null);

    if (!subscriptionContext || !user) return;

    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (
          activeContextRef.current === requestContext
          && renderedSubscriptionContextRef.current === subscriptionContext
        ) {
          setSubscription(loadedSubscription);
        }
      })
      .catch(() => {
        if (
          activeContextRef.current === requestContext
          && renderedSubscriptionContextRef.current === subscriptionContext
        ) {
          setLoadError('無法讀取卡名通知，請稍後再試。');
        }
      })
      .finally(() => {
        if (
          activeContextRef.current === requestContext
          && renderedSubscriptionContextRef.current === subscriptionContext
        ) {
          setLoadedSubscriptionContext(subscriptionContext);
        }
      });

    return () => {
      if (activeContextRef.current === requestContext) activeContextRef.current += 1;
    };
  }, [subscriptionContext]);

  if (!isKnownCardName) return null;

  const exactSubscription = contextualSubscription?.cardNames.includes(cardName) ?? false;
  const coveringName = findCoveringSubscription(contextualSubscription?.cardNames ?? [], cardName);
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
      (contextualSubscription?.cardNames ?? []).filter((name) => name !== cardName),
      contextualSubscription?.emailDailyEnabled ?? false,
      `已取消訂閱「${cardName}」。`,
    );
  }

  async function confirmSubscription() {
    if (!user || !emailDeliverySelected) return;

    await persistSubscription(
      [...(contextualSubscription?.cardNames ?? []), cardName],
      true,
      `已訂閱「${cardName}」的每日摘要通知。`,
    );
  }

  async function persistSubscription(
    cardNames: string[],
    emailDailyEnabled: boolean,
    successMessage: string,
  ) {
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
    setSaveSuccess(null);
    try {
      await saveNotificationSubscription(nextSubscription);
      if (
        activeContextRef.current === requestContext
        && renderedSubscriptionContextRef.current === subscriptionContext
      ) {
        setSubscription(nextSubscription);
        setIsConfirmingSubscription(false);
        setSaveSuccess(successMessage);
      }
    } catch {
      if (
        activeContextRef.current === requestContext
        && renderedSubscriptionContextRef.current === subscriptionContext
      ) {
        setSaveError('無法更新卡名通知，請稍後再試。');
      }
    } finally {
      if (
        activeContextRef.current === requestContext
        && renderedSubscriptionContextRef.current === subscriptionContext
      ) {
        setIsSaving(false);
      }
    }
  }

  if (isAuthLoading || isSubscriptionLoading) {
    return <p className="subscription-status" aria-live="polite">卡名通知載入中</p>;
  }

  if (contextualLoadError) {
    return <p className="field-error subscription-status" role="alert">{contextualLoadError}</p>;
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
      <button ref={actionButtonRef} type="button" onClick={toggleSubscription} disabled={isSaving}>
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
      <div className="subscription-feedback" aria-live="polite" aria-atomic="true">
        {contextualSaveSuccess && <p className="save-success">{contextualSaveSuccess}</p>}
        {contextualSaveError && <p className="field-error" role="alert">{contextualSaveError}</p>}
      </div>
    </div>
  );
}
