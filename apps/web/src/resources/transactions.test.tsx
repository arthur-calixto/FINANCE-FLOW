import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { monthViewFixture } from '../../test/month-view';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TransactionRecord } from '@finance-flow/types';
const mocks = vi.hoisted(() => ({
  workspaceId: 'a',
  role: 'OWNER',
  request: vi.fn(),
}));
vi.mock('../auth', () => ({
  useAuth: () => ({
    activeWorkspaceId: mocks.workspaceId,
    me: { workspaces: [{ id: mocks.workspaceId, role: mocks.role }] },
  }),
}));
vi.mock('../api', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
}));
import { Transactions } from './Transactions';
import {
  brazilToday,
  formatDate,
  paymentTimestamp,
  shiftMonth,
} from '../dates';
import { moneyDifference } from '../money';
const account = '00000000-0000-4000-8000-000000000001',
  expense = '00000000-0000-4000-8000-000000000002',
  income = '00000000-0000-4000-8000-000000000003';
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter });
}
let rows: TransactionRecord[];
const month = () => brazilToday().slice(0, 7);
const fixture = (
  changes: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  id: crypto.randomUUID(),
  workspaceId: 'a',
  description: 'Energia',
  type: 'EXPENSE',
  status: 'PENDING',
  expectedAmount: '200.00',
  amount: null,
  transactionDate: month() + '-01',
  dueDate: month() + '-10',
  competenceDate: month() + '-01',
  paidAt: null,
  accountId: account,
  categoryId: expense,
  ownerMemberId: null,
  notes: null,
  createdBy: 'user',
  createdAt: '',
  updatedAt: '',
  account: { id: account, name: 'Nubank' },
  category: { id: expense, name: 'Energia' },
  ...changes,
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  rows = [];
  mocks.workspaceId = 'a';
  mocks.role = 'OWNER';
  mocks.request.mockImplementation(
    async (
      path: string,
      ws: string,
      _signal: unknown,
      options?: { method: string; body?: Record<string, unknown> },
    ) => {
      const url = new URL(path, 'http://test');
      if (path.startsWith('/accounts'))
        return [{ id: account, name: 'Nubank', isActive: true }];
      if (path.startsWith('/categories'))
        return [
          { id: expense, name: 'Energia', type: 'EXPENSE', isActive: true },
          { id: income, name: 'Salário', type: 'INCOME', isActive: true },
        ];
      if (path.endsWith('/deletion-options'))
        return {
          installmentCount: 10,
          blockedReason: null,
          options: [
            {
              scope: 'THIS',
              count: 1,
              firstInstallment: 5,
              lastInstallment: 5,
            },
            {
              scope: 'THIS_AND_FUTURE',
              count: 6,
              firstInstallment: 5,
              lastInstallment: 10,
            },
            {
              scope: 'ALL',
              count: 10,
              firstInstallment: 1,
              lastInstallment: 10,
            },
          ],
        };
      if (!options)
        return monthViewFixture(
          rows.filter(
            (r) =>
              r.workspaceId === ws &&
              r.competenceDate.slice(0, 7) === url.searchParams.get('month') &&
              (!url.searchParams.get('search') ||
                r.description
                  .toLowerCase()
                  .includes(url.searchParams.get('search')!.toLowerCase())) &&
              (!url.searchParams.get('status') ||
                r.status === url.searchParams.get('status')) &&
              (!url.searchParams.get('accountId') ||
                r.accountId === url.searchParams.get('accountId')) &&
              (!url.searchParams.get('categoryId') ||
                r.categoryId === url.searchParams.get('categoryId')),
          ),
        );
      if (path === '/transactions') {
        const r = fixture({
          ...options.body,
          workspaceId: ws,
        } as Partial<TransactionRecord>);
        rows.push(r);
        return r;
      }
      const r = rows.find((r) => r.id === path.split('/')[2])!;
      if (path.endsWith('/pay'))
        Object.assign(r, options.body, { status: 'PAID' });
      else if (path.endsWith('/reopen'))
        Object.assign(r, { status: 'PENDING', paidAt: null });
      else if (path.endsWith('/permanent'))
        rows = rows.filter((row) => row.id !== r.id);
      else if (path.endsWith('/cancel')) r.status = 'CANCELLED';
      else Object.assign(r, options.body);
      return { ...r };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function create(type: 'receita' | 'despesa') {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: '＋ Nova ' + type }),
  );
  const dialog = screen.getByRole('dialog');
  await user.type(
    within(dialog).getByLabelText('Descrição'),
    type === 'receita' ? 'Salário novo' : 'Energia nova',
  );
  await user.type(
    within(dialog).getByLabelText('Valor previsto (R$)'),
    '200,00',
  );
  await user.selectOptions(within(dialog).getByLabelText('Conta'), account);
  const category = within(dialog).getByLabelText('Categoria');
  expect(
    within(category).queryByText(type === 'receita' ? 'Energia' : 'Salário'),
  ).toBeNull();
  await user.selectOptions(category, type === 'receita' ? income : expense);
  await user.click(
    within(dialog).getByRole('button', { name: 'Salvar lançamento' }),
  );
  await screen.findByRole('heading', {
    name: type === 'receita' ? 'Salário novo' : 'Energia nova',
  });
}
describe('Lançamentos', () => {
  it('estado vazio e criação de despesa com categoria compatível', async () => {
    render(<Transactions />);
    await screen.findByText('Nenhum lançamento neste mês.');
    await create('despesa');
    expect(rows[0].expectedAmount).toBe('200.00');
    expect(rows[0].type).toBe('EXPENSE');
  });
  it('criação de receita', async () => {
    render(<Transactions />);
    await screen.findByText('Nenhum lançamento neste mês.');
    await create('receita');
    expect(rows[0].type).toBe('INCOME');
  });
  it('navegação mensal e busca', async () => {
    rows = [
      fixture(),
      fixture({ description: 'Salário', type: 'INCOME' }),
      fixture({
        description: 'Próximo',
        competenceDate: shiftMonth(month(), 1) + '-01',
      }),
    ];
    const user = userEvent.setup();
    render(<Transactions />);
    await screen.findByRole('heading', { name: 'Energia' });
    await user.type(screen.getByLabelText('Buscar lançamento'), 'Salário');
    await screen.findByRole('heading', { name: 'Salário' });
    expect(screen.queryByRole('heading', { name: 'Energia' })).toBeNull();
    await user.clear(screen.getByLabelText('Buscar lançamento'));
    await screen.findByRole('heading', { name: 'Energia' });
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    await screen.findByRole('heading', { name: 'Próximo' });
    expect(screen.queryByRole('heading', { name: 'Energia' })).toBeNull();
  });
  it('baixa permite valor diferente, apresenta previsto, pago e diferença; reabre preservando valor', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByRole('button', { name: 'Pagar' }));
    const input = screen.getByLabelText('Valor pago (R$)');
    expect((input as HTMLInputElement).value).toBe('200,00');
    await user.clear(input);
    await user.type(input, '217,30');
    await user.click(screen.getByRole('button', { name: 'Confirmar baixa' }));
    await user.click(
      await screen.findByLabelText('Ações de ' + rows[0].description),
    );
    await screen.findByRole('button', { name: 'Reabrir' });
    expect(screen.getByText('Diferença')).toBeTruthy();
    expect(screen.getByText(/^R\$\s17,30$/)).toBeTruthy();
    expect(screen.getAllByText(/217,30/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Reabrir',
      }),
    );
    await screen.findByRole('button', { name: 'Pagar' });
    expect(rows[0].amount).toBe('217.30');
  });
  it('receita usa Receber e Recebido', async () => {
    rows = [fixture({ type: 'INCOME', description: 'Salário' })];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByRole('button', { name: 'Receber' }));
    expect(screen.getByLabelText('Valor recebido (R$)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar baixa' }));
    await user.click(
      await screen.findByLabelText('Ações de ' + rows[0].description),
    );
    await screen.findByRole('button', { name: 'Reabrir' });
    expect(screen.getAllByText('Recebido').length).toBeGreaterThan(0);
  });
  it('cancelamento exige confirmação e preserva registro', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByLabelText('Ações de Energia'));
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar lançamento' }),
    );
    expect(rows[0].status).toBe('PENDING');
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cancelamento' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByRole('heading', { name: 'Energia' });
    expect(rows[0].status).toBe('CANCELLED');
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
  });
  it('troca workspace descarta lista, resumo e formulário e ignora resposta tardia', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    const view = render(<Transactions />);
    await user.click(await screen.findByRole('button', { name: 'Pagar' }));
    mocks.workspaceId = 'b';
    view.rerender(<Transactions />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Energia' })).toBeNull();
    await screen.findByText('Nenhum lançamento neste mês.');
    expect(
      mocks.request.mock.calls.some(
        (c) => c[0].startsWith('/transactions/month-view') && c[1] === 'b',
      ),
    ).toBe(true);
  });
  it('VIEWER não recebe ações de escrita', async () => {
    mocks.role = 'VIEWER';
    rows = [fixture()];
    render(<Transactions />);
    await screen.findByRole('heading', { name: 'Energia' });
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: '＋ Nova receita' }),
    ).toBeNull();
  });
  it('datas civis, virada brasileira e centavos precisos', () => {
    expect(formatDate('2026-10-10')).toBe('10/10/2026');
    expect(brazilToday(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-09');
    expect(brazilToday(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-10');
    expect(paymentTimestamp('2026-10-10')).toBe('2026-10-10T12:00:00-03:00');
    expect(moneyDifference('9007199254740993.01', '9007199254740993.00')).toBe(
      '0.01',
    );
    expect(moneyDifference('1.00', '2.01')).toBe('-1.01');
  });
  it('erro de carregamento e recuperação', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Falha temporária'));
    render(<Transactions />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Nenhum lançamento neste mês.');
  });
});

describe('FIN-9 — hierarquia e exclusão', () => {
  it('dataset oficial ocupa exatamente os grupos esperados e soma 6000/1870/4130', async () => {
    rows = [
      fixture({
        description: 'Salário',
        type: 'INCOME',
        recurrenceId: 'salary',
        expectedAmount: '5000.00',
      }),
      fixture({
        description: 'Freelance',
        type: 'INCOME',
        expectedAmount: '1000.00',
      }),
      fixture({
        description: 'Internet',
        recurrenceId: 'internet',
        expectedAmount: '120.00',
      }),
      fixture({
        description: 'Condomínio',
        recurrenceId: 'condo',
        expectedAmount: '650.00',
      }),
      fixture({
        description: 'Mercado',
        creditCardId: 'nubank',
        creditCard: { id: 'nubank', name: 'Nubank Mastercard' },
        expectedAmount: '350.00',
        amount: '350.00',
      }),
      fixture({
        description: 'Notebook',
        creditCardId: 'nubank',
        creditCard: { id: 'nubank', name: 'Nubank Mastercard' },
        installmentGroupId: 'notebook',
        installmentNumber: 5,
        installmentGroup: { id: 'notebook', installmentCount: 10 },
        expectedAmount: '300.00',
        amount: '300.00',
      }),
      fixture({
        description: 'Combustível',
        creditCardId: 'inter',
        creditCard: { id: 'inter', name: 'Inter' },
        expectedAmount: '250.00',
        amount: '250.00',
      }),
      fixture({ description: 'Energia', expectedAmount: '200.00' }),
      fixture({
        description: 'Cancelado',
        status: 'CANCELLED',
        expectedAmount: '100.00',
      }),
    ];
    const user = userEvent.setup();
    render(<Transactions />);
    await screen.findByRole('heading', { name: 'Notebook' });
    expect(screen.getAllByRole('table')).toHaveLength(6);
    expect(
      screen.getByText('Receitas previstas').parentElement!.textContent,
    ).toMatch(/6.000,00/);
    expect(
      screen.getByText('Despesas previstas').parentElement!.textContent,
    ).toMatch(/1.870,00/);
    expect(
      screen.getByText('Resultado previsto').parentElement!.textContent,
    ).toMatch(/4.130,00/);
    const group = (name: string) =>
      screen.getByText(name, { exact: true }).closest('details')!;
    expect(
      within(group('Outras receitas')).getByRole('heading', {
        name: 'Freelance',
      }),
    ).toBeTruthy();
    expect(
      within(group('Outras despesas')).getByRole('heading', {
        name: 'Energia',
      }),
    ).toBeTruthy();
    expect(
      within(group('Nubank Mastercard')).getByRole('heading', {
        name: 'Mercado',
      }),
    ).toBeTruthy();
    expect(
      within(group('Nubank Mastercard')).getByText('5/10', { exact: true }),
    ).toBeTruthy();
    expect(
      group('Nubank Mastercard').querySelector('summary')!.textContent,
    ).toMatch(/650,00/);
    expect(
      group('Cartões de crédito').querySelector('summary')!.textContent,
    ).toMatch(/900,00/);
    const fixed = screen.getAllByText('Fixas / recorrentes');
    expect(
      within(fixed[0].closest('details')!).getByRole('heading', {
        name: 'Salário',
      }),
    ).toBeTruthy();
    expect(
      within(fixed[1].closest('details')!).getByRole('heading', {
        name: 'Internet',
      }),
    ).toBeTruthy();
    expect(
      within(fixed[1].closest('details')!).getByRole('heading', {
        name: 'Condomínio',
      }),
    ).toBeTruthy();
    await user.click(group('DESPESAS').querySelector('summary')!);
    expect(group('DESPESAS').open).toBe(false);
    await user.click(group('DESPESAS').querySelector('summary')!);
    expect(group('DESPESAS').open).toBe(true);
  });
  it('menu e confirmação forte impedem exclusão acidental; hard delete remove linha e totais', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    render(<Transactions />);
    await screen.findByRole('heading', { name: 'Energia' });
    expect(
      screen.getByLabelText('Ações de Energia').closest('details')!.open,
    ).toBe(false);
    await user.click(screen.getByLabelText('Ações de Energia'));
    await user.click(
      screen.getByRole('button', { name: 'Excluir definitivamente' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/não aparecerá mais no histórico/),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: 'Excluir definitivamente' }),
    );
    expect(rows).toHaveLength(1);
    await user.click(
      within(dialog).getByLabelText('Entendo que a exclusão é definitiva.'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Excluir definitivamente' }),
    );
    await screen.findByText('Nenhum lançamento neste mês.');
    expect(rows).toHaveLength(0);
    expect(
      screen.getByText('Despesas previstas').parentElement!.textContent,
    ).toMatch(/0,00/);
    const call = mocks.request.mock.calls.find((c) =>
      String(c[0]).endsWith('/permanent'),
    )!;
    expect(call[3]).toEqual({ method: 'DELETE', body: { confirm: true } });
  });
  it('fatura paga e parcela de cartão exibem bloqueio sem ação destrutiva', async () => {
    rows = [
      fixture({
        description: 'Fatura paga',
        creditCardId: 'card',
        creditCard: { id: 'card', name: 'Cartão' },
        status: 'PAID',
        permanentDeleteBlockedReason:
          'Esta compra pertence a uma fatura já paga e não pode ser excluída diretamente.',
      }),
    ];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByLabelText('Ações de Fatura paga'));
    expect(screen.getByText(/fatura já paga/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Excluir definitivamente' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull();
  });
  it('ocorrência recorrente excluída desaparece e informa preservação dos próximos meses', async () => {
    rows = [fixture({ recurrenceId: 'series', description: 'Internet' })];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByLabelText('Ações de Internet'));
    await user.click(
      screen.getByRole('button', { name: 'Excluir definitivamente' }),
    );
    expect(screen.getByText(/não será gerada novamente/)).toBeTruthy();
    await user.click(
      screen.getByLabelText('Entendo que a exclusão é definitiva.'),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Excluir definitivamente',
      }),
    );
    await screen.findByText('Nenhum lançamento neste mês.');
    expect(screen.queryByRole('heading', { name: 'Internet' })).toBeNull();
  });
  it('status, conta e categoria filtram dentro do mês e atualizam subtotais', async () => {
    rows = [
      fixture(),
      fixture({
        description: 'Pago',
        status: 'PAID',
        accountId: 'another',
        categoryId: income,
        expectedAmount: '150.00',
        amount: '160.00',
      }),
    ];
    const user = userEvent.setup();
    render(<Transactions />);
    await screen.findByRole('heading', { name: 'Energia' });
    await user.selectOptions(screen.getByLabelText('Filtrar status'), 'PAID');
    await screen.findByRole('heading', { name: 'Pago' });
    expect(screen.queryByRole('heading', { name: 'Energia' })).toBeNull();
    expect(
      screen.getByText('Despesas previstas').parentElement!.textContent,
    ).toMatch(/150,00/);
    await user.selectOptions(screen.getByLabelText('Filtrar status'), '');
    await screen.findByRole('heading', { name: 'Energia' });
    await user.selectOptions(screen.getByLabelText('Filtrar conta'), account);
    await screen.findByRole('heading', { name: 'Energia' });
    expect(screen.queryByRole('heading', { name: 'Pago' })).toBeNull();
    await user.selectOptions(
      screen.getByLabelText('Filtrar categoria'),
      income,
    );
    await screen.findByText('Nenhum lançamento neste mês.');
  });
  it('erro de exclusão preserva diálogo e lançamento', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    render(<Transactions />);
    await user.click(await screen.findByLabelText('Ações de Energia'));
    await user.click(
      screen.getByRole('button', { name: 'Excluir definitivamente' }),
    );
    await user.click(
      screen.getByLabelText('Entendo que a exclusão é definitiva.'),
    );
    mocks.request.mockRejectedValueOnce(new Error('Não foi possível excluir.'));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Excluir definitivamente',
      }),
    );
    await screen.findByRole('alert');
    expect(rows).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

it('parcela de cartão na visão agrupada oferece exclusão futura e atualiza a lista', async () => {
  rows = [
    fixture({
      description: 'Notebook 5/10',
      creditCardId: 'card',
      creditCard: { id: 'card', name: 'Nubank' },
      installmentGroupId: 'group',
      installmentNumber: 5,
      installmentGroup: { id: 'group', installmentCount: 10 },
      permanentDeleteBlockedReason: null,
    }),
  ];
  const user = userEvent.setup();
  render(<Transactions />);
  await user.click(await screen.findByLabelText('Ações de Notebook 5/10'));
  await user.click(
    screen.getByRole('button', { name: 'Excluir definitivamente' }),
  );
  await user.selectOptions(
    await screen.findByLabelText('Como deseja excluir?'),
    'THIS_AND_FUTURE',
  );
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Excluir definitivamente',
    }),
  );
  await screen.findByText('Nenhum lançamento neste mês.');
  expect(
    mocks.request.mock.calls.find((c) =>
      String(c[0]).endsWith('/permanent'),
    )![3],
  ).toEqual({
    method: 'DELETE',
    body: { confirm: true, scope: 'THIS_AND_FUTURE', expectedCount: 6 },
  });
});
