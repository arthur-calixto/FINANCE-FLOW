import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { registerSchema, passwordSchema } from '@finance-flow/validation';
const state = vi.hoisted(() => ({
  session: null as object | null,
  loading: false,
  recovery: false,
  me: null,
  error: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  switchWorkspace: vi.fn(),
  retry: vi.fn(),
  completeRecovery: vi.fn(),
  activeWorkspaceId: null,
}));
vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  useAuth: () => state,
}));
vi.mock('./supabase', () => ({
  configurationError: null,
  supabase: {
    auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) },
  },
}));
import { AppRoutes } from './App';
import { chooseWorkspace } from './auth';
import { supabase } from './supabase';
afterEach(() => {
  cleanup();
  state.session = null;
  state.loading = false;
});
describe('autenticação Web', () => {
  it('redireciona /app sem sessão para login', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });
  it('não redireciona enquanto carrega sessão', () => {
    state.loading = true;
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status').textContent).toBe('Carregando…');
  });
  it('submete login pelo contexto', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('E-mail'), 'test@example.com');
    await user.type(screen.getByLabelText('Senha'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(state.signIn).toHaveBeenCalledWith(
      'test@example.com',
      'password123',
    );
  });
  it('cadastro pede confirmação de email', async () => {
    state.signUp.mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/register']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Nome'), 'Arthur');
    await user.type(screen.getByLabelText('E-mail'), 'test@example.com');
    await user.type(
      screen.getByLabelText('Senha', { exact: true }),
      'password123',
    );
    await user.type(screen.getByLabelText('Confirmar senha'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.getByRole('status').textContent).toContain(
      'confirme o endereço',
    );
    expect(state.signUp).toHaveBeenCalledWith(
      'Arthur',
      'test@example.com',
      'password123',
    );
  });
  it('recuperação utiliza rota de retorno e mensagem neutra', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('E-mail'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Recuperar senha' }));
    expect(supabase!.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'test@example.com',
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Se houver uma conta',
    );
  });
  it('reset exige sessão válida', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: 'Redefinir senha' }),
    ).toBeNull();
  });
  it('valida confirmação e força mínima da senha', () => {
    expect(
      registerSchema.safeParse({
        name: 'A',
        email: 'a@example.com',
        password: '12345678',
        confirmation: '87654321',
      }).success,
    ).toBe(false);
    expect(
      passwordSchema.safeParse({ password: '123', confirmation: '123' })
        .success,
    ).toBe(false);
  });
  it('workspace persistido precisa pertencer à lista autorizada', () => {
    expect(chooseWorkspace(['a', 'b'], 'b')).toBe('b');
    expect(chooseWorkspace(['a'], 'outro')).toBe('a');
    expect(chooseWorkspace([], 'outro')).toBeNull();
  });
});
