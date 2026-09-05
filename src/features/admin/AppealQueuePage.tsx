import { useEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { listAccountAppeals } from '../../data/firestore/repositories';
import type { AccountAppealPage, AccountAppealStatus } from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';

const labels: Record<AccountAppealStatus, string> = {
  submitted: '待審核', dismissed: '已駁回', approved: '已核准',
};
export function AppealQueuePage({ load = listAccountAppeals }: { load?: typeof listAccountAppeals }) {
  const { user, signIn, accountAccessState, adminAccessState } = useAuth();
  const [status, setStatus] = useState<AccountAppealStatus>('submitted');
  const [page, setPage] = useState<AccountAppealPage | null>(null);
  const [error, setError] = useState(false); const [reload, setReload] = useState(0);
  const scope = useRef(0); const isAdmin = adminAccessState.state === 'admin';
  useEffect(() => {
    scope.current += 1; const current = scope.current; setPage(null); setError(false);
    if (!isAdmin) return;
    void load({ status, limit: 20, cursor: null }).then((value) => {
      if (scope.current === current) setPage(value);
    }).catch(() => { if (scope.current === current) setError(true); });
    return () => { if (scope.current === current) scope.current += 1; };
  }, [isAdmin, load, reload, status, user?.uid]);
  let content;
  if (!user) content = <><p>請先使用 Google 登入。</p><button type="button" onClick={signIn}>使用 Google 登入</button></>;
  else if (accountAccessState.state === 'suspended') content = <AccountAccessNotice state={accountAccessState} />;
  else if (adminAccessState.state === 'loading') content = <p role="status">管理權限確認中</p>;
  else if (!isAdmin) content = <p role="alert">無權限查看申訴案件</p>;
  else content = <>
    <div role="tablist" aria-label="申訴狀態篩選" className="moderation-queue-filters">
      {(['submitted', 'dismissed', 'approved'] as const).map((value) => <button
        type="button" role="tab" aria-selected={status === value} key={value}
        onClick={() => setStatus(value)}>{labels[value]}</button>)}
    </div>
    {error ? <><p role="alert">無法載入申訴案件。</p><button type="button" onClick={() => setReload((v) => v + 1)}>重新載入申訴</button></>
      : !page ? <p role="status">申訴案件載入中</p>
        : page.appeals.length === 0 ? <p>目前沒有申訴案件。</p>
          : <ul className="moderation-queue-list" aria-label="申訴案件清單">{page.appeals.map((item) => <li key={item.appealId} className="moderation-queue-item">
            <strong>{labels[item.status]}</strong><p>帳號 ID：{item.targetUid}</p>
            <p>證據：{item.evidenceCount} 張 · {item.submittedAt.toLocaleString('zh-TW')}</p>
            <a href={`#/admin/appeals/${encodeURIComponent(item.appealId)}`}>查看申訴</a>
          </li>)}</ul>}
  </>;
  return <PageShell width="marketplace" backToMarketplace><section className="moderation-queue">
    <p className="eyebrow">Private Admin</p><h1>帳號申訴</h1>{content}
  </section></PageShell>;
}
