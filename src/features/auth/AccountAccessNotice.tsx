import type { AccountAccessState } from './AuthProvider';

export function AccountAccessNotice({ state }: { state: AccountAccessState }) {
  if (state.state === 'suspended') {
    return (
      <section className="account-access-notice" role="status" aria-live="polite">
        <p>帳號目前已停權，仍可瀏覽公開市集。</p>
        {state.access.suspensionReason && (
          <p>停權原因：{state.access.suspensionReason}</p>
        )}
      </section>
    );
  }

  if (state.state === 'unavailable') {
    return (
      <section className="account-access-notice" role="status" aria-live="polite">
        <p>{state.message}</p>
      </section>
    );
  }

  return null;
}
