import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const state = vi.hoisted(() => ({
  activeWorkspaceId: 'family',
  me: {
    workspaces: [
      { id: 'family', name: 'Família Calixto', type: 'FAMILY', role: 'OWNER' },
    ],
  },
  session: {} as object | null,
  user: { email: 'maria@example.com' },
  loading: false,
  refreshWorkspaces: vi.fn().mockResolvedValue(undefined),
  request: vi.fn(),
}));
vi.mock('./auth', () => ({ useAuth: () => state }));
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  apiRequest: (...args: unknown[]) => state.request(...args),
}));
import { WorkspaceSettings, InvitePage } from './sharing';
import { inviteReturnPath } from './invite-return';
const token = 'a'.repeat(43);
const owner = {
  id: 'owner',
  userId: 'arthur',
  name: 'Arthur',
  email: 'arthur@example.com',
  role: 'OWNER',
  joinedAt: '2026-10-05',
};
const member = {
  ...owner,
  id: 'member',
  userId: 'maria',
  name: 'Maria',
  email: 'maria@example.com',
  role: 'MEMBER',
};
function settings() {
  return render(
    <MemoryRouter>
      <WorkspaceSettings />
    </MemoryRouter>,
  );
}
function invite() {
  return render(
    <MemoryRouter initialEntries={['/invite/' + token]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/app/settings" element={<p>Workspace selecionado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  state.me.workspaces = [
    { id: 'family', name: 'Família Calixto', type: 'FAMILY', role: 'OWNER' },
  ];
  state.session = {};
  state.loading = false;
  state.request.mockImplementation(async (path: string) =>
    path.endsWith('/members') ? [owner, member] : [],
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaceId: 'family',
        workspaceName: 'Família Calixto',
        inviterName: 'Arthur',
        status: 'PENDING',
        expiresAt: '2026-10-12',
      }),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('PERSONAL privado sem convite e cria FAMILY selecionado automaticamente', async () => {
  state.me.workspaces[0].type = 'PERSONAL';
  state.request.mockImplementation(async (path: string) =>
    path === '/workspaces' ? { id: 'new-family' } : [owner],
  );
  settings();
  const user = userEvent.setup();
  expect(screen.queryByRole('button', { name: 'Convidar membro' })).toBeNull();
  expect(screen.getByText(/pessoal é privado/)).toBeTruthy();
  await user.click(
    screen.getByRole('button', { name: 'Criar workspace familiar' }),
  );
  await user.type(screen.getByLabelText('Nome do workspace'), 'Família');
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() =>
    expect(state.refreshWorkspaces).toHaveBeenCalledWith('new-family'),
  );
});
it('MEMBER lista membros sem ações administrativas nem fetch de convites', async () => {
  state.me.workspaces[0].role = 'MEMBER';
  settings();
  await screen.findByText('Maria');
  expect(screen.queryByRole('button', { name: 'Convidar membro' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Editar nome' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remover Maria' })).toBeNull();
  expect(state.request).not.toHaveBeenCalledWith(
    expect.stringContaining('invitations'),
    expect.anything(),
    expect.anything(),
  );
});
it('OWNER remove MEMBER somente após confirmação', async () => {
  settings();
  const user = userEvent.setup();
  await screen.findByText('Maria');
  await user.click(screen.getByRole('button', { name: 'Remover Maria' }));
  expect(screen.getByText(/autoria dos lançamentos permanecerão/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/workspaces/family/members/member',
      'family',
      undefined,
      { method: 'DELETE' },
    ),
  );
});
it('OWNER gera, copia e cancela convite', async () => {
  let created = false;
  const invitation = {
    id: 'invite',
    email: 'maria@example.com',
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: '2026-10-12',
  };
  state.request.mockImplementation(
    async (
      path: string,
      _ws: unknown,
      _signal: unknown,
      options?: { method: string },
    ) => {
      if (path.endsWith('/members')) return [owner];
      if (options?.method === 'POST') {
        created = true;
        return { invitation, token, reused: false };
      }
      return created ? [invitation] : [];
    },
  );
  settings();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Convidar membro' }));
  await user.type(screen.getByLabelText('E-mail'), 'maria@example.com');
  await user.click(screen.getByRole('button', { name: 'Gerar convite' }));
  const copy = await screen.findByRole('button', { name: 'Copiar convite' });
  await user.click(copy);
  expect(await navigator.clipboard.readText()).toContain('/invite/' + token);
  await user.click(screen.getByRole('button', { name: 'Cancelar convite' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/workspaces/family/invitations/invite',
      'family',
      undefined,
      { method: 'DELETE' },
    ),
  );
});
it('convite público preserva retorno no login/cadastro e não aceita ao abrir', async () => {
  state.session = null;
  invite();
  await screen.findByText('Família Calixto');
  expect(
    screen.getByRole('link', { name: 'Entrar' }).getAttribute('href'),
  ).toBe('/login?next=' + encodeURIComponent('/invite/' + token));
  expect(
    screen.getByRole('link', { name: 'Criar conta' }).getAttribute('href'),
  ).toContain('/register?next=');
  expect(state.request).not.toHaveBeenCalled();
});
it('aceite explícito atualiza seletor e entra no workspace', async () => {
  state.request.mockResolvedValue({ workspaceId: 'family' });
  invite();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Aceitar convite' }),
  );
  await screen.findByText('Workspace selecionado');
  expect(state.refreshWorkspaces).toHaveBeenCalledWith('family');
});
it('recusa explícita não adiciona workspace', async () => {
  state.request.mockResolvedValue({ status: 'DECLINED' });
  invite();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Recusar' }));
  await screen.findByText('Convite recusado.');
  expect(state.refreshWorkspaces).not.toHaveBeenCalled();
});
it('mostra mensagem de e-mail diferente e mantém convite', async () => {
  state.request.mockRejectedValue(
    new Error('Este convite foi enviado para outro endereço de e-mail.'),
  );
  invite();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Aceitar convite' }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'outro endereço',
  );
  expect(state.refreshWorkspaces).not.toHaveBeenCalled();
});
it('retorno rejeita URLs externas e caminhos arbitrários', () => {
  for (const value of [
    'https://evil.invalid',
    '//evil.invalid',
    '/app',
    '/invite/x',
  ])
    expect(inviteReturnPath('?next=' + encodeURIComponent(value))).toBeNull();
  expect(
    inviteReturnPath('?next=' + encodeURIComponent('/invite/' + token)),
  ).toBe('/invite/' + token);
});

it.each(['EXPIRED', 'CANCELLED', 'ACCEPTED', 'DECLINED'])(
  'convite %s não oferece aceite',
  async (status) => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaceId: 'family',
        workspaceName: 'Família Calixto',
        inviterName: 'Arthur',
        status,
        expiresAt: '2026-10-01',
      }),
    } as Response);
    invite();
    await screen.findByText(/não está mais disponível/);
    expect(
      screen.queryByRole('button', { name: 'Aceitar convite' }),
    ).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  },
);
