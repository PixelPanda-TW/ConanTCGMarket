import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PageShell } from '../../components/PageShell';
import { decideAccountAppeal, getAccountAppeal, getAccountAppealEvidence } from '../../data/firestore/repositories';
import type { AccountAppealDetail } from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import { createModerationEvidenceUrl, type ModerationEvidenceUrl } from './moderationEvidence';

export function AppealDetailPage({ id, load = getAccountAppeal, decide = decideAccountAppeal,
  loadEvidence = getAccountAppealEvidence, createId = () => crypto.randomUUID() }: {
  id: string; load?: typeof getAccountAppeal; decide?: typeof decideAccountAppeal;
  loadEvidence?: typeof getAccountAppealEvidence; createId?: () => string;
}) {
  const { user, signIn, accountAccessState, adminAccessState } = useAuth();
  const [detail, setDetail] = useState<AccountAppealDetail | null>(null);
  const [loaded, setLoaded] = useState(false); const [error, setError] = useState(false);
  const [decision, setDecision] = useState<'dismissed' | 'approved' | null>(null);
  const [rationale, setRationale] = useState(''); const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false); const [reload, setReload] = useState(0);
  const [evidence, setEvidence] = useState<ModerationEvidenceUrl | null>(null);
  const requestId = useRef<string | null>(null); const isAdmin = adminAccessState.state === 'admin';
  useEffect(() => { let current = true; evidence?.revoke(); setEvidence(null); setLoaded(false); setError(false);
    if (!isAdmin) return;
    void load(id).then((value) => { if (current) setDetail(value); }).catch(() => { if (current) setError(true); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [id, isAdmin, load, reload, user?.uid]);
  useEffect(() => () => evidence?.revoke(), [evidence]);
  async function showEvidence(slot: 0 | 1 | 2) {
    try { const next = createModerationEvidenceUrl(await loadEvidence({ appealId: id, slot }));
      evidence?.revoke(); setEvidence(next); } catch { setMessage('無法載入申訴證據。'); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!decision || pending || !detail || detail.status !== 'submitted') return;
    const reason = rationale.trim(); if (!reason || reason.length > 1000 || reason !== rationale) {
      setMessage('請輸入 1–1,000 字且前後無空白的審核說明。'); return;
    }
    requestId.current ??= createId(); setPending(true); setMessage('');
    try { await decide({ appealId: id, requestId: requestId.current, decision, rationale });
      setDecision(null); requestId.current = null; setReload((v) => v + 1); setMessage('申訴審核已完成。');
    } catch { setMessage('無法完成申訴審核。'); } finally { setPending(false); }
  }
  let content;
  if (!user) content = <><p>請先使用 Google 登入。</p><button type="button" onClick={signIn}>使用 Google 登入</button></>;
  else if (accountAccessState.state === 'suspended') content = <AccountAccessNotice state={accountAccessState} />;
  else if (adminAccessState.state === 'loading') content = <p role="status">管理權限確認中</p>;
  else if (!isAdmin) content = <p role="alert">無權限查看申訴案件</p>;
  else if (!loaded) content = <p role="status">申訴載入中</p>;
  else if (error || !detail) content = <><p role="alert">無法載入申訴。</p><button type="button" onClick={() => setReload((v) => v + 1)}>重新載入申訴</button></>;
  else content = <div className="moderation-case-content">
    {message && <p role={message.startsWith('申訴審核') ? 'status' : 'alert'}>{message}</p>}
    <section className="moderation-case-panel"><h2>申訴內容</h2><p>{detail.statement}</p>
      <p>帳號 ID：{detail.targetUid}</p><p>提出時間：{detail.submittedAt.toLocaleString('zh-TW')}</p></section>
    <section className="moderation-case-panel"><h2>申訴證據</h2>
      {detail.evidence.length === 0 ? <p>未附證據。</p> : detail.evidence.map((item) => <button
        type="button" key={item.slot} onClick={() => void showEvidence(item.slot)}>查看證據 {item.slot + 1}</button>)}
      {evidence && <img src={evidence.url} alt="申訴證據預覽" />}</section>
    {detail.status === 'submitted' ? <div className="moderation-account-actions">
      <button type="button" onClick={() => { requestId.current = createId(); setDecision('dismissed'); }}>駁回申訴</button>
      <button type="button" onClick={() => { requestId.current = createId(); setDecision('approved'); }}>核准並恢復帳號</button>
    </div> : <section className="moderation-case-panel"><h2>審核結果</h2><p>{detail.status === 'approved' ? '已核准' : '已駁回'}</p><p>{detail.decisionRationale}</p></section>}
    {decision && <div className="modal" role="dialog" aria-modal="true" aria-label={decision === 'approved' ? '核准申訴' : '駁回申訴'}
      onKeyDown={(event) => { if (event.key === 'Escape' && !pending) setDecision(null); }}>
      <form onSubmit={(event) => void submit(event)}><h2>{decision === 'approved' ? '核准申訴' : '駁回申訴'}</h2>
        <label>審核說明<textarea autoFocus value={rationale} maxLength={1000} disabled={pending}
          onChange={(event) => setRationale(event.target.value)} /></label>
        <button type="submit" disabled={pending}>{pending ? '審核處理中' : '確認審核'}</button>
        <button type="button" disabled={pending} onClick={() => setDecision(null)}>取消</button></form></div>}
  </div>;
  return <PageShell width="marketplace" backToMarketplace><section className="moderation-case">
    <p className="eyebrow">Private Admin</p><h1>申訴案件</h1>{content}<a href="#/admin/appeals">返回申訴案件</a>
  </section></PageShell>;
}
