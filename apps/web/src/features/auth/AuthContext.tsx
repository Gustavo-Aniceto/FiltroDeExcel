import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthSessionResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@excelflow/contracts';
import { api, setAccessToken, setSessionExpiredHandler } from '@/lib/api-client';

interface AuthContextValue {
  user: PublicUser | null;
  /** true enquanto a sessao inicial e restaurada; evita piscar a tela de login. */
  initializing: boolean;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const applySession = useCallback((session: AuthSessionResponse) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  /**
   * Restauracao de sessao ao abrir o app.
   *
   * O access token vive so em memoria e se perde no reload; o cookie httpOnly
   * de refresh sobrevive. Trocamos um pelo outro no boot -- por isso o usuario
   * continua logado depois de F5 sem que nenhum token fique exposto ao
   * JavaScript.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const restored = await api.tryRestoreSession();
        if (cancelled) return;
        if (restored) {
          const { user: current } = await api.get<{ user: PublicUser }>('/auth/me');
          if (!cancelled) setUser(current);
        }
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  // O cliente HTTP avisa quando o refresh falha de vez; sem isso a interface
  // continuaria mostrando um usuario que ja nao tem sessao.
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    return () => setSessionExpiredHandler(() => undefined);
  }, [clearSession]);

  const login = useCallback(
    async (input: LoginRequest) => {
      applySession(await api.post<AuthSessionResponse>('/auth/login', input));
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      applySession(await api.post<AuthSessionResponse>('/auth/register', input));
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Limpa o estado local mesmo se a chamada falhar: do ponto de vista do
      // usuario, clicar em "sair" tem que sair.
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, initializing, login, register, logout }),
    [user, initializing, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  }
  return context;
}
