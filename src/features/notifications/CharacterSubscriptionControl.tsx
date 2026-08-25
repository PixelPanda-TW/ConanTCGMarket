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
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSignInGuidance, setShowSignInGuidance] = useState(false);
  const activeContextRef = useRef(0);
  const characterKey = isKnownCharacter ? toCharacterKey(characterName) : '';

  useEffect(() => {
    activeContextRef.current += 1;
    let isCurrent = true;
    setSubscription(null);
    setIsSaving(false);
    setLoadError(null);
    setSaveError(null);
    setShowSignInGuidance(false);

    if (!isKnownCharacter || !user) {
      setIsSubscriptionLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setIsSubscriptionLoading(true);
    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (isCurrent) setSubscription(loadedSubscription);
      })
      .catch(() => {
        if (isCurrent) setLoadError('無法讀取角色通知，請稍後再試。');
      })
      .finally(() => {
        if (isCurrent) setIsSubscriptionLoading(false);
      });

    return () => {
      isCurrent = false;
      activeContextRef.current += 1;
    };
  }, [characterKey, isKnownCharacter, user]);

  if (!isKnownCharacter) return null;

  const isSubscribed = subscription?.characterKeys.includes(characterKey) ?? false;

  async function toggleSubscription() {
    if (!user) {
      setShowSignInGuidance(true);
      return;
    }

    const nextCharacterKeys = isSubscribed
      ? (subscription?.characterKeys ?? []).filter((key) => key !== characterKey)
      : [...(subscription?.characterKeys ?? []), characterKey];
    const nextSubscription: NotificationSubscription = {
      uid: user.uid,
      characterKeys: nextCharacterKeys,
      emailDailyEnabled: subscription?.emailDailyEnabled ?? false,
      updatedAt: new Date(),
    };
    const requestContext = activeContextRef.current;

    setIsSaving(true);
    setSaveError(null);
    try {
      await saveNotificationSubscription(nextSubscription);
      if (activeContextRef.current === requestContext) setSubscription(nextSubscription);
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
