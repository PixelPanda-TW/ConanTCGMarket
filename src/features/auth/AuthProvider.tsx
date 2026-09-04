import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type AuthUser,
  onAuthUserChanged,
  resolveAdminClaim,
  signInWithGoogle,
  signOutUser,
} from './authService';
import type { AccountAccess } from '../../domain/models';
import { subscribeAccountAccess } from '../../data/firestore/repositories';

export type AccountAccessState =
  | { state: 'signed-out' }
  | { state: 'loading' }
  | { state: 'active'; access: AccountAccess | null }
  | { state: 'suspended'; access: AccountAccess }
  | { state: 'unavailable'; message: string };

export type AdminAccessState =
  | { state: 'loading' }
  | { state: 'admin' }
  | { state: 'not-admin' }
  | { state: 'unavailable' };

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  accountAccessState: AccountAccessState;
  isActiveAccount: boolean;
  adminAccessState: AdminAccessState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface ObservedAccountAccess {
  uid: string;
  value: AccountAccessState;
}

interface ObservedAdminClaim {
  uid: string;
  value: Exclude<AdminAccessState, { state: 'loading' }>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observedAccess, setObservedAccess] = useState<ObservedAccountAccess | null>(null);
  const [observedAdminClaim, setObservedAdminClaim] = useState<ObservedAdminClaim | null>(null);

  useEffect(() => {
    return onAuthUserChanged((nextUser) => {
      setUser(nextUser);
      setIsAuthResolved(true);
    }, (caughtError) => {
      setUser(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Authentication state could not be loaded.',
      );
      setIsAuthResolved(true);
    });
  }, []);

  useEffect(() => {
    if (!isAuthResolved || !user) {
      setObservedAccess(null);
      return;
    }

    const uid = user.uid;
    let isCurrent = true;
    let unsubscribe: (() => void) | undefined;
    setObservedAccess({ uid, value: { state: 'loading' } });

    try {
      unsubscribe = subscribeAccountAccess(
        uid,
        (access) => {
          if (!isCurrent) return;
          setObservedAccess({
            uid,
            value: access?.status === 'suspended'
              ? { state: 'suspended', access }
              : { state: 'active', access },
          });
        },
        () => {
          if (!isCurrent) return;
          setObservedAccess({
            uid,
            value: {
              state: 'unavailable',
              message: '無法確認帳號狀態，請重新整理後再試。',
            },
          });
        },
      );
    } catch {
      if (isCurrent) {
        setObservedAccess({
          uid,
          value: {
            state: 'unavailable',
            message: '無法確認帳號狀態，請重新整理後再試。',
          },
        });
      }
    }

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, [isAuthResolved, user]);

  useEffect(() => {
    if (!isAuthResolved || !user) {
      setObservedAdminClaim(null);
      return;
    }

    const uid = user.uid;
    let isCurrent = true;
    setObservedAdminClaim(null);
    void resolveAdminClaim(uid).then((isAdmin) => {
      if (!isCurrent) return;
      setObservedAdminClaim({
        uid,
        value: { state: isAdmin ? 'admin' : 'not-admin' },
      });
    }).catch(() => {
      if (!isCurrent) return;
      setObservedAdminClaim({ uid, value: { state: 'unavailable' } });
    });

    return () => {
      isCurrent = false;
    };
  }, [isAuthResolved, user?.uid]);

  const accountAccessState: AccountAccessState = !isAuthResolved
    ? { state: 'loading' }
    : !user
      ? { state: 'signed-out' }
      : observedAccess?.uid === user.uid
        ? observedAccess.value
        : { state: 'loading' };
  const isLoading = !isAuthResolved || (user !== null && accountAccessState.state === 'loading');
  const isActiveAccount = accountAccessState.state === 'active';
  const resolvedAdminClaim = user && observedAdminClaim?.uid === user.uid
    ? observedAdminClaim.value
    : null;
  const adminAccessState: AdminAccessState = !isAuthResolved
    ? { state: 'loading' }
    : !user
      ? { state: 'not-admin' }
      : !resolvedAdminClaim
        ? { state: 'loading' }
        : resolvedAdminClaim.state === 'not-admin'
          ? resolvedAdminClaim
          : resolvedAdminClaim.state === 'unavailable'
            ? resolvedAdminClaim
            : accountAccessState.state === 'active'
              ? { state: 'admin' }
              : accountAccessState.state === 'loading'
                ? { state: 'loading' }
                : accountAccessState.state === 'unavailable'
                  ? { state: 'unavailable' }
                  : { state: 'not-admin' };

  const signIn = useCallback(async () => {
    setError(null);

    try {
      await signInWithGoogle();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Google sign-in failed.');
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);

    try {
      await signOutUser();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Sign-out failed.');
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      error,
      accountAccessState,
      isActiveAccount,
      adminAccessState,
      signIn,
      signOut,
    }),
    [accountAccessState, adminAccessState, error, isActiveAccount, isLoading, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
