import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ContactType, SellerProfile } from '../../domain/models';
import { getSellerProfile, saveSellerProfile } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { sellerContactFieldDefinition } from '../../domain/sellerContact';
import {
  profileContactTypes,
  type ProfileFormErrors,
  type ProfileFormState,
  canApplyProfileRequest,
  validateProfileForm,
} from './profileForm';

const emptyProfileForm: ProfileFormState = {
  displayName: '',
  contactType: 'line',
  contactValue: '',
};

const contactTypeLabels: Record<ContactType, string> = {
  line: 'LINE',
  discord: 'Discord',
  threads: 'Threads',
  facebook: 'Facebook',
};

function profileToForm(profile: SellerProfile): ProfileFormState {
  return {
    displayName: profile.displayName,
    contactType: profile.contactType,
    contactValue: profile.contactValue,
  };
}

export function SellerProfilePage() {
  const { isLoading: isAuthLoading, user } = useAuth();
  const [form, setForm] = useState<ProfileFormState>(emptyProfileForm);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<ProfileFormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isMountedRef = useRef(true);
  const activeUserUidRef = useRef<string | null>(null);
  const contactField = sellerContactFieldDefinition(form.contactType);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    activeUserUidRef.current = user?.uid ?? null;
    setIsSaving(false);

    if (!user) {
      setProfile(null);
      setForm(emptyProfileForm);
      setIsProfileLoading(false);
      setLoadError(null);
      return () => {
        isCurrent = false;
      };
    }

    setIsProfileLoading(true);
    setLoadError(null);
    setSaveSuccess(false);

    void getSellerProfile(user.uid)
      .then((loadedProfile) => {
        if (!isCurrent) {
          return;
        }

        setProfile(loadedProfile);
        setForm(
          loadedProfile
            ? profileToForm(loadedProfile)
            : { ...emptyProfileForm, displayName: user.displayName ?? '' },
        );
      })
      .catch((caughtError) => {
        if (isCurrent) {
          setLoadError(
            caughtError instanceof Error ? caughtError.message : '無法讀取賣家個人檔案。',
          );
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsProfileLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateProfileForm(form);
    setForm(validation.values);
    setFormErrors(validation.errors);
    setSaveSuccess(false);

    if (Object.keys(validation.errors).length > 0 || !user) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const now = new Date();
    const nextProfile: SellerProfile = {
      uid: user.uid,
      displayName: validation.values.displayName,
      contactType: validation.values.contactType,
      contactValue: validation.values.contactValue,
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await saveSellerProfile(nextProfile);
      if (!canApplyProfileRequest(isMountedRef.current, user.uid, activeUserUidRef.current)) {
        return;
      }
      setProfile(nextProfile);
      setSaveSuccess(true);
    } catch (caughtError) {
      if (canApplyProfileRequest(isMountedRef.current, user.uid, activeUserUidRef.current)) {
        setSaveError(caughtError instanceof Error ? caughtError.message : '無法儲存賣家個人檔案。');
      }
    } finally {
      if (canApplyProfileRequest(isMountedRef.current, user.uid, activeUserUidRef.current)) {
        setIsSaving(false);
      }
    }
  }

  if (isAuthLoading) {
    return (
      <PageShell backToMarketplace>
        <section className="profile-page profile-state" aria-live="polite">
          <p>登入狀態確認中</p>
        </section>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell backToMarketplace>
        <section className="profile-page profile-state">
          <h1>賣家個人檔案</h1>
          <p>請先使用 Google 登入，才能設定你的賣家聯絡方式。</p>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell backToMarketplace>
      <section className="profile-page">
        <p className="eyebrow">Seller profile</p>
        <h1>賣家個人檔案</h1>

        {isProfileLoading ? (
          <p className="profile-state" aria-live="polite">
            載入個人檔案中
          </p>
        ) : loadError ? (
          <div className="profile-state" role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              重新載入
            </button>
          </div>
        ) : (
            <form className="profile-form" onSubmit={handleSubmit} noValidate aria-live="polite">
            <label>
              顯示名稱
              <input
                value={form.displayName}
                onChange={(event) => {
                  setForm((currentForm) => ({ ...currentForm, displayName: event.target.value }));
                  setFormErrors((errors) => ({ ...errors, displayName: undefined }));
                }}
                aria-invalid={Boolean(formErrors.displayName)}
                aria-describedby={formErrors.displayName ? 'display-name-error' : undefined}
              />
            </label>
            {formErrors.displayName && (
              <p className="field-error" id="display-name-error" role="alert">
                {formErrors.displayName}
              </p>
            )}

            <label>
              聯絡方式
              <select
                value={form.contactType}
                onChange={(event) => {
                  setForm((currentForm) => ({
                    ...currentForm,
                    contactType: event.target.value as ContactType,
                  }));
                  setFormErrors((errors) => ({ ...errors, contactType: undefined }));
                }}
                aria-invalid={Boolean(formErrors.contactType)}
                aria-describedby={formErrors.contactType ? 'contact-type-error' : undefined}
              >
                {profileContactTypes.map((contactType) => (
                  <option key={contactType} value={contactType}>
                    {contactTypeLabels[contactType]}
                  </option>
                ))}
              </select>
            </label>
            {formErrors.contactType && (
              <p className="field-error" id="contact-type-error" role="alert">
                {formErrors.contactType}
              </p>
            )}

            <label htmlFor="seller-contact-value">
              {contactField.label}
            </label>
            <input
              id="seller-contact-value"
              value={form.contactValue}
              placeholder={contactField.placeholder}
              inputMode={contactField.inputMode}
              onChange={(event) => {
                setForm((currentForm) => ({ ...currentForm, contactValue: event.target.value }));
                setFormErrors((errors) => ({ ...errors, contactValue: undefined }));
              }}
              aria-invalid={Boolean(formErrors.contactValue)}
              aria-describedby={formErrors.contactValue
                ? 'seller-contact-helper contact-value-error'
                : 'seller-contact-helper'}
            />
            <p id="seller-contact-helper">{contactField.helper}</p>
            {formErrors.contactValue && (
              <p className="field-error" id="contact-value-error" role="alert">
                {formErrors.contactValue}
              </p>
            )}

            {saveError && (
              <p className="field-error" role="alert">
                {saveError}
              </p>
            )}
            {saveSuccess && <p className="save-success" role="status">已儲存個人檔案。</p>}

            <button type="submit" disabled={isSaving}>
              {isSaving ? '儲存中...' : '儲存個人檔案'}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
