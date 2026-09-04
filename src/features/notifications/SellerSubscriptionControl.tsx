import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  addNotificationSeller,
  getNotificationSubscription,
  removeNotificationSeller,
} from '../../data/firestore/repositories';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

export interface SellerSubscriptionControlProps {
  sellerId: string;
  sellerName: string;
}

interface CommittedSubscriptionContext {
  key: string | null;
  generation: number;
}

export function SellerSubscriptionControl({
  sellerId,
  sellerName,
}: SellerSubscriptionControlProps) {
  const {
    accountAccessState,
    isActiveAccount,
    isLoading: isAuthLoading,
    signIn,
    user,
  } = useAuth();
  const isOwner = user?.uid === sellerId;
  const subscriptionContext = user && isActiveAccount && !isOwner
    ? `${user.uid}\u0000${sellerId}`
    : null;
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [emailSelected, setEmailSelected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showSignInGuidance, setShowSignInGuidance] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const committedContextRef = useRef<CommittedSubscriptionContext>({
    key: subscriptionContext,
    generation: 0,
  });
  const saveContextRef = useRef<CommittedSubscriptionContext | null>(null);
  const hasLoadedContext = loadedContext === subscriptionContext;
  const contextualSubscription = hasLoadedContext ? subscription : null;
  const contextualIsSaving = hasLoadedContext ? isSaving : false;
  const contextualIsConfirming = hasLoadedContext ? isConfirming : false;
  const contextualEmailSelected = hasLoadedContext ? emailSelected : false;
  const contextualLoadError = hasLoadedContext ? loadError : null;
  const contextualSaveError = hasLoadedContext ? saveError : null;
  const contextualSaveSuccess = hasLoadedContext ? saveSuccess : null;
  const contextualSignInGuidance = hasLoadedContext ? showSignInGuidance : false;
  const isSubscriptionLoading = subscriptionContext !== null && !hasLoadedContext;

  useLayoutEffect(() => {
    const committedContext = {
      key: subscriptionContext,
      generation: committedContextRef.current.generation + 1,
    };
    committedContextRef.current = committedContext;
    saveContextRef.current = null;
    return () => {
      if (committedContextRef.current === committedContext) {
        committedContextRef.current = { key: null, generation: committedContext.generation + 1 };
      }
    };
  }, [subscriptionContext]);

  useEffect(() => {
    if (contextualSaveSuccess) actionRef.current?.focus();
  }, [contextualSaveSuccess]);

  useEffect(() => {
    const requestContext = committedContextRef.current;
    setSubscription(null);
    setLoadedContext(null);
    setIsSaving(false);
    setIsConfirming(false);
    setEmailSelected(false);
    setLoadError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setShowSignInGuidance(false);

    if (!subscriptionContext || !user) return;
    void getNotificationSubscription(user.uid)
      .then((value) => {
        if (committedContextRef.current === requestContext) setSubscription(value);
      })
      .catch(() => {
        if (committedContextRef.current === requestContext) {
          setLoadError('無法讀取賣家通知，請稍後再試。');
        }
      })
      .finally(() => {
        if (committedContextRef.current === requestContext) setLoadedContext(subscriptionContext);
      });
  }, [subscriptionContext]);

  if (isOwner) return null;

  const isFollowed = contextualSubscription?.sellerSubscriptions
    .some((entry) => entry.sellerId === sellerId) ?? false;

  async function persist(
    mutation: () => Promise<NotificationSubscription | null>,
    successMessage: string,
  ) {
    if (!user || !isActiveAccount) return;
    const requestContext = committedContextRef.current;
    if (saveContextRef.current === requestContext) return;
    saveContextRef.current = requestContext;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const next = await mutation();
      if (committedContextRef.current === requestContext) {
        setSubscription(next);
        setIsConfirming(false);
        setSaveSuccess(successMessage);
      }
    } catch {
      if (committedContextRef.current === requestContext) {
        setSaveError('無法更新賣家通知，請稍後再試。');
      }
    } finally {
      if (committedContextRef.current === requestContext) setIsSaving(false);
      if (saveContextRef.current === requestContext) saveContextRef.current = null;
    }
  }

  async function toggle() {
    if (!user) {
      setShowSignInGuidance(true);
      return;
    }
    if (!isActiveAccount) return;
    if (!isFollowed) {
      setIsConfirming(true);
      return;
    }
    await persist(
      () => removeNotificationSeller(user.uid, sellerId),
      `已取消訂閱賣家「${sellerName}」。`,
    );
  }

  async function confirm() {
    if (!user || !isActiveAccount || !emailSelected) return;
    await persist(
      () => addNotificationSeller(user.uid, sellerId),
      `已訂閱賣家「${sellerName}」的每日摘要通知。`,
    );
  }

  if (isAuthLoading || isSubscriptionLoading) {
    return <p className="subscription-status" aria-live="polite">賣家通知載入中</p>;
  }
  if (user && !isActiveAccount) {
    const message = accountAccessState.state === 'suspended'
      ? '帳號停權期間無法管理賣家通知。'
      : accountAccessState.state === 'unavailable'
        ? accountAccessState.message
        : '帳號狀態確認中。';
    return <p className="subscription-status" role="status" aria-live="polite">{message}</p>;
  }
  if (contextualLoadError) {
    return <p className="field-error subscription-status" role="alert">{contextualLoadError}</p>;
  }

  return (
    <div className="seller-subscription-control">
      <button ref={actionRef} type="button" onClick={toggle} disabled={contextualIsSaving}>
        {contextualIsSaving && isFollowed
          ? '儲存中'
          : isFollowed ? `取消訂閱賣家 ${sellerName}` : `訂閱賣家 ${sellerName}`}
      </button>
      {contextualIsConfirming && (
        <section className="subscription-confirmation" aria-labelledby="seller-subscription-heading">
          <h2 id="seller-subscription-heading">訂閱賣家每日摘要</h2>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={contextualEmailSelected}
              disabled={contextualIsSaving}
              onChange={(event) => setEmailSelected(event.target.checked)}
            />
            以 Google 登入信箱接收每日摘要
          </label>
          <p>寄送至你的 Google 登入信箱（已驗證）</p>
          <div className="subscription-confirmation-actions">
            <button type="button" onClick={confirm} disabled={!contextualEmailSelected || contextualIsSaving}>
              {contextualIsSaving ? '儲存中' : '確認訂閱'}
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={contextualIsSaving}
              onClick={() => {
                setIsConfirming(false);
                setEmailSelected(false);
                actionRef.current?.focus();
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}
      {contextualSignInGuidance && (
        <div className="subscription-sign-in-guidance">
          <p>登入後即可訂閱賣家每日摘要</p>
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
