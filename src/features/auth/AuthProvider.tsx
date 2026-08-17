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
  signInWithGoogle,
  signOutUser,
} from './authService';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthUserChanged((nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    }, (caughtError) => {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Authentication state could not be loaded.',
      );
      setIsLoading(false);
    });
  }, []);

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
    () => ({ user, isLoading, error, signIn, signOut }),
    [error, isLoading, signIn, signOut, user],
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
