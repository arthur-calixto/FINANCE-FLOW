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
  render,
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
      if (path.startsWith('/transactions/summary'))
        return {
          income: { expected: '5000.00', realized: '0.00' },
          expense: { expected: '200.00', realized: '0.00' },
        };
      if (!options)
        return rows
          .filter(
            (r) =>
              r.workspaceId === ws &&
              r.competenceDate.slice(0, 7) === url.searchParams.get('month') &&
              (!url.searchParams.get('type') ||
                r.type === url.searchParams.get('type')) &&
              (!url.searchParams.get('status') ||
                r.status === url.searchParams.get('status')),
          )
          .map((r) => ({ ...r }));
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
      else if (options.method === 'DELETE') r.status = 'CANCELLED';
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
  it('navegação mensal e filtro de tipo', async () => {
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
    await user.selectOptions(screen.getByLabelText('Filtrar tipo'), 'INCOME');
    await screen.findByRole('heading', { name: 'Salário' });
    expect(screen.queryByRole('heading', { name: 'Energia' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Filtrar tipo'), '');
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
    await screen.findByRole('button', { name: 'Reabrir' });
    expect(screen.getByText('Diferença')).toBeTruthy();
    expect(screen.getByText(/^R\$\s17,30$/)).toBeTruthy();
    expect(screen.getByText(/217,30/)).toBeTruthy();
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
    await screen.findByRole('button', { name: 'Reabrir' });
    expect(screen.getAllByText('Recebido').length).toBeGreaterThan(0);
  });
  it('cancelamento exige confirmação e preserva registro', async () => {
    rows = [fixture()];
    const user = userEvent.setup();
    render(<Transactions />);
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
        (c) => c[0].startsWith('/transactions/summary') && c[1] === 'b',
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
