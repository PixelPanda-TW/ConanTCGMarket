import { useEffect, useRef, useState } from 'react';
import {
  getNotificationSubscription,
  saveNotificationSubscription,
} from '../../data/firestore/repositories';
import { toCharacterKey } from '../../domain/characterKey';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

export interface CharacterSubscriptionControlProps {
  characterName: string;
  isKnownCharacter: boolean;
}

export function CharacterSubscriptionControl({
  characterName,
  isKnownCharacter,
}: CharacterSubscriptionControlProps) {
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
  const characterKey = isKnownCharacter ? toCharacterKey(characterName) : '';
  const subscriptionContext = isKnownCharacter && user
    ? `${user.uid}\u0000${characterKey}`
    : null;
  const isSubscriptionLoading = subscriptionContext !== null
    && loadedSubscriptionContext !== subscriptionContext;

  useEffect(() => {
    activeContextRef.current += 1;
    let isCurrent = true;
    setSubscription(null);
    setIsSaving(false);
    setIsConfirmingSubscription(false);
    setEmailDeliverySelected(false);
    setLoadError(null);
    setSaveError(null);
    setShowSignInGuidance(false);
    setLoadedSubscriptionContext(null);

    if (!subscriptionContext || !user) {
      return () => {
        isCurrent = false;
      };
    }

    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (isCurrent) setSubscription(loadedSubscription);
      })
      .catch(() => {
        if (isCurrent) setLoadError('無法讀取角色通知，請稍後再試。');
      })
      .finally(() => {
        if (isCurrent) setLoadedSubscriptionContext(subscriptionContext);
      });

    return () => {
      isCurrent = false;
      activeContextRef.current += 1;
    };
  }, [subscriptionContext]);

  if (!isKnownCharacter) return null;

  const isSubscribed = subscription?.characterKeys.includes(characterKey) ?? false;

  async function toggleSubscription() {
    if (!user) {
      setShowSignInGuidance(true);
      return;
    }

    if (!isSubscribed) {
      setIsConfirmingSubscription(true);
      return;
    }

    await persistSubscription(
      (subscription?.characterKeys ?? []).filter((key) => key !== characterKey),
      subscription?.emailDailyEnabled ?? false,
    );
  }

  async function confirmSubscription() {
    if (!user || !emailDeliverySelected) return;

    await persistSubscription([...(subscription?.characterKeys ?? []), characterKey], true);
  }

  async function persistSubscription(characterKeys: string[], emailDailyEnabled: boolean) {
    if (!user) return;

    const nextSubscription: NotificationSubscription = {
      uid: user.uid,
      characterKeys,
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
        setSaveError('無法更新角色通知，請稍後再試。');
      }
    } finally {
      if (activeContextRef.current === requestContext) setIsSaving(false);
    }
  }

  if (isAuthLoading || isSubscriptionLoading) {
    return <p className="subscription-status" aria-live="polite">角色通知載入中</p>;
  }

  if (loadError) {
    return <p className="field-error subscription-status" role="alert">{loadError}</p>;
  }

  return (
    <div className="character-subscription-control">
      <button type="button" onClick={toggleSubscription} disabled={isSaving}>
        {isSubscribed ? `取消訂閱${characterName}` : `訂閱${characterName}`}
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
              確認訂閱
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
          <p>登入後即可訂閱角色通知</p>
          <button type="button" onClick={signIn}>使用 Google 登入</button>
        </div>
      )}
      <div className="subscription-feedback" aria-live="polite">
        {saveError && <p className="field-error" role="alert">{saveError}</p>}
      </div>
    </div>
  );
}
