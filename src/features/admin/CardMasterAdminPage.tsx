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
  addCardMasterEntry,
  editCardMasterEntry,
  listCardMasterArchives,
  listCardsFromServer,
  type AddCardMasterEntryInput,
  type EditCardMasterEntryInput,
} from '../../data/firestore/repositories';
import { CARD_TYPES, cardTypeLabel } from '../../domain/cardType';
import type {
  Card,
  CardMasterArchive,
  CardMasterArchivePage,
  CardMasterMutationResult,
} from '../../domain/models';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import {
  cardMasterAdminFormFromCard,
  cardMasterFingerprint,
  emptyCardMasterAdminForm,
  validateCardMasterAdminForm,
  type CardMasterAdminFormErrors,
  type CardMasterAdminFormState,
} from './cardMasterAdminForm';

interface CardMasterAdminPageProps {
  loadCards?: () => Promise<Card[]>;
  loadArchives?: (input: { limit?: number; cursor?: CardMasterArchivePage['nextCursor'] }) => Promise<CardMasterArchivePage>;
  addEntry?: (input: AddCardMasterEntryInput) => Promise<CardMasterMutationResult>;
  editEntry?: (input: EditCardMasterEntryInput) => Promise<CardMasterMutationResult>;
}

function matchesPrefix(card: Card, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-Hant');
  if (!normalized) return true;
  return [card.cardType, card.cardName, card.cardId, ...card.rarities]
    .some((value) => value.toLocaleLowerCase('zh-Hant').startsWith(normalized));
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code.replace(/^functions\//u, '') : null;
}

function CardFields({
  form,
  errors,
  idPrefix,
  pending,
  onChange,
}: {
  form: CardMasterAdminFormState;
  errors: CardMasterAdminFormErrors;
  idPrefix: string;
  pending: boolean;
  onChange: (next: CardMasterAdminFormState) => void;
}) {
  return (
    <div className="admin-card-form-fields">
      <label htmlFor={`${idPrefix}-type`}>
        <FieldLabel required>卡片類型</FieldLabel>
        <select
          id={`${idPrefix}-type`}
          value={form.cardType}
          disabled={pending}
          onChange={(event) => onChange({ ...form, cardType: event.target.value as CardMasterAdminFormState['cardType'] })}
        >
          {CARD_TYPES.map((type) => <option key={type} value={type}>{cardTypeLabel(type)}</option>)}
        </select>
      </label>
      <FieldError message={errors.cardType} />
      <label htmlFor={`${idPrefix}-name`}>
        <FieldLabel required>卡片名稱</FieldLabel>
        <input
          id={`${idPrefix}-name`}
          value={form.cardName}
          disabled={pending}
          onChange={(event) => onChange({ ...form, cardName: event.target.value })}
        />
      </label>
      <FieldError message={errors.cardName} />
      <label htmlFor={`${idPrefix}-id`}>
        <FieldLabel required>卡片 ID</FieldLabel>
        <input
          id={`${idPrefix}-id`}
          value={form.cardId}
          disabled={pending}
          autoCapitalize="characters"
          onChange={(event) => onChange({ ...form, cardId: event.target.value })}
        />
      </label>
      <FieldError message={errors.cardId} />
      <fieldset className="admin-card-rarities">
        <legend><FieldLabel required>稀有度</FieldLabel></legend>
        {form.rarities.map((rarity, index) => (
          <div className="admin-card-rarity-row" key={`${idPrefix}-rarity-${index}`}>
            <label htmlFor={`${idPrefix}-rarity-${index}`}>稀有度 {index + 1}</label>
            <input
              id={`${idPrefix}-rarity-${index}`}
              value={rarity}
              disabled={pending}
              onChange={(event) => onChange({
                ...form,
                rarities: form.rarities.map((value, current) => (
                  current === index ? event.target.value : value
                )),
              })}
            />
            {form.rarities.length > 1 && (
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                aria-label={`移除稀有度 ${index + 1}`}
                onClick={() => onChange({
                  ...form,
                  rarities: form.rarities.filter((_, current) => current !== index),
                })}
              >移除</button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          disabled={pending || form.rarities.length >= 20}
          onClick={() => onChange({ ...form, rarities: [...form.rarities, ''] })}
        >新增另一個稀有度</button>
      </fieldset>
      <FieldError message={errors.rarities} />
      <label htmlFor={`${idPrefix}-rationale`}>
        <FieldLabel required>異動原因</FieldLabel>
        <textarea
          id={`${idPrefix}-rationale`}
          value={form.rationale}
          disabled={pending}
          maxLength={500}
          onChange={(event) => onChange({ ...form, rationale: event.target.value })}
        />
      </label>
      <FieldError message={errors.rationale} />
    </div>
  );
}

function CardSummary({ card }: { card: Card }) {
  return (
    <div className="admin-card-summary">
      <strong>{card.cardName}</strong>
      <span>{card.cardType}</span>
      <span>{card.cardId}</span>
      <span>{card.rarities.join(' / ')}</span>
    </div>
  );
}

export function CardMasterAdminPage({
  loadCards = listCardsFromServer,
  loadArchives = listCardMasterArchives,
  addEntry = addCardMasterEntry,
  editEntry = editCardMasterEntry,
}: CardMasterAdminPageProps) {
  const { accountAccessState, adminAccessState, signIn, user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [archives, setArchives] = useState<CardMasterArchive[]>([]);
  const [nextArchiveCursor, setNextArchiveCursor] = useState<CardMasterArchivePage['nextCursor']>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [addForm, setAddForm] = useState(emptyCardMasterAdminForm);
  const [addErrors, setAddErrors] = useState<CardMasterAdminFormErrors>({});
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState<Card | null>(null);
  const [editForm, setEditForm] = useState(emptyCardMasterAdminForm);
  const [editErrors, setEditErrors] = useState<CardMasterAdminFormErrors>({});
  const [editError, setEditError] = useState('');
  const [editIsStale, setEditIsStale] = useState(false);
  const editTriggerRef = useRef<HTMLElement | null>(null);
  const editNameRef = useRef<HTMLInputElement | null>(null);
  const isAdmin = adminAccessState.state === 'admin';

  async function reload() {
    setLoaded(false);
    setLoadError(false);
    try {
      const [nextCards, archivePage] = await Promise.all([
        loadCards(),
        loadArchives({ limit: 100 }),
      ]);
      setCards(nextCards);
      setArchives(archivePage.archives);
      setNextArchiveCursor(archivePage.nextCursor);
      setLoaded(true);
    } catch {
      setLoadError(true);
      setLoaded(true);
    }
  }

  useEffect(() => {
    let current = true;
    if (!isAdmin) {
      setCards([]);
      setArchives([]);
      setLoaded(false);
      return () => { current = false; };
    }
    setLoaded(false);
    setLoadError(false);
    void Promise.all([loadCards(), loadArchives({ limit: 100 })])
      .then(([nextCards, archivePage]) => {
        if (!current) return;
        setCards(nextCards);
        setArchives(archivePage.archives);
        setNextArchiveCursor(archivePage.nextCursor);
      })
      .catch(() => { if (current) setLoadError(true); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [isAdmin, loadArchives, loadCards, user?.uid]);

  useEffect(() => {
    if (editing) {
      editNameRef.current?.focus();
    }
  }, [editing]);

  function closeEdit() {
    if (pending) return;
    setEditing(null);
    setEditError('');
    setEditIsStale(false);
    requestAnimationFrame(() => editTriggerRef.current?.focus());
  }

  function openEdit(card: Card, trigger: HTMLElement) {
    editTriggerRef.current = trigger;
    setEditing(card);
    setEditForm(cardMasterAdminFormFromCard(card));
    setEditErrors({});
    setEditError('');
    setEditIsStale(false);
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const result = validateCardMasterAdminForm(addForm);
    setAddForm(result.values);
    setAddErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    setPending(true);
    setFeedback('');
    try {
      const saved = await addEntry(result.values);
      setCards((current) => [...current.filter(({ key }) => key !== saved.card.key), saved.card]);
      setAddForm(emptyCardMasterAdminForm());
      setFeedback('新增完成');
    } catch {
      setFeedback('新增失敗，請稍後再試。');
    } finally {
      setPending(false);
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (pending || !editing) return;
    const result = validateCardMasterAdminForm(editForm);
    setEditForm(result.values);
    setEditErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    setPending(true);
    setEditError('');
    setEditIsStale(false);
    try {
      const expectedFingerprint = await cardMasterFingerprint(editing);
      const saved = await editEntry({
        sourceCardKey: editing.key,
        expectedFingerprint,
        ...result.values,
      });
      setCards((current) => [
        ...current.filter(({ key }) => key !== editing.key && key !== saved.card.key),
        saved.card,
      ]);
      setFeedback('修改完成');
      setEditing(null);
      requestAnimationFrame(() => editTriggerRef.current?.focus());
      if (saved.retiredCardKey) void reload();
    } catch (error) {
      const stale = errorCode(error) === 'aborted';
      setEditIsStale(stale);
      setEditError(stale
        ? '卡片已被其他操作更新，請重新載入後再試。'
        : '修改失敗，請稍後再試。');
    } finally {
      setPending(false);
    }
  }

  async function loadMoreArchives() {
    if (!nextArchiveCursor || pending) return;
    setPending(true);
    try {
      const page = await loadArchives({ limit: 100, cursor: nextArchiveCursor });
      setArchives((current) => [...current, ...page.archives]);
      setNextArchiveCursor(page.nextCursor);
    } catch {
      setFeedback('無法載入更多封存卡片。');
    } finally {
      setPending(false);
    }
  }

  const filteredCards = cards.filter((card) => matchesPrefix(card, search));
  const filteredArchives = archives.filter((card) => matchesPrefix(card, search));

  let content;
  if (!user) {
    content = <div className="profile-state"><p>請先使用 Google 登入，才能使用管理工具。</p><button type="button" onClick={signIn}>使用 Google 登入</button></div>;
  } else if (accountAccessState.state === 'suspended') {
    content = <AccountAccessNotice state={accountAccessState} />;
  } else if (adminAccessState.state === 'loading') {
    content = <p role="status">管理權限確認中</p>;
  } else if (adminAccessState.state === 'unavailable') {
    content = <div className="profile-state"><p role="alert">無法確認管理權限，請重新整理後再試。</p><a href="#">返回市集</a></div>;
  } else if (!isAdmin) {
    content = <div className="profile-state"><p role="alert">無權限使用管理工具</p><a href="#">返回市集</a></div>;
  } else if (!loaded) {
    content = <p role="status">卡片資料載入中</p>;
  } else if (loadError) {
    content = <div className="profile-state"><p role="alert">無法載入卡片資料。</p><button type="button" onClick={() => void reload()}>重新載入卡片資料</button></div>;
  } else {
    content = (
      <div className="admin-card-content">
        <section className="admin-card-panel" aria-labelledby="admin-card-add-heading">
          <h2 id="admin-card-add-heading">新增卡片</h2>
          <form className="profile-form admin-card-form" noValidate onSubmit={submitAdd}>
            <CardFields form={addForm} errors={addErrors} idPrefix="admin-card-add" pending={pending} onChange={setAddForm} />
            <button type="submit" disabled={pending}>{pending ? '新增中' : '新增卡片'}</button>
          </form>
        </section>

        <label className="admin-card-search">
          <FieldLabel>搜尋卡片資料</FieldLabel>
          <input type="search" aria-label="搜尋卡片資料" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>

        <section className="admin-card-panel" aria-labelledby="active-card-heading">
          <h2 id="active-card-heading">現行卡片</h2>
          <ul className="admin-card-list" aria-label="現行卡片清單">
            {filteredCards.map((card) => (
              <li key={card.key}>
                <CardSummary card={card} />
                <button type="button" aria-label={`編輯${card.cardName}`} onClick={(event) => openEdit(card, event.currentTarget)}>編輯</button>
              </li>
            ))}
          </ul>
          {filteredCards.length === 0 && <p>沒有符合的現行卡片。</p>}
        </section>

        <section className="admin-card-panel" aria-labelledby="archive-card-heading">
          <h2 id="archive-card-heading">已停用與取代</h2>
          <ul className="admin-card-list" aria-label="封存卡片清單">
            {filteredArchives.map((card) => (
              <li key={card.key}>
                <CardSummary card={card} />
                <span>{card.disposition}</span>
                <span>{card.rationale}</span>
              </li>
            ))}
          </ul>
          {filteredArchives.length === 0 && <p>沒有符合的封存卡片。</p>}
          {nextArchiveCursor && <button type="button" disabled={pending} onClick={() => void loadMoreArchives()}>載入更多封存卡片</button>}
        </section>
      </div>
    );
  }

  return (
    <PageShell width="marketplace" backToMarketplace>
      <section className="admin-card-page">
        <p className="eyebrow">Private Admin</p>
        <h1>卡片資料管理</h1>
        <div data-testid="admin-card-feedback" className="admin-card-feedback" aria-live="polite" aria-atomic="true">
          {feedback && <p role="status">{feedback}</p>}
        </div>
        {content}
      </section>

      {editing && (
        <div className="admin-card-dialog-backdrop">
          <section
            className="modal admin-card-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-card-edit-heading"
            onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
              if (event.key === 'Escape') closeEdit();
            }}
          >
            <h2 id="admin-card-edit-heading">編輯卡片</h2>
            <form className="profile-form admin-card-form" noValidate onSubmit={submitEdit}>
              <div ref={(node) => { editNameRef.current = node?.querySelector('input') ?? null; }}>
                <CardFields form={editForm} errors={editErrors} idPrefix="admin-card-edit" pending={pending} onChange={setEditForm} />
              </div>
              {editError && <p className="field-error" role="alert">{editError}</p>}
              {editIsStale && (
                <button type="button" className="secondary-button" disabled={pending} onClick={() => void reload()}>重新載入卡片資料</button>
              )}
              <div className="admin-card-dialog-actions">
                <button type="button" className="secondary-button" disabled={pending} onClick={closeEdit}>取消</button>
                <button type="submit" disabled={pending}>{pending ? '儲存中' : '儲存修改'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </PageShell>
  );
}
