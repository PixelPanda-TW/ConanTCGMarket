import { useAuth } from './AuthProvider';
import { AccountAccessNotice } from './AccountAccessNotice';

export function AuthStatus() {
  const {
    accountAccessState,
    error,
    isActiveAccount,
    isLoading,
    signIn,
    signOut,
    user,
  } = useAuth();

  return (
    <div className="auth-status" aria-live="polite">
      {isLoading ? (
        <span>登入狀態確認中</span>
      ) : user ? (
        <>
          <span>Google 帳號：{user.displayName ?? user.uid}</span>
          <AccountAccessNotice state={accountAccessState} />
          <div className="auth-actions">
            {isActiveAccount && (
              <>
                <a href="#/profile">個人檔案</a>
                <a href="#/sell">我要上架</a>
                <a href="#/dashboard">賣家管理</a>
                <a href="#/notifications">我的訂閱</a>
              </>
            )}
            <button type="button" onClick={signOut}>
              登出
            </button>
          </div>
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
