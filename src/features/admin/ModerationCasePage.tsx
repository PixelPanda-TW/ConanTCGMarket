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
  getModerationCase,
  getModerationEvidence,
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

interface ModerationCasePageProps {
  id: string;
  loadCase?: (id: string) => Promise<ModerationCaseDetail>;
  loadEvidence?: (input: { reportId: string; slot: 0 | 1 | 2 }) => Promise<ModerationEvidenceData>;
  decideCase?: (input: DecideModerationCaseInput) => Promise<ModerationDecisionResult>;
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

export function ModerationCasePage({
  id,
  loadCase = getModerationCase,
  loadEvidence = getModerationEvidence,
  decideCase = decideModerationCase,
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
  const scopeRef = useRef(0);
  const decisionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rationaleRef = useRef<HTMLTextAreaElement | null>(null);
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
          {detail.account.suspensionEligible && (
            <p className="moderation-eligibility">此帳號符合人工停權條件；停權操作將在後續批次提供。</p>
          )}
        </section>
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
    </PageShell>
  );
}
