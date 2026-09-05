import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { PageShell } from '../../components/PageShell';
import { FieldError, FieldLabel } from '../../components/forms/FormField';
import {
  decideModerationCase,
  createAccountModerationRequestId,
  getModerationCase,
  getModerationEvidence,
  restoreModerationTarget,
  suspendModerationTarget,
  type AccountModerationOperationResult,
  type DecideModerationCaseInput,
  type ModerationEvidenceData,
} from '../../data/firestore/repositories';
import { cardTypeLabel } from '../../domain/cardType';
import type {
  ModerationCaseDetail,
  ModerationDecision,
  ModerationDecisionResult,
} from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import { createModerationEvidenceUrl, type ModerationEvidenceUrl } from './moderationEvidence';
import { validateModerationDecisionForm } from './moderationDecisionForm';
import { validateAccountModerationForm } from './accountModerationForm';

interface ModerationCasePageProps {
  id: string;
  loadCase?: (id: string) => Promise<ModerationCaseDetail>;
  loadEvidence?: (input: { reportId: string; slot: 0 | 1 | 2 }) => Promise<ModerationEvidenceData>;
  decideCase?: (input: DecideModerationCaseInput) => Promise<ModerationDecisionResult>;
  suspendAccount?: typeof suspendModerationTarget;
  restoreAccount?: typeof restoreModerationTarget;
}

interface EvidenceView {
  slot: 0 | 1 | 2;
  handle: ModerationEvidenceUrl;
}

const categoryLabels: Record<ModerationCaseDetail['category'], string> = {
  suspected_counterfeit: '疑似偽卡',
  listing_mismatch: '商品資訊不符',
  fraud_or_harassment: '詐騙或騷擾',
  prohibited_content: '禁止內容',
  other: '其他',
};

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code.replace(/^functions\//u, '') : null;
}

function decisionHeading(decision: ModerationDecision): string {
  return decision === 'dismissed' ? '駁回檢舉' : '確認違規';
}

type AccountAction = 'suspend' | 'restore';

function auditLabel(type: ModerationCaseDetail['accountModeration']['history'][number]['type']) {
  if (type === 'suspension_requested') return '提出停權';
  if (type === 'suspension_completed') return '停權完成';
  if (type === 'restored') return '恢復帳號';
  return '重新上架商品';
}

function auditDetail(event: ModerationCaseDetail['accountModeration']['history'][number]) {
  if (event.type === 'suspension_requested') {
    return `理由：${event.reason} · 當時累計 ${event.confirmedViolationCount} 次違規`;
  }
  if (event.type === 'suspension_completed') return `隱藏 ${event.hiddenListingCount} 筆商品`;
  if (event.type === 'restored') return `理由：${event.reason}`;
  return `商品 ${event.listingId}`;
}

