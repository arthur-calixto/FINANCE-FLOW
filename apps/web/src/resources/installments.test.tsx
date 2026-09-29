import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  InstallmentPlan,
  InstallmentGroupRecord,
  TransactionRecord,
} from '@finance-flow/types';
const mocks = vi.hoisted(() => ({ ws: 'a', request: vi.fn() }));
vi.mock('../auth', () => ({
  useAuth: () => ({
    activeWorkspaceId: mocks.ws,
    me: { workspaces: [{ id: mocks.ws, role: 'OWNER' }] },
  }),
}));
vi.mock('../api', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
}));
import { Transactions } from './Transactions';
import { CreditCards } from './CreditCards';
import { InstallmentGroup } from './InstallmentGroup';
import { brazilToday } from '../dates';
const account = '00000000-0000-4000-8000-000000000001',
  category = '00000000-0000-4000-8000-000000000002',
  cardId = '00000000-0000-4000-8000-000000000003';
let rows: TransactionRecord[], group: InstallmentGroupRecord;
const plan: InstallmentPlan = {
  totalAmount: '1000.00',
  installmentCount: 3,
  installments: [
    {
      installmentNumber: 1,
      amount: '333.33',
      dueDate: '2026-10-10',
      competenceDate: '2026-10-01',
    },
    {
      installmentNumber: 2,
      amount: '333.33',
      dueDate: '2026-11-10',
      competenceDate: '2026-11-01',
    },
    {
      installmentNumber: 3,
      amount: '333.34',
      dueDate: '2026-12-10',
      competenceDate: '2026-12-01',
    },
  ],
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  mocks.ws = 'a';
  rows = [];
  group = {
    id: 'group',
    workspaceId: 'a',
    description: 'Curso',
    totalAmount: '1000.00',
    installmentCount: 3,
    purchaseDate: '2026-09-29',
    type: 'EXPENSE',
    origin: 'ACCOUNT',
    accountId: account,
    creditCardId: null,
    account: { id: account, name: 'Conta' },
    creditCard: null,
    installments: plan.installments.map((p) => ({
      id: 'p' + p.installmentNumber,
      workspaceId: 'a',
      description: `Curso ${p.installmentNumber}/3`,
      type: 'EXPENSE',
      status: 'PENDING',
      expectedAmount: p.amount,
      amount: null,
      transactionDate: '2026-09-29',
      competenceDate: p.competenceDate,
      dueDate: p.dueDate,
      paidAt: null,
      accountId: account,
      categoryId: category,
      ownerMemberId: null,
      notes: null,
      createdBy: 'u',
      createdAt: '',
      updatedAt: '',
      account: { id: account, name: 'Conta' },
      category: { id: category, name: 'Cursos' },
      installmentGroupId: 'group',
      installmentNumber: p.installmentNumber,
      installmentGroup: { id: 'group', installmentCount: 3 },
    })),
  };
  mocks.request.mockImplementation(
    async (
      path: string,
      ws: string,
      _signal: unknown,
      options?: { method: string; body?: Record<string, unknown> },
    ) => {
      if (path.startsWith('/accounts'))
        return [{ id: account, name: 'Conta', isActive: true }];
      if (path.startsWith('/categories'))
        return [
          { id: category, name: 'Cursos', type: 'EXPENSE', isActive: true },
        ];
      if (path.includes('/installments/preview'))
        return {
          ...plan,
          availableBefore: '5000.00',
          availableAfter: '4000.00',
        };
      if (path === '/installments/preview') return plan;
      if (path.startsWith('/transactions/summary'))
        return {
          income: { expected: '0.00', realized: '0.00' },
          expense: { expected: '0.00', realized: '0.00' },
        };
      if (path.startsWith('/transactions?'))
        return rows.filter((r) => r.workspaceId === ws);
      if (path.includes('purchase-preview'))
        return {
          referenceMonth: '2026-11-01',
          closingDate: '2026-10-25',
          dueDate: '2026-11-10',
        };
      if (
        path === '/installments' ||
        (path.endsWith('/installments') && options)
      ) {
        rows = [
          {
            ...group.installments[0],
            competenceDate: brazilToday().slice(0, 7) + '-01',
          },
        ];
        return group;
      }
      if (path.includes('/installment-groups/group/cancel')) {
        group.installments[0].status = 'CANCELLED';
        return group;
      }
      if (path.startsWith('/installment-groups/'))
        return structuredClone(group);
      if (path.startsWith('/credit-cards'))
        return [
          {
            id: cardId,
            workspaceId: ws,
            name: 'Nubank',
            creditLimit: '5000.00',
            usedLimit: '0.00',
            availableLimit: '5000.00',
            isActive: true,
            closingDay: 25,
            dueDay: 10,
            currentInvoice: null,
          },
        ];
      return {};
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function app(path = '/app/transactions') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/transactions" element={<Transactions />} />
        <Route path="/app/credit-cards" element={<CreditCards />} />
        <Route
          path="/app/installment-groups/:id"
          element={<InstallmentGroup />}
        />
      </Routes>
    </MemoryRouter>
  );
}
async function fillCommon() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: '＋ Nova despesa' }),
  );
  await user.selectOptions(screen.getByLabelText('Pagamento'), 'INSTALLMENTS');
  await user.type(screen.getByLabelText('Descrição'), 'Curso');
  await user.type(screen.getByLabelText('Valor total (R$)'), '1000,00');
  await user.selectOptions(screen.getByLabelText('Conta'), account);
  await user.selectOptions(screen.getByLabelText('Categoria'), category);
  fireEvent.change(screen.getByLabelText('Primeiro vencimento'), {
    target: { value: '2026-10-10' },
  });
  return user;
}
it('alternância e prévia exigida, centavos residuais e criação', async () => {
  render(app());
  const user = await fillCommon();
  expect(
    (
      screen.getByRole('button', {
        name: 'Salvar parcelamento',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar parcelas' }),
  );
  await screen.findByText(/333,34/);
  expect(screen.getByText('10/12/2026')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Salvar parcelamento' }));
  await screen.findByRole('heading', { name: 'Curso 1/3' });
  expect(
    screen.getByRole('link', { name: 'Ver parcelamento 1/3' }),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  const call = mocks.request.mock.calls.find((c) => c[0] === '/installments');
  expect(call?.[3].body.totalAmount).toBe('1000.00');
  expect(call?.[3].body.installmentCount).toBe(3);
});
it('volta para à vista e invalida preview quando parâmetros mudam', async () => {
  render(app());
  const user = await fillCommon();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar parcelas' }),
  );
  await screen.findByText(/333,34/);
  fireEvent.change(screen.getByLabelText('Número de parcelas'), {
    target: { value: '4' },
  });
  expect(screen.queryByLabelText('Prévia do parcelamento')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'Salvar parcelamento',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.selectOptions(screen.getByLabelText('Pagamento'), 'SINGLE');
  expect(screen.getByLabelText('Valor previsto (R$)')).toBeTruthy();
});
it('detalhe exibe todas as parcelas e cancelamento individual', async () => {
  render(app('/app/installment-groups/group'));
  await screen.findByRole('heading', { name: 'Curso 3/3' });
  const user = userEvent.setup();
  await user.click(
    screen.getAllByRole('button', { name: 'Cancelar esta parcela' })[0],
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar cancelamento' }),
  );
  await screen.findByText('Cancelada');
  expect(
    mocks.request.mock.calls.find((c) => String(c[0]).endsWith('/cancel'))?.[3]
      .body,
  ).toEqual({ scope: 'ONE', fromInstallmentNumber: 1 });
});
it('cartão parcelado mostra limite antes/depois e envia valor total', async () => {
  render(app('/app/credit-cards'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Nova compra' }));
  await user.selectOptions(screen.getByLabelText('Pagamento'), 'INSTALLMENTS');
  await user.type(screen.getByLabelText('Descrição'), 'Notebook');
  await user.type(screen.getByLabelText('Valor total (R$)'), '1000,00');
  await user.selectOptions(screen.getByLabelText('Categoria'), category);
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar parcelas' }),
  );
  await screen.findByText(/Limite disponível antes/);
  expect(screen.getByText(/4.000,00/)).toBeTruthy();
  expect(screen.getByText('dezembro de 2026')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Salvar parcelamento' }));
  await screen.findByText('Compra registrada na fatura.');
  const call = mocks.request.mock.calls.find(
    (c) => c[0] === `/credit-cards/${cardId}/installments`,
  );
  expect(call?.[3].body.totalAmount).toBe('1000.00');
});
it('grupo de cartão pago bloqueia cancelamento e mostra faturas', async () => {
  group.origin = 'CREDIT_CARD';
  group.creditCardId = cardId;
  group.creditCard = { id: cardId, name: 'Nubank' };
  group.installments[0].status = 'PAID';
  group.installments.forEach((p, i) => (p.invoiceId = 'invoice' + i));
  render(app('/app/installment-groups/group'));
  await screen.findByRole('heading', { name: 'Curso' });
  expect(
    screen.queryByRole('button', { name: 'Cancelar compra parcelada' }),
  ).toBeNull();
  expect(screen.getAllByRole('link', { name: 'Ver fatura' })).toHaveLength(3);
  expect(
    screen.queryByRole('button', { name: 'Cancelar esta parcela' }),
  ).toBeNull();
});
it('troca de workspace limpa formulário e prévia', async () => {
  const view = render(app());
  const user = await fillCommon();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar parcelas' }),
  );
  await screen.findByText(/333,34/);
  mocks.ws = 'b';
  view.rerender(app());
  expect(screen.queryByRole('dialog')).toBeNull();
  await screen.findByText('Nenhum lançamento neste mês.');
});
it('erro de preview impede salvar', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((...args: unknown[]) =>
    String(args[0]).includes('/installments/preview')
      ? Promise.reject(
          new Error('O total deve permitir pelo menos R$ 0,01 por parcela.'),
        )
      : original(...args),
  );
  render(app());
  const user = await fillCommon();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar parcelas' }),
  );
  await screen.findByRole('alert');
  expect(
    (
      screen.getByRole('button', {
        name: 'Salvar parcelamento',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    within(screen.getByRole('dialog')).getByLabelText('Valor total (R$)'),
  ).toBeTruthy();
});
