import { useAuth } from './AuthProvider';

export function AuthStatus() {
  const { error, isLoading, signIn, signOut, user } = useAuth();

  return (
    <div className="auth-status" aria-live="polite">
      {isLoading ? (
        <span>登入狀態確認中</span>
      ) : user ? (
        <>
          <span>賣家登入中：{user.displayName ?? user.uid}</span>
          <button type="button" onClick={signOut}>
            登出
          </button>
        </>
      ) : (
        <>
          <span>買家可直接瀏覽；賣家上架需登入</span>
          <button type="button" onClick={signIn}>
            使用 Google 登入
          </button>
        </>
      )}
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