export function ModerationCasePage({
  id,
  loadCase = getModerationCase,
  loadEvidence = getModerationEvidence,
  decideCase = decideModerationCase,
  suspendAccount = suspendModerationTarget,
  restoreAccount = restoreModerationTarget,
}: ModerationCasePageProps) {
  const { accountAccessState, adminAccessState, signIn, user } = useAuth();
  const [detail, setDetail] = useState<ModerationCaseDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<'not-found' | 'service' | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [evidenceView, setEvidenceView] = useState<EvidenceView | null>(null);
  const evidenceHandleRef = useRef<ModerationEvidenceUrl | null>(null);
  const [evidencePending, setEvidencePending] = useState<number | null>(null);
  const [evidenceError, setEvidenceError] = useState<number | null>(null);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [rationale, setRationale] = useState('');
  const [rationaleError, setRationaleError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionResult, setDecisionResult] = useState<ModerationDecisionResult | null>(null);
  const [terminalReloadError, setTerminalReloadError] = useState(false);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [accountReason, setAccountReason] = useState('');
  const [accountReasonError, setAccountReasonError] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [accountPending, setAccountPending] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState('');
  const accountRequestIdRef = useRef<string | null>(null);
  const scopeRef = useRef(0);
  const decisionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rationaleRef = useRef<HTMLTextAreaElement | null>(null);
  const accountReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const isAdmin = adminAccessState.state === 'admin';

  function revokeEvidence() {
    evidenceHandleRef.current?.revoke();
    evidenceHandleRef.current = null;
  }

  useEffect(() => () => revokeEvidence(), []);

  useEffect(() => {
    scopeRef.current += 1;
    const scope = scopeRef.current;
    revokeEvidence();
    setEvidenceView(null);
    setEvidencePending(null);
    setEvidenceError(null);
    setDecision(null);
    setDecisionResult(null);
    setAccountAction(null);
    setAccountFeedback('');
    setAccountPending(false);
    setAccountReason('');
    setAccountReasonError('');
    setAccountActionError('');
    accountRequestIdRef.current = null;
    setTerminalReloadError(false);
    if (!isAdmin) {
      setDetail(null);
      setLoaded(false);
      setLoadError(null);
      return undefined;
    }
    setDetail(null);
    setLoaded(false);
    setLoadError(null);
    void loadCase(id)
      .then((nextDetail) => {
        if (scopeRef.current === scope) setDetail(nextDetail);
      })
      .catch((error: unknown) => {
        if (scopeRef.current === scope) {
          setLoadError(errorCode(error) === 'not-found' ? 'not-found' : 'service');
        }
      })
      .finally(() => {
        if (scopeRef.current === scope) setLoaded(true);
      });
    return () => {
      if (scopeRef.current === scope) scopeRef.current += 1;
    };
  }, [id, isAdmin, loadCase, reloadVersion, user?.uid]);

  useEffect(() => {
    if (decision) rationaleRef.current?.focus();
  }, [decision]);

  useEffect(() => {
    if (accountAction) accountReasonRef.current?.focus();
  }, [accountAction]);

  function openDecision(nextDecision: ModerationDecision, trigger: HTMLButtonElement) {
    decisionTriggerRef.current = trigger;
    setDecision(nextDecision);
    setRationale('');
    setRationaleError('');
    setDecisionError('');
  }

  function closeDecision() {
    if (decisionPending) return;
    setDecision(null);
    setDecisionError('');
    requestAnimationFrame(() => decisionTriggerRef.current?.focus());
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      closeDecision();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled)',
    ) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openAccountAction(action: AccountAction, trigger: HTMLButtonElement) {
    accountTriggerRef.current = trigger;
    accountRequestIdRef.current = createAccountModerationRequestId();
    setAccountAction(action);
    setAccountReason('');
    setAccountReasonError('');
    setAccountActionError('');
  }

  function closeAccountAction() {
    if (accountPending) return;
    setAccountAction(null);
    setAccountActionError('');
    accountRequestIdRef.current = null;
    requestAnimationFrame(() => accountTriggerRef.current?.focus());
  }

  function handleAccountDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      closeAccountAction();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled)',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function showEvidence(slot: 0 | 1 | 2) {
    if (!isAdmin || evidencePending !== null) return;
    const scope = scopeRef.current;
    setEvidencePending(slot);
    setEvidenceError(null);
    try {
      const evidence = await loadEvidence({ reportId: id, slot });
      if (scopeRef.current !== scope) return;
      const handle = createModerationEvidenceUrl(evidence);
      revokeEvidence();
      evidenceHandleRef.current = handle;
      setEvidenceView({ slot, handle });
    } catch {
      if (scopeRef.current === scope) setEvidenceError(slot);
    } finally {
      if (scopeRef.current === scope) setEvidencePending(null);
    }
  }

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (!decision || decisionPending || !detail || detail.status !== 'open') return;
    const checked = validateModerationDecisionForm({ decision, rationale });
    setRationale(checked.values.rationale);
    setRationaleError(checked.errors.rationale ?? '');
    if (checked.errors.rationale) return;
    const scope = scopeRef.current;
    setDecisionPending(true);
    setDecisionError('');
    try {
      const result = await decideCase({ reportId: id, ...checked.values });
      if (scopeRef.current !== scope) return;
      setDecisionResult(result);
      setDecision(null);
      requestAnimationFrame(() => decisionTriggerRef.current?.focus());
      try {
        const terminal = await loadCase(id);
        if (scopeRef.current === scope) setDetail(terminal);
      } catch {
        if (scopeRef.current === scope) setTerminalReloadError(true);
      }
    } catch {
      if (scopeRef.current === scope) setDecisionError('無法完成裁決，請稍後再試。');
    } finally {
      if (scopeRef.current === scope) setDecisionPending(false);
    }
  }

  async function submitAccountAction(event: FormEvent) {
    event.preventDefault();
    if (!accountAction || accountPending || !detail || !user || !accountRequestIdRef.current) return;
    const checked = validateAccountModerationForm({ action: accountAction, reason: accountReason });
    setAccountReason(checked.values.reason);
    setAccountReasonError(checked.errors.reason ?? '');
    if (checked.errors.reason) return;
    const scope = scopeRef.current;
    setAccountPending(true);
    setAccountActionError('');
    try {
      let result: AccountModerationOperationResult;
      if (accountAction === 'suspend') {
        result = await suspendAccount({
          reportId: id, requestId: accountRequestIdRef.current, reason: checked.values.reason,
        });
      } else {
        const operation = detail.accountModeration.operation;
        if (!operation || operation.status !== 'suspended') return;
        result = await restoreAccount({
          reportId: id,
          suspensionActionId: operation.actionId,
          requestId: accountRequestIdRef.current,
          reason: checked.values.reason,
        });
      }
      if (scopeRef.current !== scope) return;
      setAccountFeedback(result.status === 'restored' ? '帳號已恢復。' : '停權請求已送出。');
      setAccountAction(null);
      accountRequestIdRef.current = null;
      try {
        const refreshed = await loadCase(id);
        if (scopeRef.current === scope) setDetail(refreshed);
      } catch {
        if (scopeRef.current === scope) setTerminalReloadError(true);
      }
    } catch {
      if (scopeRef.current === scope) setAccountActionError('無法完成帳號操作，請稍後再試。');
    } finally {
      if (scopeRef.current === scope) setAccountPending(false);
    }
  }

  let content;
  if (!user) {
    content = <div className="profile-state"><p>請先使用 Google 登入，才能查看檢舉案件。</p><button type="button" onClick={signIn}>使用 Google 登入</button></div>;
  } else if (accountAccessState.state === 'suspended') {
    content = <AccountAccessNotice state={accountAccessState} />;
  } else if (adminAccessState.state === 'loading') {
    content = <p role="status">管理權限確認中</p>;
  } else if (adminAccessState.state === 'unavailable') {
    content = <div className="profile-state"><p role="alert">無法確認管理權限，請重新整理後再試。</p><a href="#">返回市集</a></div>;
  } else if (!isAdmin) {
    content = <div className="profile-state"><p role="alert">無權限查看檢舉案件</p><a href="#">返回市集</a></div>;
  } else if (!loaded) {
    content = <p role="status">案件載入中</p>;
  } else if (loadError === 'not-found') {
    content = <div className="profile-state"><h2>找不到檢舉案件</h2><a href="#/admin/moderation">返回檢舉案件</a></div>;
  } else if (loadError || !detail) {
    content = <div className="profile-state"><p role="alert">無法載入檢舉案件，請稍後再試。</p><button type="button" onClick={() => setReloadVersion((value) => value + 1)}>重新載入案件</button></div>;
  } else {
    const listing = detail.listingSnapshot;
    const decisionLocked = decisionResult !== null;
    const operation = detail.accountModeration.operation;
    const canSuspend = detail.status === 'confirmed'
      && detail.account.status === 'active'
      && detail.account.suspensionEligible
      && detail.targetSellerId !== user.uid;
    const canRestore = detail.status === 'confirmed'
      && detail.account.status === 'suspended'
      && operation?.status === 'suspended'
      && operation.sourceReportId === detail.reportId
      && detail.targetSellerId !== user.uid;
    content = (
      <div className="moderation-case-content">
        {decisionResult && (
          <p className="moderation-decision-feedback" role="status">
            {decisionResult.status === 'confirmed'
              ? `違規已確認，累計 ${decisionResult.resultingConfirmedViolationCount} 次。`
              : '檢舉已駁回。'}
          </p>
        )}
        {terminalReloadError && <p role="alert">裁決已完成，但目前無法重新載入案件終態。</p>}
        {accountFeedback && <p className="moderation-decision-feedback" role="status">{accountFeedback}</p>}
        <section className="moderation-case-panel" aria-labelledby="moderation-report-heading">
          <h2 id="moderation-report-heading">檢舉內容</h2>
          <dl className="moderation-case-meta">
            <div><dt>原因</dt><dd>{categoryLabels[detail.category]}</dd></div>
            <div><dt>說明</dt><dd>{detail.description}</dd></div>
            <div><dt>檢舉人 ID</dt><dd>{detail.reporterId}</dd></div>
            <div><dt>賣家 ID</dt><dd>{detail.targetSellerId}</dd></div>
            <div><dt>送出時間</dt><dd>{detail.submittedAt.toLocaleString('zh-TW')}</dd></div>
          </dl>
        </section>
        <section className="moderation-case-panel" aria-labelledby="moderation-listing-heading">
          <h2 id="moderation-listing-heading">送出時的商品快照</h2>
          <dl className="moderation-case-meta">
            <div><dt>卡片名稱</dt><dd>{listing.cardName}</dd></div>
            <div><dt>卡片資料</dt><dd>{cardTypeLabel(listing.cardType)} · {listing.cardId} · {listing.rarity}</dd></div>
            <div><dt>刊登價格</dt><dd>NT$ {listing.listingPrice.toLocaleString('zh-TW')}</dd></div>
            <div><dt>商品 ID</dt><dd>{listing.listingId}</dd></div>
          </dl>
        </section>
        <section className="moderation-case-panel" aria-labelledby="moderation-account-heading">
          <h2 id="moderation-account-heading">帳號狀態</h2>
          <p>{detail.account.status === 'suspended' ? '已停權' : '使用中'} · 累計 {detail.account.confirmedViolationCount} 次確認違規</p>
          {detail.account.status === 'suspended' && (
            <p>停權理由：{detail.account.suspensionReason} · {detail.account.suspendedAt.toLocaleString('zh-TW')}</p>
          )}
          {operation?.status === 'hiding' && (
            <p className="moderation-eligibility">停權處理中，已隱藏 {operation.hiddenListingCount} 筆商品。</p>
          )}
          {operation?.status === 'suspended' && (
            <p className="moderation-eligibility">停權完成，共隱藏 {operation.hiddenListingCount} 筆商品。</p>
          )}
          {operation?.status === 'restored' && (
            <p className="moderation-eligibility">帳號已恢復；先前隱藏的商品不會自動重新上架。</p>
          )}
          <div className="moderation-account-actions">
            {canSuspend && <button type="button" className="danger-button" onClick={(event) => openAccountAction('suspend', event.currentTarget)}>停權帳號</button>}
            {canRestore && <button type="button" onClick={(event) => openAccountAction('restore', event.currentTarget)}>恢復帳號</button>}
          </div>
        </section>
        {detail.accountModeration.history.length > 0 && (
          <section className="moderation-case-panel" aria-labelledby="moderation-account-history-heading">
            <h2 id="moderation-account-history-heading">帳號管理歷史</h2>
            <ol className="moderation-account-history" aria-label="帳號管理歷史">
              {detail.accountModeration.history.map((event) => (
                <li key={event.eventId}>
                  <strong>{auditLabel(event.type)}</strong>
                  <span>{event.at.toLocaleString('zh-TW')} · 執行者 {event.actorUid}</span>
                  <span>{auditDetail(event)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <section className="moderation-case-panel" aria-labelledby="moderation-evidence-heading">
          <h2 id="moderation-evidence-heading">證據</h2>
          {detail.evidence.length === 0 ? <p>未附證據。</p> : (
            <div className="moderation-evidence-controls">
              {detail.evidence.map((evidence) => (
                <button
                  type="button"
                  key={evidence.slot}
                  disabled={evidencePending !== null}
                  onClick={() => void showEvidence(evidence.slot)}
                >{evidenceError === evidence.slot ? '重新載入' : '載入'}證據 {evidence.slot + 1}</button>
              ))}
            </div>
          )}
          {evidencePending !== null && <p role="status">證據 {evidencePending + 1} 載入中</p>}
          {evidenceError !== null && <p role="alert">無法載入證據 {evidenceError + 1}，請稍後再試。</p>}
          {evidenceView && <img src={evidenceView.handle.url} alt={`檢舉證據 ${evidenceView.slot + 1}`} />}
        </section>
        {detail.status === 'open' && !decisionLocked ? (
          <section className="moderation-case-panel moderation-decision-actions" aria-labelledby="moderation-decision-heading">
            <h2 id="moderation-decision-heading">裁決</h2>
            <button type="button" onClick={(event) => openDecision('dismissed', event.currentTarget)}>駁回檢舉</button>
            <button type="button" className="danger-button" onClick={(event) => openDecision('confirmed', event.currentTarget)}>確認違規</button>
          </section>
        ) : detail.status !== 'open' ? (
          <section className="moderation-case-panel" aria-labelledby="moderation-decision-history-heading">
            <h2 id="moderation-decision-history-heading">裁決結果</h2>
            <p>{detail.status === 'dismissed' ? '已駁回' : '已確認違規'}</p>
            <p>{detail.rationale}</p>
            <p>裁決者：{detail.decidedBy} · {detail.decidedAt.toLocaleString('zh-TW')}</p>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <PageShell width="marketplace" backToMarketplace>
      <section className="moderation-case-page">
        <p className="eyebrow">Private Admin</p>
        <h1>檢舉案件 {id}</h1>
        <a className="moderation-case-back" href="#/admin/moderation">返回檢舉案件</a>
        {content}
      </section>
      {decision && (
        <div className="admin-card-dialog-backdrop">
          <section
            ref={dialogRef}
            className="modal admin-card-dialog moderation-decision-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="moderation-decision-dialog-heading"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="moderation-decision-dialog-heading">{decisionHeading(decision)}</h2>
            <form className="profile-form" noValidate onSubmit={submitDecision}>
              <label htmlFor="moderation-rationale"><FieldLabel required>裁決理由</FieldLabel></label>
              <textarea
                ref={rationaleRef}
                id="moderation-rationale"
                value={rationale}
                maxLength={1000}
                disabled={decisionPending}
                aria-invalid={Boolean(rationaleError)}
                onChange={(event) => setRationale(event.target.value)}
              />
              <FieldError message={rationaleError} />
              {decisionError && <p role="alert">{decisionError}</p>}
              <div className="admin-card-dialog-actions">
                <button type="button" disabled={decisionPending} onClick={closeDecision}>取消</button>
                <button type="submit" className={decision === 'confirmed' ? 'danger-button' : ''} disabled={decisionPending}>
                  {decisionPending ? '處理中' : decision === 'dismissed' ? '確認駁回' : '確認違規裁決'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {accountAction && (
        <div className="admin-card-dialog-backdrop">
          <section
            ref={dialogRef}
            className="modal admin-card-dialog moderation-decision-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-moderation-dialog-heading"
            onKeyDown={handleAccountDialogKeyDown}
          >
            <h2 id="account-moderation-dialog-heading">
              {accountAction === 'suspend' ? '停權帳號' : '恢復帳號'}
            </h2>
            <p>{accountAction === 'suspend'
              ? '帳號會立即停止新增或修改商品，現有上架商品將分批隱藏。'
              : '恢復帳號不會自動重新上架先前隱藏的商品。'}</p>
            <form className="profile-form" noValidate onSubmit={submitAccountAction}>
              <label htmlFor="account-moderation-reason"><FieldLabel required>處理理由</FieldLabel></label>
              <textarea
                ref={accountReasonRef}
                id="account-moderation-reason"
                value={accountReason}
                maxLength={1000}
                disabled={accountPending}
                aria-invalid={Boolean(accountReasonError)}
                onChange={(event) => setAccountReason(event.target.value)}
              />
              <FieldError message={accountReasonError} />
              {accountActionError && <p role="alert">{accountActionError}</p>}
              <div className="admin-card-dialog-actions">
                <button type="button" disabled={accountPending} onClick={closeAccountAction}>取消</button>
                <button
                  type="submit"
                  className={accountAction === 'suspend' ? 'danger-button' : ''}
                  disabled={accountPending}
                >{accountPending ? '處理中' : accountAction === 'suspend' ? '確認停權' : '確認恢復'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </PageShell>
  );
}
