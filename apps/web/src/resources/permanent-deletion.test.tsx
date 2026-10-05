import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  TransactionRecord,
  TransactionDeletionOptions,
} from '@finance-flow/types';
const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({
  apiRequest: (...args: unknown[]) => request(...args),
}));
import { PermanentDeletionDialog } from './PermanentDeletionDialog';
const row = {
  id: 'five',
  description: 'Notebook 5/10',
  type: 'EXPENSE',
  status: 'PENDING',
  creditCardId: 'card',
  installmentGroupId: 'group',
  installmentNumber: 5,
  installmentGroup: { id: 'group', installmentCount: 10 },
} as TransactionRecord;
let choices: TransactionDeletionOptions;
const saved = vi.fn(),
  close = vi.fn();
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  choices = {
    installmentCount: 10,
    blockedReason: null,
    options: [
      { scope: 'THIS', count: 1, firstInstallment: 5, lastInstallment: 5 },
      {
        scope: 'THIS_AND_FUTURE',
        count: 6,
        firstInstallment: 5,
        lastInstallment: 10,
      },
      { scope: 'ALL', count: 10, firstInstallment: 1, lastInstallment: 10 },
    ],
  };
  request.mockImplementation(async (_path, _ws, _signal, options) =>
    options
      ? { id: 'five', deleted: true, deletedCount: 6, deletedInvoiceIds: [] }
      : choices,
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const app = (ws = 'a') => (
  <PermanentDeletionDialog
    key={ws}
    row={row}
    workspaceId={ws}
    close={close}
    saved={saved}
  />
);
it('oferece scopes válidos, quantidade explícita e exige nova confirmação ao trocar alcance', async () => {
  const user = userEvent.setup();
  render(app());
  await screen.findByLabelText('Como deseja excluir?');
  expect(screen.getAllByRole('option')).toHaveLength(3);
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.selectOptions(
    screen.getByLabelText('Como deseja excluir?'),
    'THIS_AND_FUTURE',
  );
  expect(
    (
      screen.getByLabelText(
        'Entendo que a exclusão é definitiva.',
      ) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(
    screen.getByRole('heading', {
      name: 'Excluir 6 parcelas definitivamente?',
    }),
  ).toBeTruthy();
  expect(screen.getByText(/5\/10 até 10\/10/)).toBeTruthy();
  await user.click(
    screen.getByRole('button', { name: 'Excluir definitivamente' }),
  );
  expect(saved).not.toHaveBeenCalled();
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    screen.getByRole('button', { name: 'Excluir definitivamente' }),
  );
  expect(request).toHaveBeenLastCalledWith(
    '/transactions/five/permanent',
    'a',
    undefined,
    {
      method: 'DELETE',
      body: { confirm: true, scope: 'THIS_AND_FUTURE', expectedCount: 6 },
    },
  );
  expect(saved).toHaveBeenCalledOnce();
});
it('ALL mostra quantidade completa e envia escopo explícito', async () => {
  const user = userEvent.setup();
  render(app());
  await user.selectOptions(
    await screen.findByLabelText('Como deseja excluir?'),
    'ALL',
  );
  expect(
    screen.getByRole('heading', {
      name: 'Excluir 10 parcelas definitivamente?',
    }),
  ).toBeTruthy();
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    screen.getByRole('button', { name: 'Excluir definitivamente' }),
  );
  expect(request.mock.calls.at(-1)![3].body).toEqual({
    confirm: true,
    scope: 'ALL',
    expectedCount: 10,
  });
});
it('parcelamento parcialmente pago não oferece ALL; fatura futura paga deixa somente THIS', async () => {
  choices.options = choices.options.slice(0, 2);
  const view = render(app());
  await screen.findByLabelText('Como deseja excluir?');
  expect(
    screen.queryByRole('option', { name: 'Todo o parcelamento' }),
  ).toBeNull();
  view.unmount();
  choices.options = choices.options.slice(0, 1);
  render(app());
  await screen.findByLabelText('Como deseja excluir?');
  expect(screen.getAllByRole('option')).toHaveLength(1);
});
it('fatura paga após abrir a página bloqueia até exclusão individual', async () => {
  choices = {
    installmentCount: 10,
    options: [],
    blockedReason:
      'Esta compra pertence a uma fatura já paga e não pode ser excluída diretamente.',
  };
  render(app());
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('button', { name: 'Excluir definitivamente' }),
  ).toBeNull();
});
it('lote com lacunas mostra quantidade existente e intervalo original', async () => {
  choices.options[1].count = 5;
  const user = userEvent.setup();
  render(app());
  await user.selectOptions(
    await screen.findByLabelText('Como deseja excluir?'),
    'THIS_AND_FUTURE',
  );
  expect(
    screen.getByRole('heading', {
      name: 'Excluir 5 parcelas definitivamente?',
    }),
  ).toBeTruthy();
  expect(screen.getByText(/Somente parcelas ainda existentes/)).toBeTruthy();
});
it('erro ao consultar permite tentar novamente; erro de pagamento concorrente preserva confirmação', async () => {
  request.mockRejectedValueOnce(new Error('Falha ao consultar'));
  const user = userEvent.setup();
  render(app());
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByLabelText('Como deseja excluir?');
  request.mockRejectedValueOnce(
    new Error('Fatura já paga. Nenhuma parcela foi removida.'),
  );
  await user.click(
    screen.getByLabelText('Entendo que a exclusão é definitiva.'),
  );
  await user.click(
    screen.getByRole('button', { name: 'Excluir definitivamente' }),
  );
  await screen.findByText(/Nenhuma parcela foi removida/);
  expect(saved).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole('dialog')).getByLabelText('Como deseja excluir?'),
  ).toBeTruthy();
});
it('troca de workspace aborta prévia anterior e ignora resposta tardia', async () => {
  let resolve: (data: TransactionDeletionOptions) => void = () => {};
  request.mockImplementationOnce(
    () =>
      new Promise<TransactionDeletionOptions>((r) => {
        resolve = r;
      }),
  );
  const view = render(app());
  const first = request.mock.calls[0][2] as AbortSignal;
  view.rerender(app('b'));
  await screen.findByLabelText('Como deseja excluir?');
  expect(first.aborted).toBe(true);
  resolve({
    installmentCount: 10,
    options: [],
    blockedReason: 'Outro workspace',
  });
  await waitFor(() => expect(screen.queryByText('Outro workspace')).toBeNull());
  expect(request.mock.calls.at(-1)![1]).toBe('b');
});
