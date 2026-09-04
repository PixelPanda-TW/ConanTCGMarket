import { useCallback, useEffect, useRef, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { listModerationCases } from '../../data/firestore/repositories';
import { cardTypeLabel } from '../../domain/cardType';
import {
  MODERATION_CASE_FILTERS,
  type ModerationCaseFilter,
  type ModerationCasePage,
  type ModerationCaseSummary,
} from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';

interface ModerationQueuePageProps {
  loadCases?: typeof listModerationCases;
}

const filterLabels: Record<ModerationCaseFilter, string> = {
  all: '全部',
  open: '待審查',
  dismissed: '已駁回',
  confirmed: '已確認違規',
};

const categoryLabels: Record<ModerationCaseSummary['category'], string> = {
  suspected_counterfeit: '疑似偽卡',
  listing_mismatch: '商品資訊不符',
  fraud_or_harassment: '詐騙或騷擾',
  prohibited_content: '禁止內容',
  other: '其他',
};

function statusLabel(item: ModerationCaseSummary): string {
  if (item.status === 'open') return '待審查';
  if (item.status === 'dismissed') return '已駁回';
  return '已確認違規';
}

function CaseSummary({ item }: { item: ModerationCaseSummary }) {
  const listing = item.listingSnapshot;
  return (
    <li className="moderation-queue-item">
      <div className="moderation-queue-item__heading">
        <strong>{listing.cardName}</strong>
        <span className={`moderation-status moderation-status--${item.status}`}>
          {statusLabel(item)}
        </span>
      </div>
      <dl className="moderation-queue-meta">
        <div><dt>檢舉原因</dt><dd>{categoryLabels[item.category]}</dd></div>
        <div><dt>卡片</dt><dd>{cardTypeLabel(listing.cardType)} · {listing.cardId} · {listing.rarity}</dd></div>
        <div><dt>刊登價格</dt><dd>NT$ {listing.listingPrice.toLocaleString('zh-TW')}</dd></div>
        <div><dt>賣家 ID</dt><dd>{item.targetSellerId}</dd></div>
        <div><dt>提出時間</dt><dd>{item.openedAt.toLocaleString('zh-TW')}</dd></div>
        {item.status === 'confirmed' && (
          <div><dt>確認後累計</dt><dd>累計 {item.resultingConfirmedViolationCount} 次</dd></div>
        )}
      </dl>
      <a
        className="moderation-queue-link"
        href={`#/admin/moderation/${encodeURIComponent(item.reportId)}`}
        aria-label={`查看 ${item.reportId}`}
      >查看案件</a>
    </li>
  );
}

export function ModerationQueuePage({
  loadCases = listModerationCases,
}: ModerationQueuePageProps) {
  const { accountAccessState, adminAccessState, signIn, user } = useAuth();
  const [filter, setFilter] = useState<ModerationCaseFilter>('all');
  const [cases, setCases] = useState<ModerationCaseSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<ModerationCasePage['nextCursor']>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [morePending, setMorePending] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const scopeRef = useRef(0);
  const isAdmin = adminAccessState.state === 'admin';

  useEffect(() => {
    scopeRef.current += 1;
    const scope = scopeRef.current;
    if (!isAdmin) {
      setCases([]);
      setNextCursor(null);
      setLoaded(false);
      setLoadError(false);
      setMorePending(false);
      return undefined;
    }
    setCases([]);
    setNextCursor(null);
    setLoaded(false);
    setLoadError(false);
    setMorePending(false);
    void loadCases({ status: filter, limit: 20, cursor: null })
      .then((page) => {
        if (scopeRef.current !== scope) return;
        setCases(page.cases);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (scopeRef.current === scope) setLoadError(true);
      })
      .finally(() => {
        if (scopeRef.current === scope) setLoaded(true);
      });
    return () => {
      if (scopeRef.current === scope) scopeRef.current += 1;
    };
  }, [filter, isAdmin, loadCases, reloadVersion, user?.uid]);

  const retry = useCallback(() => setReloadVersion((current) => current + 1), []);

  async function loadMore() {
    if (!isAdmin || !nextCursor || morePending) return;
    const scope = scopeRef.current;
    const cursor = nextCursor;
    setMorePending(true);
    try {
      const page = await loadCases({ status: filter, limit: 20, cursor });
      if (scopeRef.current !== scope) return;
      setCases((current) => {
        const known = new Set(current.map(({ reportId }) => reportId));
        return [...current, ...page.cases.filter(({ reportId }) => !known.has(reportId))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (scopeRef.current === scope) setLoadError(true);
    } finally {
      if (scopeRef.current === scope) setMorePending(false);
    }
  }

  let content;
  if (!user) {
    content = (
      <div className="profile-state">
        <p>請先使用 Google 登入，才能查看檢舉案件。</p>
        <button type="button" onClick={signIn}>使用 Google 登入</button>
      </div>
    );
  } else if (accountAccessState.state === 'suspended') {
    content = <AccountAccessNotice state={accountAccessState} />;
  } else if (adminAccessState.state === 'loading') {
    content = <p role="status">管理權限確認中</p>;
  } else if (adminAccessState.state === 'unavailable') {
    content = <div className="profile-state"><p role="alert">無法確認管理權限，請重新整理後再試。</p><a href="#">返回市集</a></div>;
  } else if (!isAdmin) {
    content = <div className="profile-state"><p role="alert">無權限查看檢舉案件</p><a href="#">返回市集</a></div>;
  } else {
    content = (
      <>
        <div className="moderation-queue-filters" role="tablist" aria-label="案件狀態篩選">
          {MODERATION_CASE_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={filter === status}
              className={filter === status ? 'is-active' : ''}
              onClick={() => setFilter(status)}
            >{filterLabels[status]}</button>
          ))}
        </div>
        {!loaded ? (
          <p role="status">案件載入中</p>
        ) : loadError ? (
          <div className="profile-state">
            <p role="alert">無法載入檢舉案件，請稍後再試。</p>
            <button type="button" onClick={retry}>重新載入案件</button>
          </div>
        ) : cases.length === 0 ? (
          <p className="moderation-queue-empty">目前沒有檢舉案件。</p>
        ) : (
          <>
            <ul className="moderation-queue-list" aria-label="檢舉案件清單">
              {cases.map((item) => <CaseSummary key={item.reportId} item={item} />)}
            </ul>
            {nextCursor && (
              <button type="button" disabled={morePending} onClick={() => void loadMore()}>
                {morePending ? '載入中' : '載入更多'}
              </button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <PageShell width="marketplace" backToMarketplace>
      <section className="moderation-queue">
        <p className="eyebrow">Private Admin</p>
        <h1>檢舉案件</h1>
        {content}
      </section>
    </PageShell>
  );
}
