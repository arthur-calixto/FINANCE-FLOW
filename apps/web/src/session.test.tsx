import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { MeResponse } from '@finance-flow/types';
const sdk = vi.hoisted(() => ({
  callback: null as
    ((event: AuthChangeEvent, session: Session | null) => void) | null,
  unsubscribe: vi.fn(),
  signOut: vi.fn(),
  getMe: vi.fn(),
  selectWorkspace: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: typeof sdk.callback) => {
        sdk.callback = cb;
        return { data: { subscription: { unsubscribe: sdk.unsubscribe } } };
      },
      signOut: () => sdk.signOut(),
    },
  },
}));
vi.mock('./api', () => ({
  getMe: (...args: unknown[]) => sdk.getMe(...args),
  selectWorkspace: (...args: unknown[]) => sdk.selectWorkspace(...args),
}));
import { AuthProvider, useAuth } from './auth';
function Probe() {
  const a = useAuth();
  return (
    <>
      <p>{a.loading ? 'loading' : a.session ? 'signed-in' : 'signed-out'}</p>
      <p>{a.me?.user.name ?? 'no-domain-user'}</p>
      <p>{a.activeWorkspaceId ?? 'no-workspace'}</p>
      <p>{a.recovery ? 'recovery' : 'normal'}</p>
      <button onClick={() => void a.signOut()}>Logout</button>
    </>
  );
}
const session = {
  access_token: 'sdk-test-placeholder',
  user: { id: 'auth-user-a' },
} as Session;
const me: MeResponse = {
  user: { id: 'domain-user-a', name: 'Arthur', email: 'a@example.com' },
  workspaces: [
    { id: 'workspace-a', name: 'Pessoal', type: 'PERSONAL', role: 'OWNER' },
  ],
};
async function emit(event: AuthChangeEvent, value: Session | null) {
  await act(async () => sdk.callback!(event, value));
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
it('restaura sessão, bootstrap e ignora preferência de outro workspace', async () => {
  localStorage.setItem('ff:workspace:auth-user-a', 'another-tenant');
  sdk.getMe.mockResolvedValue(me);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(screen.getByText('loading')).toBeTruthy();
  await emit('INITIAL_SESSION', session);
  await waitFor(() => expect(screen.getByText('Arthur')).toBeTruthy());
  expect(screen.getByText('workspace-a')).toBeTruthy();
  expect(localStorage.getItem('ff:workspace:auth-user-a')).toBe('workspace-a');
});
it('logout limpa sessão, domínio e workspace mesmo com callback antes do retorno', async () => {
  sdk.getMe.mockResolvedValue(me);
  sdk.signOut.mockImplementation(async () => {
    sdk.callback!('SIGNED_OUT', null);
    return { error: null };
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await emit('SIGNED_IN', session);
  await waitFor(() => expect(screen.getByText('Arthur')).toBeTruthy());
  await act(async () => screen.getByText('Logout').click());
  expect(screen.getByText('signed-out')).toBeTruthy();
  expect(screen.getByText('no-workspace')).toBeTruthy();
  expect(screen.getByText('no-domain-user')).toBeTruthy();
  expect(localStorage.getItem('ff:workspace:auth-user-a')).toBeNull();
});
it('descarta resposta pendente de /me depois de logout', async () => {
  let resolve!: (value: MeResponse) => void;
  sdk.getMe.mockReturnValue(
    new Promise<MeResponse>((r) => {
      resolve = r;
    }),
  );
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await emit('SIGNED_IN', session);
  await emit('SIGNED_OUT', null);
  await act(async () => resolve(me));
  expect(screen.getByText('no-domain-user')).toBeTruthy();
  expect(screen.getByText('no-workspace')).toBeTruthy();
});
it('recuperação não executa bootstrap e mantém estado até redefinição', async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await emit('PASSWORD_RECOVERY', session);
  expect(screen.getByText('recovery')).toBeTruthy();
  expect(sdk.getMe).not.toHaveBeenCalled();
});
it('remove listener ao desmontar', () => {
  const view = render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  view.unmount();
  expect(sdk.unsubscribe).toHaveBeenCalledOnce();
});

it('403 com JWT válido atualiza memberships e abandona workspace revogado', async () => {
  const shared: MeResponse = {
    ...me,
    workspaces: [
      ...me.workspaces,
      { id: 'family', name: 'Família', type: 'FAMILY', role: 'MEMBER' },
    ],
  };
  localStorage.setItem('ff:workspace:auth-user-a', 'family');
  sdk.getMe.mockResolvedValue(shared);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await emit('SIGNED_IN', session);
  await screen.findByText('family');
  sdk.getMe.mockResolvedValue(me);
  await act(async () =>
    window.dispatchEvent(new Event('ff:workspace-forbidden')),
  );
  await screen.findByText('workspace-a');
  expect(screen.queryByText('family')).toBeNull();
  expect(screen.getByText('signed-in')).toBeTruthy();
});
