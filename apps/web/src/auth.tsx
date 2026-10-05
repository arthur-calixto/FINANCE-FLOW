import { inviteAuthPath, inviteReturnPath } from './invite-return';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { MeResponse } from '@finance-flow/types';
import { supabase } from './supabase';
import { getMe, selectWorkspace } from './api';

export function chooseWorkspace(ids: string[], remembered: string | null) {
  return remembered && ids.includes(remembered) ? remembered : (ids[0] ?? null);
}
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* Selection remains in memory. */
    }
  },
};
const recoveryStorage = (value?: boolean) => {
  try {
    if (value !== undefined) {
      if (value) sessionStorage.setItem('ff:recovery', '1');
      else sessionStorage.removeItem('ff:recovery');
    }
    return sessionStorage.getItem('ff:recovery') === '1';
  } catch {
    return false;
  }
};
interface AuthContextValue {
  session: Session | null;
  user: Session['user'] | null;
  loading: boolean;
  me: MeResponse | null;
  error: string | null;
  activeWorkspaceId: string | null;
  recovery: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  refreshWorkspaces(preferredId?: string): Promise<void>;
  retry(): void;
  completeRecovery(): void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [activeWorkspaceId, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(recoveryStorage);
  const [attempt, setAttempt] = useState(0);
  const identityRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event, next) => {
      // Callback must remain synchronous: SDK calls here can deadlock its auth lock.
      if (identityRef.current !== next?.user.id) {
        setMe(null);
        setActive(null);
        setError(null);
      }
      if (!next && identityRef.current)
        storage.set(`ff:workspace:${identityRef.current}`, null);
      identityRef.current = next?.user.id;
      if (event === 'PASSWORD_RECOVERY') {
        recoveryStorage(true);
        setRecovery(true);
      }
      if (!next) {
        recoveryStorage(false);
        setRecovery(false);
      }
      setSession(next);
      setInitializing(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  const refreshSequence = useRef(0);
  useEffect(() => {
    if (!session || recovery) return;
    const sequence = ++refreshSequence.current;
    const controller = new AbortController();
    const identity = session.user.id;
    getMe(controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          identityRef.current !== identity ||
          sequence !== refreshSequence.current
        )
          return;
        const key = `ff:workspace:${identity}`;
        const selected = chooseWorkspace(
          result.workspaces.map((w) => w.id),
          storage.get(key),
        );
        setMe(result);
        setActive(selected);
        storage.set(key, selected);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Falha ao carregar a conta.',
          );
      });
    return () => controller.abort();
  }, [session, recovery, attempt]);
  const refreshWorkspaces = useCallback(async (preferredId?: string) => {
    const identity = identityRef.current;
    if (!identity) return;
    const sequence = ++refreshSequence.current;
    const result = await getMe();
    if (
      identityRef.current !== identity ||
      sequence !== refreshSequence.current
    )
      return;
    const key = `ff:workspace:${identity}`;
    const selected = chooseWorkspace(
      result.workspaces.map((w) => w.id),
      preferredId ?? storage.get(key),
    );
    setMe(result);
    setActive(selected);
    storage.set(key, selected);
    setError(null);
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (identityRef.current && me && !recovery)
        void refreshWorkspaces().catch(() => {
          /* Retry on next focus/request. */
        });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('ff:workspace-forbidden', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ff:workspace-forbidden', refresh);
    };
  }, [refreshWorkspaces, recovery, me]);
  const signOut = useCallback(async () => {
    const { error: logoutError } = await supabase!.auth.signOut({
      scope: 'local',
    });
    if (logoutError) throw new Error('Não foi possível sair. Tente novamente.');
    if (identityRef.current)
      storage.set(`ff:workspace:${identityRef.current}`, null);
    setSession(null);
    setMe(null);
    setActive(null);
    setError(null);
    recoveryStorage(false);
    setRecovery(false);
  }, []);
  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading: initializing || (!!session && !recovery && !me && !error),
    me,
    error,
    activeWorkspaceId,
    recovery,
    async signIn(email, password) {
      const { error } = await supabase!.auth.signInWithPassword({
        email,
        password,
      });
      if (error)
        throw new Error(
          'E-mail/senha inválidos ou e-mail ainda não confirmado.',
        );
    },
    async signUp(name, email, password) {
      const { data, error } = await supabase!.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}${inviteAuthPath('/login', inviteReturnPath())}`,
        },
      });
      if (error)
        throw new Error(
          'Não foi possível cadastrar. Confira os dados e tente novamente.',
        );
      return !data.session;
    },
    signOut,
    refreshWorkspaces,
    async switchWorkspace(id) {
      const current = session?.user.id;
      const workspace = await selectWorkspace(id);
      if (identityRef.current !== current) return;
      setActive(workspace.id);
      storage.set(`ff:workspace:${current}`, workspace.id);
    },
    retry() {
      setError(null);
      setAttempt((n) => n + 1);
    },
    completeRecovery() {
      recoveryStorage(false);
      setRecovery(false);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider ausente');
  return value;
}
