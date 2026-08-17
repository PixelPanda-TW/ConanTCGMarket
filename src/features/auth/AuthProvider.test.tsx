import { beforeEach, describe, expect, it, vi } from 'vitest';

const react = vi.hoisted(() => ({
  createContext: vi.fn(() => ({ Provider: 'AuthProvider' })),
  useCallback: vi.fn((callback) => callback),
  useContext: vi.fn(),
  useEffect: vi.fn((effect) => effect()),
  useMemo: vi.fn((factory) => factory()),
  useState: vi.fn(),
}));

let observerError: ((error: Error) => void) | undefined;

const authService = vi.hoisted(() => ({
  onAuthUserChanged: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
}));

vi.mock('react', () => react);
vi.mock('./authService', () => authService);

import { AuthProvider } from './AuthProvider';

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observerError = undefined;
    authService.onAuthUserChanged.mockImplementation((_onUser, onError) => {
      observerError = onError;
      return vi.fn();
    });
  });

  it('stops loading and exposes an error when the auth observer fails', () => {
    const setUser = vi.fn();
    const setIsLoading = vi.fn();
    const setError = vi.fn();
    react.useState
      .mockReturnValueOnce([null, setUser])
      .mockReturnValueOnce([true, setIsLoading])
      .mockReturnValueOnce([null, setError]);

    AuthProvider({ children: null });

    expect(observerError).toEqual(expect.any(Function));
    observerError?.(new Error('Authentication observer failed.'));

    expect(setError).toHaveBeenCalledWith('Authentication observer failed.');
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });
});
