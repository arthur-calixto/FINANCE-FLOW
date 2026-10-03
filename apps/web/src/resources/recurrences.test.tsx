import { monthViewFixture } from '../../test/month-view';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  RecurrenceRecord,
  RecurrenceDetail,
  TransactionRecord,
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
import { Recurrences } from './Recurrences';
import { Transactions } from './Transactions';
const account = '00000000-0000-4000-8000-000000000001',
  expense = '00000000-0000-4000-8000-000000000002',
  income = '00000000-0000-4000-8000-000000000003',
  id = '00000000-0000-4000-8000-000000000004',
  occurrenceId = '00000000-0000-4000-8000-000000000005';
let list: RecurrenceRecord[], detail: RecurrenceDetail;
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
  list = [];
  const occurrence: TransactionRecord = {
    id: occurrenceId,
    workspaceId: 'a',
    description: 'Internet',
    type: 'EXPENSE',
    status: 'PENDING',
    expectedAmount: '120.00',
    amount: null,
    transactionDate: '2026-10-10',
    dueDate: '2026-10-10',
    competenceDate: '2026-10-01',
    recurrenceDate: '2026-10-10',
    recurrenceId: id,
    paidAt: null,
    accountId: account,
    categoryId: expense,
    ownerMemberId: null,
    notes: null,
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    account: { id: account, name: 'Conta' },
    category: { id: expense, name: 'Serviços' },
  };
  detail = {
    id,
    description: 'Internet',
    type: 'EXPENSE',
    expectedAmount: '120.00',
    frequency: 'MONTHLY',
    interval: 1,
    dueDay: 10,
    startDate: '2026-10-10',
    endDate: null,
    nextDueDate: '2026-10-10',
    status: 'ACTIVE',
    isActive: true,
    accountId: account,
    categoryId: expense,
    account: { id: account, name: 'Conta' },
    category: { id: expense, name: 'Serviços' },
    notes: null,
    revisions: [],
    occurrences: [
      occurrence,
      {
        ...occurrence,
        id: '00000000-0000-4000-8000-000000000006',
        dueDate: '2026-11-10',
        recurrenceDate: '2026-11-10',
        competenceDate: '2026-11-01',
      },
    ],
  };
  mocks.request.mockImplementation(
    async (
      path: string,
      _ws: string,
      _signal: unknown,
      options?: { method: string; body: Record<string, unknown> },
    ) => {
      if (path.startsWith('/accounts'))
        return [{ id: account, name: 'Conta', isActive: true }];
      if (path.startsWith('/categories'))
        return [
          { id: expense, name: 'Serviços', type: 'EXPENSE', isActive: true },
          { id: income, name: 'Salário', type: 'INCOME', isActive: true },
        ];
      if (path === '/recurrences/preview')
        return {
          from: '2026-10-01',
          until: '2027-10-01',
          occurrences: Array.from({ length: 12 }, (_, i) => ({
            dueDate: `${i < 3 ? 2026 : 2027}-${String(((i + 9) % 12) + 1).padStart(2, '0')}-10`,
            competenceDate: '2026-10-01',
            expectedAmount: '120.00',
          })),
        };
      if (path === '/recurrences' && options) {
        list = [detail];
        return detail;
      }
      if (path === '/recurrences') return list;
      if (path === '/recurrences/' + id) {
        if (options?.method === 'DELETE') {
          detail.status = 'ENDED';
          detail.endDate = String(options.body.fromDate);
        }
        return structuredClone(detail);
      }
      if (path.startsWith('/transactions/month-view'))
        return monthViewFixture([detail.occurrences[0]]);
      if (path.endsWith('/pay')) {
        detail.occurrences[0].status = 'PAID';
        detail.occurrences[0].amount = String(options?.body.amount);
        return detail.occurrences[0];
      }
      if (path.endsWith('/cancel') && options?.method === 'POST') {
        detail.occurrences[0].status = 'CANCELLED';
        return detail.occurrences[0];
      }
      return detail.occurrences[0];
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function app(path = '/app/recurrences') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/recurrences" element={<Recurrences />} />
        <Route path="/app/recurrences/:id" element={<Recurrences />} />
        <Route path="/app/transactions" element={<Transactions />} />
      </Routes>
    </MemoryRouter>
  );
}
async function fill(type = 'EXPENSE') {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: '＋ Nova recorrência' }),
  );
  await user.selectOptions(screen.getByLabelText('Tipo'), type);
  await user.type(
    screen.getByLabelText('Descrição'),
    type === 'EXPENSE' ? 'Internet' : 'Salário',
  );
  await user.type(
    screen.getByLabelText('Valor previsto (R$)'),
    type === 'EXPENSE' ? '120' : '5000',
  );
  fireEvent.change(screen.getByLabelText('Primeiro vencimento'), {
    target: { value: '2026-10-10' },
  });
  await user.selectOptions(screen.getByLabelText('Conta'), account);
  await user.selectOptions(
    screen.getByLabelText('Categoria'),
    type === 'EXPENSE' ? expense : income,
  );
  return user;
}
it('vazio, prévia obrigatória, criação de despesa e listagem', async () => {
  render(app());
  await screen.findByText('Nenhuma recorrência cadastrada.');
  const user = await fill();
  expect(
    (
      screen.getByRole('button', {
        name: 'Salvar recorrência',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar ocorrências' }),
  );
  await screen.findByText('+ 7 ocorrências futuras');
  await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
  await screen.findByRole('heading', { name: 'Internet' });
  expect(
    mocks.request.mock.calls.find((c) => c[0] === '/recurrences' && c[3])?.[3]
      .body,
  ).toMatchObject({
    type: 'EXPENSE',
    expectedAmount: '120',
    frequency: 'MONTHLY',
    interval: 1,
  });
});
it('receita filtra categorias e alteração de campos invalida preview', async () => {
  render(app());
  const user = await fill('INCOME');
  expect(
    within(screen.getByLabelText('Categoria')).queryByText('Serviços'),
  ).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar ocorrências' }),
  );
  await screen.findByLabelText('Prévia da recorrência');
  fireEvent.change(screen.getByLabelText('Frequência'), {
    target: { value: 'YEARLY' },
  });
  expect(screen.queryByLabelText('Prévia da recorrência')).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar ocorrências' }),
  );
  await screen.findByLabelText('Prévia da recorrência');
  await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
  await screen.findByRole('heading', { name: 'Internet' });
  expect(
    mocks.request.mock.calls.find((c) => c[0] === '/recurrences' && c[3])?.[3]
      .body,
  ).toMatchObject({
    type: 'INCOME',
    categoryId: income,
    expectedAmount: '5000',
    frequency: 'YEARLY',
  });
});
it('detalhe permite alteração individual com identidade preservada', async () => {
  render(app('/app/recurrences/' + id));
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole('button', { name: 'Editar' }))[0],
  );
  expect(
    screen.getByLabelText('Como deseja aplicar esta alteração?'),
  ).toBeTruthy();
  await user.clear(screen.getByLabelText('Valor previsto (R$)'));
  await user.type(screen.getByLabelText('Valor previsto (R$)'), '140');
  await user.click(screen.getByRole('button', { name: 'Salvar alteração' }));
  await screen.findByRole('heading', { name: 'Internet' });
  expect(
    mocks.request.mock.calls.find(
      (c) =>
        c[0] === '/transactions/' + occurrenceId && c[3]?.method === 'PATCH',
    )?.[3].body,
  ).toMatchObject({
    recurrenceScope: 'ONE',
    expectedAmount: '140',
    dueDate: '2026-10-10',
  });
});
it('este e próximos usa corte da ocorrência sem enviar calendário', async () => {
  render(app('/app/recurrences/' + id));
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole('button', { name: 'Editar' }))[0],
  );
  await user.selectOptions(
    screen.getByLabelText('Como deseja aplicar esta alteração?'),
    'FROM',
  );
  expect(screen.queryByLabelText('Vencimento')).toBeNull();
  await user.clear(screen.getByLabelText('Valor previsto (R$)'));
  await user.type(screen.getByLabelText('Valor previsto (R$)'), '135');
  await user.click(screen.getByRole('button', { name: 'Salvar alteração' }));
  await screen.findByRole('heading', { name: 'Internet' });
  const body = mocks.request.mock.calls.find(
    (c) => c[0] === '/recurrences/' + id && c[3]?.method === 'PATCH',
  )?.[3].body;
  expect(body).toMatchObject({
    fromTransactionId: occurrenceId,
    expectedAmount: '135',
  });
  expect(body.dueDate).toBeUndefined();
});
it('baixa com diferença preserva valor previsto e cancelamento é individual', async () => {
  render(app('/app/recurrences/' + id));
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole('button', { name: 'Pagar' }))[0],
  );
  await user.clear(screen.getByLabelText('Valor pago (R$)'));
  await user.type(screen.getByLabelText('Valor pago (R$)'), '126,90');
  await user.click(screen.getByRole('button', { name: 'Confirmar baixa' }));
  await screen.findByText(/Realizado:.*126,90/);
  expect(detail.expectedAmount).toBe('120.00');
  await user.click(
    screen.getByRole('button', { name: 'Cancelar somente este lançamento' }),
  );
  await screen.findByText(/Somente este lançamento será cancelado/);
  await user.click(
    screen.getByRole('button', { name: 'Confirmar cancelamento' }),
  );
  expect(
    mocks.request.mock.calls.some(
      (c) => c[0].endsWith('/cancel') && c[3]?.method === 'POST',
    ),
  ).toBe(true);
  expect(
    mocks.request.mock.calls.some(
      (c) => c[0].startsWith('/recurrences/') && c[3]?.method === 'DELETE',
    ),
  ).toBe(false);
});
it('encerrar usa data explícita e preserva listagem histórica', async () => {
  render(app('/app/recurrences/' + id));
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Encerrar recorrência' }),
  );
  fireEvent.change(screen.getByLabelText('Encerrar a partir de'), {
    target: { value: '2027-01-10' },
  });
  await user.click(
    screen.getByRole('button', { name: 'Confirmar encerramento' }),
  );
  await screen.findByText(/Encerrada/);
  expect(
    mocks.request.mock.calls.find(
      (c) => c[0] === '/recurrences/' + id && c[3]?.method === 'DELETE',
    )?.[3].body,
  ).toEqual({ fromDate: '2027-01-10' });
  expect(
    screen.getByRole('heading', { name: '10/10/2026 · Internet' }),
  ).toBeTruthy();
});
it('troca de workspace descarta formulário e prévia', async () => {
  const view = render(app());
  const user = await fill();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar ocorrências' }),
  );
  await screen.findByLabelText('Prévia da recorrência');
  mocks.ws = 'b';
  view.rerender(app());
  expect(screen.queryByRole('dialog')).toBeNull();
  await screen.findByText('Nenhuma recorrência cadastrada.');
});
it('lançamentos identificam recorrência e oferecem escolha apenas na edição recorrente', async () => {
  render(app('/app/transactions'));
  const user = userEvent.setup();
  await screen.findByRole('link', { name: 'Recorrente · Ver recorrência' });
  await user.click(screen.getByLabelText('Ações de Internet'));
  await user.click(screen.getByRole('button', { name: 'Editar' }));
  await screen.findByLabelText('Como deseja aplicar esta alteração?');
});
it('VIEWER consulta sem ações de criação ou mutação', async () => {
  mocks.role = 'VIEWER';
  render(app('/app/recurrences/' + id));
  await screen.findByRole('heading', { name: 'Internet' });
  expect(
    screen.queryByRole('button', { name: 'Encerrar recorrência' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
});
it('erro na prévia impede salvar', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((...args: unknown[]) =>
    args[0] === '/recurrences/preview'
      ? Promise.reject(new Error('Não foi possível gerar a prévia.'))
      : original(...args),
  );
  render(app());
  const user = await fill();
  await user.click(
    screen.getByRole('button', { name: 'Pré-visualizar ocorrências' }),
  );
  await screen.findByRole('alert');
  expect(
    (
      screen.getByRole('button', {
        name: 'Salvar recorrência',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
