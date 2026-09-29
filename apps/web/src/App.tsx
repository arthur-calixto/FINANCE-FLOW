import { Transactions } from './resources/Transactions';
import { AppShell, Overview } from './Shell';
import { Accounts } from './resources/Accounts';
import { Categories } from './resources/Categories';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import {
  z,
  loginSchema,
  registerSchema,
  passwordSchema,
} from '@finance-flow/validation';
import { AuthProvider, useAuth } from './auth';
import { configurationError, supabase } from './supabase';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <p role="status">Carregando…</p>;
  if (!auth.session) return <Navigate to="/login" replace />;
  if (auth.recovery) return <Navigate to="/reset-password" replace />;
  return children;
}
function AuthForm({
  mode,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset';
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const title = {
    login: 'Entrar',
    register: 'Criar conta',
    forgot: 'Recuperar senha',
    reset: 'Redefinir senha',
  }[mode];
  if (auth.loading && mode !== 'reset') return <p role="status">Carregando…</p>;
  if (auth.session && (mode === 'login' || mode === 'register'))
    return <Navigate to={auth.recovery ? '/reset-password' : '/app'} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      if (mode === 'login') {
        const v = loginSchema.parse(values);
        await auth.signIn(v.email, v.password);
      }
      if (mode === 'register') {
        const v = registerSchema.parse(values);
        const confirmation = await auth.signUp(v.name, v.email, v.password);
        if (confirmation) {
          setMessage(
            'Confira seu e-mail e confirme o endereço pelo link recebido. Depois, faça login.',
          );
          form.reset();
        }
      }
      if (mode === 'forgot') {
        const email = z.email().parse(values.email);
        const { error } = await supabase!.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error)
          throw new Error(
            'Não foi possível enviar a solicitação. Tente novamente mais tarde.',
          );
        setMessage(
          'Se houver uma conta para este e-mail, você receberá um link para redefinir a senha.',
        );
      }
      if (mode === 'reset') {
        const v = passwordSchema.parse(values);
        if (!auth.session)
          throw new Error(
            'Abra um link válido de recuperação enviado por e-mail.',
          );
        const { error } = await supabase!.auth.updateUser({
          password: v.password,
        });
        if (error)
          throw new Error(
            'Não foi possível atualizar a senha. Solicite um novo link ou use outra senha.',
          );
        await auth.signOut();
        auth.completeRecovery();
        navigate('/login', { replace: true });
      }
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues[0].message
          : e instanceof Error
            ? e.message
            : 'Não foi possível concluir.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <Link className="auth-brand" to="/login">
        FINANCE FLOW
      </Link>
      <section className="card">
        <h2>{title}</h2>
        {mode === 'reset' && !auth.session ? (
          <p role="status">
            Abra o link de recuperação enviado por e-mail. Se expirou,{' '}
            <Link to="/forgot-password">solicite outro</Link>.
          </p>
        ) : (
          <form onSubmit={submit}>
            {mode === 'register' && (
              <label>
                Nome
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={120}
                />
              </label>
            )}
            {mode !== 'reset' && (
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  required
                  minLength={mode === 'login' ? 1 : 8}
                />
              </label>
            )}
            {(mode === 'register' || mode === 'reset') && (
              <label>
                Confirmar senha
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            <button disabled={busy}>{busy ? 'Aguarde…' : title}</button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <nav>
          <Link to="/login">Entrar</Link>
          <Link to="/register">Criar conta</Link>
          <Link to="/forgot-password">Esqueci minha senha</Link>
        </nav>
      </section>
    </main>
  );
}
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthForm key="login" mode="login" />} />
      <Route
        path="/register"
        element={<AuthForm key="register" mode="register" />}
      />
      <Route
        path="/forgot-password"
        element={<AuthForm key="forgot" mode="forgot" />}
      />
      <Route
        path="/reset-password"
        element={<AuthForm key="reset" mode="reset" />}
      />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Overview />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="categories" element={<Categories />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
export default function App() {
  return (
    <>
      {configurationError ? (
        <p role="alert">{configurationError}</p>
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      )}
    </>
  );
}
