import { useEffect, useRef, useState } from 'react';
import type { AccountAppealDetail } from '../../domain/models';
import { getOwnAccountAppeal, submitAccountAppeal } from '../../data/firestore/repositories';
import { uploadAccountAppealEvidence } from '../../data/storage/storageService';

interface Props {
  uid: string;
  suspensionActionId: string;
  createId?: () => string;
}

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const defaultCreateId = () => crypto.randomUUID();

export function AccountAppealPanel({
  uid, suspensionActionId, createId = defaultCreateId,
}: Props) {
  const [appeal, setAppeal] = useState<AccountAppealDetail | null>(null);
  const [statement, setStatement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestId = useRef(createId());
  const draftId = useRef(createId());

  useEffect(() => {
    let current = true;
    setState('loading'); setMessage(null);
    void getOwnAccountAppeal({ uid, suspensionActionId }).then((next) => {
      if (!current) return;
      setAppeal(next); setState('ready');
    }).catch(() => {
      if (!current) return;
      setState('error'); setMessage('無法載入申訴狀態，請稍後再試。');
    });
    return () => { current = false; };
  }, [reload, suspensionActionId, uid]);

  function selectFiles(list: FileList | null) {
    const next = Array.from(list ?? []);
    if (next.length > 3 || next.some((file) => (
      !allowedTypes.has(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024
    ))) {
      setMessage('證據限 0–3 張 JPEG、PNG 或 WebP 圖片，每張最多 5 MiB。');
      return;
    }
    setFiles(next); setMessage(null);
  }

  async function submit() {
    if (pendingRef.current) return;
    const trimmed = statement.trim();
    if (trimmed.length < 100 || trimmed.length > 2000 || trimmed !== statement) {
      setMessage('申訴說明需為 100–2,000 個字元，且前後不可留白。');
      return;
    }
    pendingRef.current = true; setPending(true); setMessage(null);
    try {
      const evidence = [];
      for (let slot = 0; slot < files.length; slot += 1) {
        evidence.push(await uploadAccountAppealEvidence(
          uid, suspensionActionId, draftId.current, slot as 0 | 1 | 2, files[slot],
        ));
      }
      const result = await submitAccountAppeal({
        uid, suspensionActionId, requestId: requestId.current, draftId: draftId.current,
        statement, evidence,
      });
      setAppeal(result);
    } catch {
      setMessage('無法提交申訴，請稍後再試。');
    } finally {
      pendingRef.current = false; setPending(false);
    }
  }

  return (
    <section className="dashboard-section account-appeal-panel" aria-labelledby="account-appeal-heading">
      <h2 id="account-appeal-heading">申訴停權</h2>
      {state === 'loading' && <p role="status">申訴狀態載入中</p>}
      {message && <p className="field-error" role="alert">{message}</p>}
      {state === 'error' && (
        <button type="button" onClick={() => setReload((value) => value + 1)}>重試載入</button>
      )}
      {state === 'ready' && !appeal && (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p>每次停權只能提交一次申訴。送出後內容與證據不能修改。</p>
          <label>
            申訴說明
            <textarea
              value={statement}
              minLength={100}
              maxLength={2000}
              onChange={(event) => setStatement(event.target.value)}
              disabled={pending}
            />
          </label>
          <p>{statement.length} / 2,000</p>
          <label>
            申訴證據
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => selectFiles(event.target.files)}
              disabled={pending}
            />
          </label>
          {files.length > 0 && (
            <div>
              <p>已選擇 {files.length} 張圖片</p>
              <ul className="appeal-evidence-preview">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                    >
                      移除 {file.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="submit" disabled={pending}>
            {pending ? '申訴提交中' : '提交申訴'}
          </button>
        </form>
      )}
      {state === 'ready' && appeal?.status === 'submitted' && (
        <p role="status">申訴已提交，等待管理員審核。</p>
      )}
      {state === 'ready' && appeal?.status === 'dismissed' && (
        <><p role="status">申訴未獲核准。</p><p>審核說明：{appeal.decisionRationale}</p></>
      )}
      {state === 'ready' && appeal?.status === 'approved' && (
        <><p role="status">申訴已核准，帳號已恢復。</p><p>審核說明：{appeal.decisionRationale}</p></>
      )}
    </section>
  );
}
