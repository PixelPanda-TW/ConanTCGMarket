import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PageShell } from '../../components/PageShell';
import {
  createModerationReportDraft,
  getListing,
  submitModerationReport,
} from '../../data/firestore/repositories';
import {
  deleteReportEvidence,
  uploadReportEvidence,
} from '../../data/storage/storageService';
import type { Listing, ModerationReportDraftReceipt } from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import {
  reportCategoryLabels,
  validateReportForm,
  type ReportFormErrors,
  type ReportFormState,
} from './reportForm';

const emptyForm: ReportFormState = { category: '', description: '', files: [] };

function submittedStorageKey(uid: string, listingId: string) {
  return `moderation-report-submitted:${uid}:${listingId}`;
}

function readSubmittedId(uid: string, listingId: string): string | null {
  const value = sessionStorage.getItem(submittedStorageKey(uid, listingId));
  return value && /^[A-Za-z0-9_-]{1,200}$/u.test(value) ? value : null;
}

export function ReportListingPage({ id }: { id: string }) {
  const { accountAccessState, isActiveAccount, isLoading, signIn, user } = useAuth();
  const [listing, setListing] = useState<Listing | null>();
  const [form, setForm] = useState<ReportFormState>(emptyForm);
  const [errors, setErrors] = useState<ReportFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const draftRef = useRef<ModerationReportDraftReceipt | null>(null);
  const uploadedSlotCountRef = useRef(0);
  const scope = `${user?.uid ?? 'signed-out'}:${id}:${accountAccessState.state}`;
  const currentScopeRef = useRef(scope);
  currentScopeRef.current = scope;

  useEffect(() => {
    let isCurrent = true;
    setListing(undefined);
    setForm(emptyForm);
    setErrors({});
    setError(null);
    setIsPending(false);
    setProgress(null);
    setSubmittedId(user && isActiveAccount ? readSubmittedId(user.uid, id) : null);
    requestIdRef.current = null;
    draftRef.current = null;
    uploadedSlotCountRef.current = 0;
    if (!user || !isActiveAccount) return () => { isCurrent = false; };
    void getListing(id)
      .then((value) => { if (isCurrent) setListing(value); })
      .catch(() => { if (isCurrent) setListing(null); });
    return () => { isCurrent = false; };
  }, [id, isActiveAccount, user]);

  useEffect(() => {
    if (error || Object.keys(errors).length > 0) errorSummaryRef.current?.focus();
  }, [error, errors]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !isActiveAccount || isPending || !listing || listing.status !== 'active'
      || listing.sellerId === user.uid) return;
    const validation = validateReportForm(form);
    setForm(validation.values);
    setErrors(validation.errors);
    setError(null);
    if (Object.keys(validation.errors).length > 0 || validation.values.category === '') return;

    const operationScope = scope;
    const uid = user.uid;
    setIsPending(true);
    setProgress(validation.values.files.length ? 0 : null);
    try {
      let draft = draftRef.current;
      if (!draft) {
        requestIdRef.current ??= globalThis.crypto.randomUUID();
        draft = await createModerationReportDraft({
          uid,
          requestId: requestIdRef.current,
          listingId: id,
        });
        if (currentScopeRef.current !== operationScope) return;
        draftRef.current = draft;
      }

      const evidencePaths: string[] = [];
      for (let slot = 0; slot < validation.values.files.length; slot += 1) {
        const path = await uploadReportEvidence(
          uid,
          draft.reportId,
          slot,
          validation.values.files[slot],
          (fileProgress) => {
            if (currentScopeRef.current === operationScope) {
              setProgress((slot + fileProgress) / validation.values.files.length);
            }
          },
        );
        uploadedSlotCountRef.current = Math.max(uploadedSlotCountRef.current, slot + 1);
        if (currentScopeRef.current !== operationScope) return;
        evidencePaths.push(path);
      }
      for (let slot = uploadedSlotCountRef.current - 1;
        slot >= validation.values.files.length; slot -= 1) {
        await deleteReportEvidence(uid, draft.reportId, slot);
        uploadedSlotCountRef.current = slot;
        if (currentScopeRef.current !== operationScope) return;
      }

      const result = await submitModerationReport({
        uid,
        reportId: draft.reportId,
        category: validation.values.category,
        description: validation.values.description,
        evidencePaths,
      });
      if (currentScopeRef.current !== operationScope) return;
      sessionStorage.setItem(submittedStorageKey(uid, id), result.reportId);
      setSubmittedId(result.reportId);
      setProgress(null);
    } catch {
      if (currentScopeRef.current === operationScope) {
        setError('目前無法送出檢舉，請稍後再試。');
        setProgress(null);
      }
    } finally {
      if (currentScopeRef.current === operationScope) setIsPending(false);
    }
  }

  if (isLoading || (user && isActiveAccount && listing === undefined)) {
    return <PageShell><p aria-live="polite">載入檢舉表單中</p></PageShell>;
  }
  if (!user) {
    return (
      <PageShell backToMarketplace>
        <section className="report-page report-state">
          <h1>檢舉商品</h1>
          <p>請先使用 Google 登入，才能送出檢舉。</p>
          <button type="button" onClick={() => { void signIn(); }}>使用 Google 登入</button>
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }
  if (!isActiveAccount) {
    return (
      <PageShell backToMarketplace>
        <section className="report-page report-state">
          <h1>無法檢舉商品</h1>
          <AccountAccessNotice state={accountAccessState} />
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }
  if (!listing || listing.status !== 'active' || listing.sellerId === user.uid) {
    return (
      <PageShell backToMarketplace>
        <section className="report-page report-state">
          <h1>無法檢舉商品</h1>
          <p>這筆商品不存在、已售出，或不符合可檢舉條件。</p>
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }
  if (submittedId) {
    return (
      <PageShell backToMarketplace>
        <section className="report-page report-state">
          <p className="eyebrow">Report submitted</p>
          <h1>檢舉已送出</h1>
          <p role="status">檢舉編號：<strong>{submittedId}</strong></p>
          <p>管理員會在後台審核；此頁不會顯示內部處理狀態。</p>
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }

  const cardName = listing.cardName ?? listing.characterName ?? `卡片 ${listing.cardId}`;
  return (
    <PageShell backToMarketplace>
      <section className="report-page">
        <a href={`#/listing/${id}`}>返回商品</a>
        <p className="eyebrow">Report listing</p>
        <h1>檢舉商品</h1>
        <div className="report-listing-summary">
          <strong>{cardName}</strong>
          <span>{listing.cardId} · {listing.rarity ?? '稀有度未提供'}</span>
          <span>NT${listing.listingPrice.toLocaleString('zh-TW')}／張</span>
        </div>
        <p className="report-privacy-note">檢舉內容與證據不會公開顯示，也不會提供給其他一般使用者讀取。</p>

        <form className="profile-form report-form" onSubmit={submit} noValidate>
          {(error || Object.keys(errors).length > 0) && (
            <div className="report-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
              {error ?? '請修正下方標示的欄位。'}
            </div>
          )}
          <label htmlFor="report-category">檢舉原因</label>
          <select
            id="report-category"
            value={form.category}
            disabled={isPending}
            aria-invalid={Boolean(errors.category)}
            onChange={(event) => {
              setForm((current) => ({ ...current, category: event.target.value as ReportFormState['category'] }));
              setErrors((current) => ({ ...current, category: undefined }));
            }}
          >
            <option value="">請選擇</option>
            {Object.entries(reportCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {errors.category && <p className="field-error">{errors.category}</p>}

          <label htmlFor="report-description">說明</label>
          <textarea
            id="report-description"
            value={form.description}
            maxLength={100}
            disabled={isPending}
            aria-invalid={Boolean(errors.description)}
            onChange={(event) => {
              setForm((current) => ({ ...current, description: event.target.value }));
              setErrors((current) => ({ ...current, description: undefined }));
            }}
          />
          <p className="field-hint">{form.description.length}/100</p>
          {errors.description && <p className="field-error">{errors.description}</p>}

          <label htmlFor="report-evidence">證據圖片（選填）</label>
          <input
            id="report-evidence"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={isPending}
            aria-invalid={Boolean(errors.files)}
            onChange={(event) => {
              setForm((current) => ({ ...current, files: Array.from(event.target.files ?? []) }));
              setErrors((current) => ({ ...current, files: undefined }));
            }}
          />
          <p className="field-hint">最多 3 張，每張不超過 5 MiB。</p>
          {errors.files && <p className="field-error">{errors.files}</p>}
          {progress !== null && (
            <p role="status">附件上傳進度 {Math.round(progress * 100)}%</p>
          )}
          <button type="submit" disabled={isPending}>
            {isPending ? '送出中' : error && draftRef.current ? '重新送出' : '送出檢舉'}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
