import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { Button, Card, ErrorState, Select } from './ui';
export function AppShell() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  const workspace = auth.me?.workspaces.find(
    (w) => w.id === auth.activeWorkspaceId,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/app" className="brand">
          <span className="brand-mark" aria-hidden="true">
            f.
          </span>
          <span>
            FINANCE<span className="brand-flow">FLOW</span>
          </span>
        </Link>
        <div className="workspace-picker">
          <span className="eyebrow">Seu espaço</span>
          {(auth.me?.workspaces.length ?? 0) > 1 ? (
            <label className="sr-only-label">
              Workspace
              <Select
                aria-label="Workspace"
                value={auth.activeWorkspaceId ?? ''}
                disabled={busy}
                onChange={(e) =>
                  void run(() => auth.switchWorkspace(e.target.value))
                }
              >
                {auth.me?.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <strong>{workspace?.name ?? 'Nenhum workspace'}</strong>
          )}
        </div>
        <nav aria-label="Navegação principal" className="main-nav">
          <span className="nav-caption">Organize sua vida financeira</span>
          <NavLink to="/app" end>
            ⌂ <span>Visão geral</span>
          </NavLink>
          <NavLink to="/app/transactions">
            ↗ <span>Lançamentos</span>
          </NavLink>
          <NavLink to="/app/accounts">
            ▣ <span>Contas</span>
          </NavLink>
          <NavLink to="/app/credit-cards">
            ▤ <span>Cartões</span>
          </NavLink>
          <NavLink to="/app/categories">
            ⌑ <span>Categorias</span>
          </NavLink>
        </nav>
        <div className="sidebar-note">
          Um lugar para cuidar
          <br />
          do que é importante.
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <span>
            {workspace?.name ?? 'Seu workspace'}{' '}
            <span className="muted">/ Organização</span>
          </span>
          <div className="user-menu">
            <span className="avatar" aria-hidden="true">
              {auth.me?.user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="user-name">{auth.me?.user.name}</span>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void run(auth.signOut)}
            >
              Sair
            </Button>
          </div>
        </header>
        <main className="app-content">
          {error && <ErrorState message={error} />}
          {auth.error ? (
            <ErrorState message={auth.error} retry={auth.retry} />
          ) : !auth.activeWorkspaceId ? (
            <ErrorState message="Você não possui um workspace disponível." />
          ) : (
            <div key={auth.activeWorkspaceId}>
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
export function Overview() {
  const auth = useAuth();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Seu dinheiro, com mais clareza</span>
          <h1>Olá, {auth.me?.user.name.split(' ')[0]}.</h1>
          <p>Vamos organizar a base da sua vida financeira?</p>
        </div>
      </div>
      <div className="welcome-grid">
        <Card>
          <span className="feature-symbol" aria-hidden="true">
            ▣
          </span>
          <h2>Suas contas, em um só lugar</h2>
          <p>
            Comece pelas contas que você usa no dia a dia e informe o saldo de
            partida.
          </p>
          <Link className="button button-primary" to="/app/accounts">
            Organizar contas →
          </Link>
        </Card>
        <Card>
          <span className="feature-symbol" aria-hidden="true">
            ⌑
          </span>
          <h2>Cada coisa no seu lugar</h2>
          <p>
            Crie categorias que façam sentido para a sua rotina, do mercado ao
            salário.
          </p>
          <Link className="button button-secondary" to="/app/categories">
            Organizar categorias →
          </Link>
        </Card>
      </div>
    </>
  );
}
