import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  addNotificationCardName,
  getNotificationSubscription,
  removeNotificationCardName,
} from '../../data/firestore/repositories';
import { findCoveringSubscription } from '../../domain/cardNameSubscription';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

export interface CardNameSubscriptionControlProps {
  cardName: string;
  isKnownCardName: boolean;
}

interface CommittedSubscriptionContext {
  key: string | null;
  generation: number;
}

export function CardNameSubscriptionControl({
  cardName,
  isKnownCardName,
}: CardNameSubscriptionControlProps) {
  const {
    accountAccessState,
    isActiveAccount,
    isLoading: isAuthLoading,
    signIn,
    user,
  } = useAuth();
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [loadedSubscriptionContext, setLoadedSubscriptionContext] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingSubscription, setIsConfirmingSubscription] = useState(false);
  const [emailDeliverySelected, setEmailDeliverySelected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showSignInGuidance, setShowSignInGuidance] = useState(false);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const managementLinkRef = useRef<HTMLAnchorElement>(null);
  const subscriptionContext = isKnownCardName && user && isActiveAccount
    ? `${user.uid}\u0000${cardName}`
    : null;
  const committedContextRef = useRef<CommittedSubscriptionContext>({
    key: subscriptionContext,
    generation: 0,
  });
  const saveOperationContextRef = useRef<CommittedSubscriptionContext | null>(null);
  const isSubscriptionLoading = subscriptionContext !== null
    && loadedSubscriptionContext !== subscriptionContext;
  const hasLoadedSubscriptionContext = loadedSubscriptionContext === subscriptionContext;
  const contextualSubscription = hasLoadedSubscriptionContext ? subscription : null;
  const contextualLoadError = hasLoadedSubscriptionContext ? loadError : null;
  const contextualSaveError = subscriptionContext && hasLoadedSubscriptionContext ? saveError : null;
  const contextualSaveSuccess = subscriptionContext && hasLoadedSubscriptionContext ? saveSuccess : null;
  const contextualIsSaving = hasLoadedSubscriptionContext ? isSaving : false;
  const contextualIsConfirming = hasLoadedSubscriptionContext ? isConfirmingSubscription : false;
  const contextualEmailDeliverySelected = hasLoadedSubscriptionContext ? emailDeliverySelected : false;
  const contextualShowSignInGuidance = hasLoadedSubscriptionContext ? showSignInGuidance : false;

  useLayoutEffect(() => {
    const committedContext: CommittedSubscriptionContext = {
      key: subscriptionContext,
      generation: committedContextRef.current.generation + 1,
    };
    committedContextRef.current = committedContext;
    saveOperationContextRef.current = null;

    return () => {
      if (committedContextRef.current === committedContext) {
        committedContextRef.current = {
          key: null,
          generation: committedContext.generation + 1,
        };
      }
    };
  }, [subscriptionContext]);

  useEffect(() => {
    if (contextualSaveSuccess) {
      (actionButtonRef.current ?? managementLinkRef.current)?.focus();
    }
  }, [contextualSaveSuccess]);

  useEffect(() => {
    const requestContext = committedContextRef.current;
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
        if (committedContextRef.current === requestContext) {
          setSubscription(loadedSubscription);
        }
      })
      .catch(() => {
        if (committedContextRef.current === requestContext) {
          setLoadError('無法讀取卡名通知，請稍後再試。');
        }
      })
      .finally(() => {
        if (committedContextRef.current === requestContext) {
          setLoadedSubscriptionContext(subscriptionContext);
        }
      });
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
    if (!isActiveAccount) return;

    if (!exactSubscription) {
      setIsConfirmingSubscription(true);
      return;
    }

    await persistSubscription(
      () => removeNotificationCardName(user.uid, cardName),
      `已取消訂閱「${cardName}」。`,
    );
  }

  async function confirmSubscription() {
    if (!user || !isActiveAccount || !emailDeliverySelected) return;

    await persistSubscription(
      () => addNotificationCardName(user.uid, cardName),
      `已訂閱「${cardName}」的每日摘要通知。`,
    );
  }

  async function persistSubscription(
    mutation: () => Promise<NotificationSubscription | null>,
    successMessage: string,
  ) {
    if (!user || !isActiveAccount) return;

    const requestContext = committedContextRef.current;
    if (saveOperationContextRef.current === requestContext) return;
    saveOperationContextRef.current = requestContext;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const nextSubscription = await mutation();
      if (committedContextRef.current === requestContext) {
        setSubscription(nextSubscription);
        setIsConfirmingSubscription(false);
        setSaveSuccess(successMessage);
      }
    } catch {
      if (committedContextRef.current === requestContext) {
        setSaveError('無法更新卡名通知，請稍後再試。');
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

  if (isAuthLoading || isSubscriptionLoading) {
    return <p className="subscription-status" aria-live="polite">卡名通知載入中</p>;
  }

  if (user && !isActiveAccount) {
    const message = accountAccessState.state === 'suspended'
      ? '帳號停權期間無法管理卡名通知。'
      : accountAccessState.state === 'unavailable'
        ? accountAccessState.message
        : '帳號狀態確認中。';
    return <p className="subscription-status" role="status" aria-live="polite">{message}</p>;
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
        <a
          ref={managementLinkRef}
          className="subscription-management-link"
          href="#/notifications"
        >
          管理我的訂閱
        </a>
        <div className="subscription-feedback" aria-live="polite" aria-atomic="true">
          {contextualSaveSuccess && <p className="save-success">{contextualSaveSuccess}</p>}
          {contextualSaveError && <p className="field-error" role="alert">{contextualSaveError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="card-name-subscription-control">
      <button ref={actionButtonRef} type="button" onClick={toggleSubscription} disabled={contextualIsSaving}>
        {contextualIsSaving && exactSubscription
          ? '儲存中'
          : exactSubscription ? `取消訂閱${cardName}` : `訂閱${cardName}`}
      </button>
      {contextualIsConfirming && (
        <section className="subscription-confirmation" aria-labelledby="subscription-confirmation-heading">
          <h2 id="subscription-confirmation-heading">選擇通知方式</h2>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={contextualEmailDeliverySelected}
              disabled={contextualIsSaving}
              onChange={(event) => setEmailDeliverySelected(event.target.checked)}
            />
            以 Google 登入信箱接收每日摘要
          </label>
          <p>寄送至你的 Google 登入信箱（已驗證）</p>
          <div className="subscription-confirmation-actions">
            <button
              type="button"
              onClick={confirmSubscription}
              disabled={!contextualEmailDeliverySelected || contextualIsSaving}
            >
              {contextualIsSaving ? '儲存中' : '確認訂閱'}
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={contextualIsSaving}
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
      {contextualShowSignInGuidance && (
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
