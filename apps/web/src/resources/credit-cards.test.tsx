import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  CreditCardRecord,
  InvoiceDetail,
  InvoiceRecord,
} from '@finance-flow/types';
const mocks = vi.hoisted(() => ({ ws: 'a', role: 'OWNER', request: vi.fn() }));
vi.mock('../auth', () => ({
  useAuth: () => ({
    activeWorkspaceId: mocks.ws,
    me: { workspaces: [{ id: mocks.ws, role: mocks.role }] },
  }),
}));
vi.mock('../api', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
}));
import { CreditCards } from './CreditCards';
import { CardInvoices } from './CardInvoices';
const cardId = '00000000-0000-4000-8000-000000000001',
  catId = '00000000-0000-4000-8000-000000000002',
  accountId = '00000000-0000-4000-8000-000000000003';
let cards: CreditCardRecord[], invoices: InvoiceDetail[];
function fixture(): CreditCardRecord {
  return {
    id: cardId,
    workspaceId: 'a',
    name: 'Nubank',
    creditLimit: '5000.00',
    closingDay: 25,
    dueDay: 10,
    isActive: true,
    usedLimit: '550.00',
    availableLimit: '4450.00',
    currentInvoice: null,
  };
}
function invoice(id = 'oct', month = '2026-10'): InvoiceDetail {
  return {
    id,
    workspaceId: 'a',
    creditCardId: cardId,
    referenceMonth: month + '-01',
    closingDate: '2026-09-25',
    dueDate: month + '-10',
    status: 'CLOSED',
    total: '350.00',
    purchaseCount: 1,
    paidAt: null,
    paidAmount: null,
    paymentAccountId: null,
    creditCard: { id: cardId, name: 'Nubank' },
    purchases: [
      {
        id: 'purchase',
        workspaceId: 'a',
        description: 'Supermercado',
        type: 'EXPENSE',
        status: 'PENDING',
        amount: '350.00',
        expectedAmount: '350.00',
        transactionDate: '2026-09-24',
        dueDate: month + '-10',
        competenceDate: month + '-01',
        paidAt: null,
        accountId: null,
        categoryId: catId,
        ownerMemberId: null,
        notes: null,
        createdBy: 'u',
        createdAt: '',
        updatedAt: '',
        account: null,
        category: { id: catId, name: 'Compras' },
      },
    ],
  };
}
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
  mocks.role = 'OWNER';
  cards = [];
  invoices = [];
  mocks.request.mockImplementation(
    async (
      path: string,
      ws: string,
      _signal: unknown,
      options?: { method: string; body?: Record<string, unknown> },
    ) => {
      const url = new URL(path, 'http://test');
      if (path.startsWith('/accounts'))
        return [{ id: accountId, name: 'Conta corrente', isActive: true }];
      if (path.startsWith('/categories'))
        return [
          { id: catId, name: 'Compras', type: 'EXPENSE', isActive: true },
          { id: 'income', name: 'Salário', type: 'INCOME', isActive: true },
        ];
      if (path.includes('purchase-preview'))
        return {
          referenceMonth: '2026-11-01',
          closingDate: '2026-10-25',
          dueDate: '2026-11-10',
        };
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
          ],
        };
      if (path.endsWith('/permanent')) {
        const id = path.split('/')[2];
        const affected = invoices.filter((i) =>
          i.purchases.some((p) => p.id === id),
        );
        for (const i of affected) {
          i.purchases = i.purchases.filter((p) => p.id !== id);
          i.purchaseCount = i.purchases.length;
          i.total = i.purchases.length ? '350.00' : '0.00';
        }
        const deletedInvoiceIds = affected
          .filter((i) => !i.purchases.length)
          .map((i) => i.id);
        invoices = invoices.filter((i) => !deletedInvoiceIds.includes(i.id));
        return { id, deleted: true, deletedCount: 1, deletedInvoiceIds };
      }
      if (!options) {
        if (url.pathname === '/credit-cards')
          return cards
            .filter((c) => c.workspaceId === ws)
            .map((c) => ({ ...c }));
        if (path.includes('/invoices/'))
          return structuredClone(
            invoices.find((i) => i.id === url.pathname.split('/')[4]),
          );
        if (path.includes('/invoices'))
          return structuredClone(
            invoices.filter(
              (i) =>
                !url.searchParams.get('month') ||
                i.referenceMonth.startsWith(url.searchParams.get('month')!),
            ),
          );
        return { ...cards[0] };
      }
      if (url.pathname === '/credit-cards') {
        const card = { ...fixture(), ...options.body, workspaceId: ws };
        cards.push(card);
        return card;
      }
      if (path.endsWith('/purchases'))
        return { id: 'new', ...options.body, invoiceId: 'nov' };
      if (path.includes('/purchases/')) {
        invoices[0].purchases[0].status = 'CANCELLED';
        invoices[0].total = '0.00';
        invoices[0].purchaseCount = 0;
        return { status: 'CANCELLED' };
      }
      if (path.endsWith('/pay')) {
        Object.assign(invoices[0], {
          status: 'PAID',
          paidAmount: '350.00',
          paymentAccountId: accountId,
          paymentAccount: { id: accountId, name: 'Conta corrente' },
        });
        invoices[0].purchases[0].status = 'PAID';
        return { ...invoices[0] };
      }
      Object.assign(
        cards[0],
        options.method === 'DELETE' ? { isActive: false } : options.body,
      );
      return { ...cards[0] };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function app(path = '/app/credit-cards') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/credit-cards" element={<CreditCards />} />
        <Route
          path="/app/credit-cards/:cardId/invoices"
          element={<CardInvoices />}
        />
        <Route
          path="/app/credit-cards/:cardId/invoices/:invoiceId"
          element={<CardInvoices />}
        />
      </Routes>
    </MemoryRouter>
  );
}
it('estado vazio, criação e exibição de limites', async () => {
  const user = userEvent.setup();
  render(app());
  await screen.findByText('Nenhum cartão cadastrado.');
  await user.click(screen.getByRole('button', { name: '＋ Novo cartão' }));
  await user.type(screen.getByLabelText('Nome'), 'Meu cartão');
  await user.type(screen.getByLabelText('Limite (R$)'), '5000,00');
  await user.click(screen.getByRole('button', { name: 'Salvar cartão' }));
  await screen.findByRole('heading', { name: 'Meu cartão' });
  expect(screen.getByText(/4.450,00/)).toBeTruthy();
});
it('edição, desativação e reativação preservam cartão', async () => {
  cards = [fixture()];
  const user = userEvent.setup();
  render(app());
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  const name = screen.getByLabelText('Nome');
  await user.clear(name);
  await user.type(name, 'Nubank Mastercard');
  await user.click(screen.getByRole('button', { name: 'Salvar cartão' }));
  await screen.findByRole('heading', { name: 'Nubank Mastercard' });
  await user.click(screen.getByRole('button', { name: 'Desativar' }));
  await user.click(screen.getByRole('button', { name: 'Desativar cartão' }));
  await screen.findByText('Nenhum cartão cadastrado.');
  await user.click(screen.getByLabelText('Mostrar inativos'));
  await user.click(screen.getByRole('button', { name: 'Reativar' }));
  await screen.findByText('Cartão reativado.');
  await screen.findByRole('button', { name: 'Nova compra' });
  expect(cards[0].isActive).toBe(true);
});
it('nova compra consulta previsão do backend e limita categoria a despesa', async () => {
  cards = [fixture()];
  const user = userEvent.setup();
  render(app());
  await user.click(await screen.findByRole('button', { name: 'Nova compra' }));
  await user.type(screen.getByLabelText('Descrição'), 'Combustível');
  await user.type(screen.getByLabelText('Valor (R$)'), '200,00');
  fireEvent.change(screen.getByLabelText('Data da compra'), {
    target: { value: '2026-09-25' },
  });
  await screen.findByText(/Esta compra entrará na fatura de novembro de 2026/);
  expect(
    within(screen.getByLabelText('Categoria')).queryByText('Salário'),
  ).toBeNull();
  await user.selectOptions(screen.getByLabelText('Categoria'), catId);
  await user.click(screen.getByRole('button', { name: 'Salvar compra' }));
  await screen.findByText('Compra registrada na fatura.');
  const call = mocks.request.mock.calls.find(
    (c) => c[0].endsWith('/purchases') && c[3]?.method === 'POST',
  );
  expect(call?.[3].body).toEqual({
    description: 'Combustível',
    amount: '200.00',
    transactionDate: '2026-09-25',
    categoryId: catId,
    notes: null,
  });
});
it('fatura atual e futura acessíveis pelo histórico; detalhe de compras', async () => {
  cards = [fixture()];
  invoices = [invoice(), invoice('nov', '2026-11')];
  cards[0].currentInvoice = invoices[0] as InvoiceRecord;
  const user = userEvent.setup();
  render(app());
  await user.click(await screen.findByRole('link', { name: 'Ver fatura' }));
  await screen.findByRole('heading', { name: 'Fatura outubro de 2026' });
  expect(screen.getByRole('heading', { name: 'Supermercado' })).toBeTruthy();
  await user.click(
    within(
      screen.getByRole('navigation', { name: 'Histórico de faturas' }),
    ).getByRole('link', { name: /novembro de 2026/ }),
  );
  await screen.findByRole('heading', { name: 'Fatura novembro de 2026' });
});
it('pagamento integral exige conta e mostra liquidação sem ação duplicada', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  const user = userEvent.setup();
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByRole('button', { name: 'Pagar fatura' }));
  await user.selectOptions(
    screen.getByLabelText('Conta do pagamento'),
    accountId,
  );
  expect(
    (screen.getByLabelText('Valor integral (R$)') as HTMLInputElement).value,
  ).toBe('350,00');
  await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));
  await screen.findByText(/Paga usando Conta corrente/);
  expect(screen.queryByRole('button', { name: 'Pagar fatura' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancelar compra' })).toBeNull();
});
it('cancelamento preserva compra e recalcula total', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  const user = userEvent.setup();
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByLabelText('Ações de Supermercado'));
  await user.click(
    await screen.findByRole('button', { name: 'Cancelar compra' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar cancelamento' }),
  );
  await screen.findByText('Cancelada');
  await screen.findByText('0 compras válidas');
  expect(screen.queryByRole('button', { name: 'Pagar fatura' })).toBeNull();
});
it('troca de workspace remove limites e formulário anteriores', async () => {
  cards = [fixture()];
  const user = userEvent.setup();
  const view = render(app());
  await user.click(await screen.findByRole('button', { name: 'Nova compra' }));
  mocks.ws = 'b';
  view.rerender(app());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Nubank' })).toBeNull();
  await screen.findByText('Nenhum cartão cadastrado.');
});
it('VIEWER não tem ações de compra ou cadastro', async () => {
  cards = [fixture()];
  mocks.role = 'VIEWER';
  render(app());
  await screen.findByRole('heading', { name: 'Nubank' });
  expect(screen.queryByRole('button', { name: 'Nova compra' })).toBeNull();
  expect(screen.queryByRole('button', { name: '＋ Novo cartão' })).toBeNull();
});
it('erro de limite é exibido e preserva formulário', async () => {
  cards = [fixture()];
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((...args: unknown[]) => {
    if (String(args[0]).endsWith('/purchases') && args[3])
      return Promise.reject(
        new Error('A compra ultrapassa o limite disponível.'),
      );
    return original(...args);
  });
  const user = userEvent.setup();
  render(app());
  await user.click(await screen.findByRole('button', { name: 'Nova compra' }));
  await user.type(screen.getByLabelText('Descrição'), 'Compra');
  await user.type(screen.getByLabelText('Valor (R$)'), '6000');
  await user.selectOptions(screen.getByLabelText('Categoria'), catId);
  await user.click(screen.getByRole('button', { name: 'Salvar compra' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'A compra ultrapassa o limite disponível.',
    ),
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('exclusão direta na fatura atualiza detalhe e histórico sem deixar compra excluída', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  invoices[0].purchases.push({
    ...invoices[0].purchases[0],
    id: 'keep',
    description: 'Manter',
  });
  invoices[0].total = '700.00';
  invoices[0].purchaseCount = 2;
  const user = userEvent.setup();
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByLabelText('Ações de Supermercado'));
  await user.click(
    within(
      screen.getByLabelText('Ações de Supermercado').closest('details')!,
    ).getByRole('button', { name: 'Excluir definitivamente' }),
  );
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Excluir definitivamente',
    }),
  );
  await screen.findByText('1 compra válida');
  expect(screen.queryByRole('heading', { name: 'Supermercado' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Manter' })).toBeTruthy();
  expect(
    screen.getByRole('navigation', { name: 'Histórico de faturas' })
      .textContent,
  ).toMatch(/350,00/);
});
it('excluir última compra navega para faturas sem consultar detalhe removido', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  const user = userEvent.setup();
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByLabelText('Ações de Supermercado'));
  await user.click(
    within(
      screen.getByLabelText('Ações de Supermercado').closest('details')!,
    ).getByRole('button', { name: 'Excluir definitivamente' }),
  );
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Excluir definitivamente',
    }),
  );
  await screen.findByText('Nenhuma fatura neste período.');
  expect(
    screen.queryByRole('heading', { name: 'Fatura outubro de 2026' }),
  ).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('parcela na fatura usa seletor e não oferece ALL se parcialmente paga', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  Object.assign(invoices[0].purchases[0], {
    installmentGroupId: 'group',
    installmentNumber: 5,
    installmentGroup: { id: 'group', installmentCount: 10 },
  });
  const user = userEvent.setup();
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByLabelText('Ações de Supermercado'));
  expect(screen.queryByRole('button', { name: 'Cancelar compra' })).toBeNull();
  await user.click(
    within(
      screen.getByLabelText('Ações de Supermercado').closest('details')!,
    ).getByRole('button', { name: 'Excluir definitivamente' }),
  );
  await user.selectOptions(
    await screen.findByLabelText('Como deseja excluir?'),
    'THIS_AND_FUTURE',
  );
  expect(
    screen.queryByRole('option', { name: 'Todo o parcelamento' }),
  ).toBeNull();
  expect(
    screen.getByRole('heading', {
      name: 'Excluir 6 parcelas definitivamente?',
    }),
  ).toBeTruthy();
});
it('fatura paga explica bloqueio; VIEWER não recebe menu destrutivo', async () => {
  cards = [fixture()];
  invoices = [invoice()];
  invoices[0].status = 'PAID';
  const user = userEvent.setup();
  const view = render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await user.click(await screen.findByLabelText('Ações de Supermercado'));
  expect(screen.getByText(/não pode ser excluída diretamente/)).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Excluir definitivamente' }),
  ).toBeNull();
  view.unmount();
  mocks.role = 'VIEWER';
  render(app(`/app/credit-cards/${cardId}/invoices/oct`));
  await screen.findByRole('heading', { name: 'Supermercado' });
  expect(screen.queryByLabelText('Ações de Supermercado')).toBeNull();
});
