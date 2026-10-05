import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DashboardResponse } from '@finance-flow/types';
import { dashboardFixture, emptyDashboard } from '../test/dashboard';
import { brazilToday, monthLabel, shiftMonth } from './dates';
import { formatMoney } from './money';
const moneyText = (value: string) => formatMoney(value).replace(/\s/g, ' ');
const mocks = vi.hoisted(() => ({
  workspaceId: 'family',
  role: 'OWNER',
  request: vi.fn(),
}));
vi.mock('./auth', () => ({
  useAuth: () => ({
    activeWorkspaceId: mocks.workspaceId,
    me: {
      user: { name: 'Arthur' },
      workspaces: [{ id: mocks.workspaceId, role: mocks.role }],
    },
  }),
}));
vi.mock('./api', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
}));
import { Dashboard } from './Dashboard';
import { Transactions } from './resources/Transactions';
const month = brazilToday().slice(0, 7);
function app() {
  return (
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}
const section = (title: string) =>
  within(screen.getByRole('heading', { name: title }).closest('section')!);
beforeEach(() => {
  mocks.workspaceId = 'family';
  mocks.role = 'OWNER';
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) =>
    dashboardFixture(
      new URLSearchParams(path.split('?')[1]).get('month') ?? month,
    ),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
it('loading faz um request de dashboard sem consolidar finanças no cliente', () => {
  mocks.request.mockReturnValue(new Promise(() => {}));
  render(app());
  expect(screen.getByRole('status').textContent).toContain('Carregando');
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledWith(
    '/dashboard?month=' + month,
    'family',
    expect.any(AbortSignal),
  );
});
it('erro oferece nova tentativa', async () => {
  mocks.request.mockRejectedValueOnce(new Error('Falha de conexão'));
  render(app());
  await screen.findByText('Falha de conexão');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByRole('heading', { name: 'Resultado' });
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
it('cards, categorias, composição, próximos vencimentos, contas e cartões exibem BRL', async () => {
  render(app());
  await screen.findByRole('heading', { name: 'Resultado' });
  expect(section('Resultado').getByText(moneyText('3350.00'))).toBeTruthy();
  expect(section('Receitas').getByText(moneyText('6000.00'))).toBeTruthy();
  expect(section('Despesas').getByText(moneyText('2650.00'))).toBeTruthy();
  expect(section('Pendências').getByText(moneyText('150.00'))).toBeTruthy();
  expect(section('Contas').getByText(moneyText('3500.00'))).toBeTruthy();
  expect(section('Cartões').getByText(moneyText('4400.00'))).toBeTruthy();
  expect(
    section('Próximos vencimentos').getByText('Supermercado'),
  ).toBeTruthy();
  expect(section('Despesas por categoria').getByText('Moradia')).toBeTruthy();
  expect(
    section('Composição das despesas').getByText('Fixas / recorrentes'),
  ).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Ver cartão →' }).getAttribute('href'),
  ).toBe('/app/credit-cards/card/invoices/invoice');
  expect(
    screen
      .getByRole('link', { name: 'Ver lançamentos →' })
      .getAttribute('href'),
  ).toBe('/app/transactions?month=' + month);
});
it('meses anterior/próximo/atual controlam o endpoint', async () => {
  render(app());
  await screen.findByRole('heading', { name: 'Resultado' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenLastCalledWith(
      '/dashboard?month=' + shiftMonth(month, -1),
      'family',
      expect.any(AbortSignal),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Mês atual' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenLastCalledWith(
      '/dashboard?month=' + month,
      'family',
      expect.any(AbortSignal),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenLastCalledWith(
      '/dashboard?month=' + shiftMonth(month, 1),
      'family',
      expect.any(AbortSignal),
    ),
  );
});
it('retornar mês selecionado não deve deixar loading permanente', async () => {
  render(app());
  await screen.findByRole('heading', { name: 'Resultado' });
  fireEvent.change(screen.getByLabelText('Competência'), {
    target: { value: shiftMonth(month, -1) },
  });
  await screen.findByRole('heading', { name: 'Resultado' });
  expect(
    screen.getAllByText(monthLabel(shiftMonth(month, -1)), { exact: true })
      .length,
  ).toBeTruthy();
});
it('workspace vazio e mês sem movimento têm estados próprios e gráfico zero íntegro', async () => {
  mocks.request.mockResolvedValue(emptyDashboard());
  const view = render(app());
  await screen.findByText('Seu dashboard começa aqui');
  expect(screen.getByText(/Nenhuma conta ativa/)).toBeTruthy();
  expect(screen.getByText(/Nenhum cartão ativo/)).toBeTruthy();
  expect(
    screen.getByText('Nenhum vencimento pendente nesta competência.'),
  ).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(document.body.textContent).not.toContain('NaN');
  view.unmount();
  mocks.request.mockResolvedValue({ ...emptyDashboard(), hasActivity: true });
  render(app());
  await screen.findByText(/Nenhuma movimentação nesta competência/);
  expect(screen.queryByText('Seu dashboard começa aqui')).toBeNull();
});
it('evolução alterna três séries e disponibiliza todos os valores sem depender de tooltip', async () => {
  render(app());
  await screen.findByRole('heading', { name: 'Evolução financeira' });
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
    'previstos',
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Realizado' }));
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
    'realizados',
  );
  expect(
    section('Evolução financeira').getAllByText(moneyText('3200.00')),
  ).toHaveLength(6);
});
it('valor negativo permanece legível e gráfico aceita resultado negativo', async () => {
  const fixture = dashboardFixture();
  fixture.summary.result.planned = '-100.00';
  fixture.evolution.forEach((r) => (r.result.planned = '-100.00'));
  mocks.request.mockResolvedValue(fixture);
  render(app());
  await screen.findByRole('heading', { name: 'Resultado' });
  expect(
    section('Resultado').getByText(moneyText('-100.00')).className,
  ).toContain('dashboard-negative');
  expect(screen.getByRole('img')).toBeTruthy();
});
it('troca de workspace descarta resposta antiga e dados visíveis', async () => {
  let resolve!: (data: DashboardResponse) => void;
  mocks.request.mockReturnValueOnce(
    new Promise<DashboardResponse>((r) => (resolve = r)),
  );
  const view = render(app());
  mocks.workspaceId = 'personal';
  mocks.request.mockResolvedValue(emptyDashboard());
  view.rerender(app());
  await screen.findByText('Seu dashboard começa aqui');
  resolve(dashboardFixture());
  await waitFor(() => expect(screen.queryByText('Supermercado')).toBeNull());
});
it('VIEWER não recebe ações de escrita', async () => {
  mocks.role = 'VIEWER';
  render(app());
  await screen.findByRole('heading', { name: 'Resultado' });
  expect(screen.queryByRole('button', { name: /Nova receita/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Nova despesa/ })).toBeNull();
});
it.each(['INCOME', 'EXPENSE'] as const)(
  'ação %s reutiliza formulário e atualiza dashboard após salvar',
  async (type) => {
    const accountId = '00000000-0000-4000-8000-000000000001',
      categoryId = '00000000-0000-4000-8000-000000000002';
    mocks.request.mockImplementation(async (path: string) =>
      path === '/accounts'
        ? [{ id: accountId, name: 'Conta', isActive: true }]
        : path === '/categories'
          ? [{ id: categoryId, name: 'Categoria', type, isActive: true }]
          : path === '/transactions'
            ? {}
            : dashboardFixture(),
    );
    render(app());
    await screen.findByRole('heading', { name: 'Resultado' });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {
        name: type === 'INCOME' ? /Nova receita/ : /Nova despesa/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe(
      type === 'INCOME' ? 'Nova receita' : 'Nova despesa',
    );
    await user.type(
      within(dialog).getByLabelText('Descrição'),
      'Novo lançamento',
    );
    await user.type(
      within(dialog).getByLabelText('Valor previsto (R$)'),
      '100,00',
    );
    fireEvent.change(dialog.querySelector('[name=accountId]')!, {
      target: { value: accountId },
    });
    fireEvent.change(dialog.querySelector('[name=categoryId]')!, {
      target: { value: categoryId },
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Salvar lançamento' }),
    );
    await screen.findByText('Lançamento criado. Dashboard atualizado.');
    expect(mocks.request).toHaveBeenCalledWith(
      '/transactions',
      'family',
      undefined,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ type, expectedAmount: '100.00' }),
      }),
    );
    expect(
      mocks.request.mock.calls.filter((c) => c[0].startsWith('/dashboard')),
    ).toHaveLength(2);
  },
);
it('navegação para lançamentos preserva competência', async () => {
  mocks.request.mockImplementation(async (path: string) =>
    path.startsWith('/transactions/month-view')
      ? {
          rows: [],
          summary: {
            income: { expected: '0', realized: '0' },
            expense: { expected: '0', realized: '0' },
          },
          subtotals: {},
        }
      : [],
  );
  render(
    <MemoryRouter initialEntries={['/app/transactions?month=2026-03']}>
      <Routes>
        <Route path="/app/transactions" element={<Transactions />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('month=2026-03'),
      'family',
      expect.any(AbortSignal),
    ),
  );
});
