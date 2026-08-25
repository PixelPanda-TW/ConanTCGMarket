import { useEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import {
  getNotificationSubscription,
  saveNotificationSubscription,
} from '../../data/firestore/repositories';
import type { NotificationSubscription } from '../../domain/models';
import { useAuth } from '../auth/AuthProvider';

export function NotificationSettingsPage() {
  const { isLoading: isAuthLoading, signIn, user } = useAuth();
  const [subscription, setSubscription] = useState<NotificationSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const activeContextRef = useRef(0);

  useEffect(() => {
    activeContextRef.current += 1;
    let isCurrent = true;
    setSubscription(null);
    setIsSaving(false);
    setLoadError(false);
    setSaveError(false);

    if (!user) {
      setIsLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setIsLoading(true);
    void getNotificationSubscription(user.uid)
      .then((loadedSubscription) => {
        if (isCurrent) setSubscription(loadedSubscription);
      })
      .catch(() => {
        if (isCurrent) setLoadError(true);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      activeContextRef.current += 1;
    };
  }, [user]);

  async function persistSettings(characterKeys: string[], emailDailyEnabled: boolean) {
    if (!user) return;

    const nextSubscription: NotificationSubscription = {
      uid: user.uid,
      characterKeys,
      emailDailyEnabled,
      updatedAt: new Date(),
    };
    const requestContext = activeContextRef.current;

    setIsSaving(true);
    setSaveError(false);
    try {
      await saveNotificationSubscription(nextSubscription);
      if (activeContextRef.current === requestContext) setSubscription(nextSubscription);
    } catch {
      if (activeContextRef.current === requestContext) setSaveError(true);
    } finally {
      if (activeContextRef.current === requestContext) setIsSaving(false);
    }
  }

  const characterKeys = subscription?.characterKeys ?? [];
  const emailDailyEnabled = subscription?.emailDailyEnabled ?? false;

  return (
    <PageShell backToMarketplace>
      <section className="notification-settings-page">
        <p className="eyebrow">Buyer notifications</p>
        <h1>通知設定</h1>

        {isAuthLoading ? (
          <p className="profile-state" aria-live="polite">登入狀態確認中</p>
        ) : !user ? (
          <div className="profile-state notification-sign-in-guidance">
            <p>請先使用 Google 登入，才能管理角色通知。</p>
            <button type="button" onClick={signIn}>使用 Google 登入</button>
          </div>
        ) : isLoading ? (
          <p className="profile-state" aria-live="polite">通知設定載入中</p>
        ) : loadError ? (
          <p className="profile-state field-error" role="alert">無法載入通知設定，請稍後再試。</p>
        ) : (
          <div className="notification-settings-content">
            <section className="notification-settings-card" aria-labelledby="subscribed-characters-heading">
              <h2 id="subscribed-characters-heading">已訂閱角色</h2>
              {characterKeys.length === 0 ? (
                <p>尚未訂閱任何角色。</p>
              ) : (
                <ul className="subscribed-character-list">
                  {characterKeys.map((characterKey) => (
                    <li key={characterKey}>
                      <span>{characterKey}</span>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => persistSettings(
                          characterKeys.filter((key) => key !== characterKey),
                          emailDailyEnabled,
                        )}
                      >
                        移除{characterKey}通知
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
                  disabled={isSaving}
                  onChange={(event) => persistSettings(characterKeys, event.target.checked)}
                />
                每日彙整 Email 通知
              </label>
              <p>每日彙整你所訂閱角色的新上架商品。</p>
            </section>

            <aside className="notification-settings-card discord-feed-note" aria-labelledby="discord-feed-heading">
              <h2 id="discord-feed-heading">Discord 公開通知</h2>
              <p>Discord 公開頻道會提供所有上架商品通知，不需綁定帳號。</p>
            </aside>

            <div className="subscription-feedback" aria-live="polite">
              {saveError && <p className="field-error" role="alert">無法儲存通知設定，請稍後再試。</p>}
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
