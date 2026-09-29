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
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccountRecord, CategoryRecord } from '@finance-flow/types';
const mocks = vi.hoisted(() => ({
  workspaceId: 'workspace-a',
  request: vi.fn(),
}));
vi.mock('../auth', () => ({
  useAuth: () => ({
    activeWorkspaceId: mocks.workspaceId,
    me: { workspaces: [{ id: mocks.workspaceId, role: 'OWNER' }] },
  }),
}));
vi.mock('../api', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
}));
import { Accounts } from './Accounts';
import { Categories } from './Categories';
import { formatMoney, parseMoneyInput } from '../money';
let accounts: AccountRecord[];
let categories: CategoryRecord[];
const base = {
  workspaceId: 'workspace-a',
  isActive: true,
  createdAt: '',
  updatedAt: '',
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
  mocks.workspaceId = 'workspace-a';
  accounts = [];
  categories = [];
  mocks.request.mockImplementation(
    async (
      path: string,
      ws: string,
      _signal: unknown,
      options?: { method: string; body?: Record<string, unknown> },
    ) => {
      const isAccount = path.startsWith('/accounts');
      const rows = isAccount ? accounts : categories;
      if (!options)
        return rows.filter((r) => r.workspaceId === ws).map((r) => ({ ...r }));
      if (options.method === 'POST') {
        const record = {
          ...base,
          ...options.body,
          id: crypto.randomUUID(),
          workspaceId: ws,
          ...(isAccount ? { ownerMemberId: null } : {}),
        };
        if (isAccount) accounts.push(record as AccountRecord);
        else categories.push(record as CategoryRecord);
        return record;
      }
      const row = rows.find((r) => r.id === path.split('/').pop())!;
      Object.assign(
        row,
        options.method === 'DELETE' ? { isActive: false } : options.body,
      );
      return { ...row };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('Contas', () => {
  it('estado vazio e criação com saldo negativo preciso', async () => {
    const user = userEvent.setup();
    render(<Accounts />);
    await screen.findByText('Você ainda não possui contas cadastradas.');
    await user.click(screen.getByRole('button', { name: '＋ Nova conta' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Nubank');
    const balance = within(dialog).getByLabelText(/Saldo inicial/);
    await user.clear(balance);
    await user.type(balance, '-350,25');
    await user.click(
      within(dialog).getByRole('button', { name: 'Salvar conta' }),
    );
    await screen.findByRole('heading', { name: 'Nubank' });
    expect(accounts[0].initialBalance).toBe('-350.25');
    expect(screen.getByText('Conta corrente')).toBeTruthy();
    expect(screen.getByText(/350,25/)).toBeTruthy();
  });
  it('edita e confirma desativação; filtro permite reativar', async () => {
    accounts.push({
      ...base,
      id: 'a',
      name: 'Nubank',
      type: 'CHECKING',
      initialBalance: '0.00',
      currency: 'BRL',
      ownerMemberId: null,
    });
    const user = userEvent.setup();
    render(<Accounts />);
    await screen.findByText('Nubank');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const name = screen.getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'Principal');
    await user.click(screen.getByRole('button', { name: 'Salvar conta' }));
    await screen.findByText('Principal');
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(accounts[0].isActive).toBe(true);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Desativar',
      }),
    );
    await waitFor(() => expect(accounts[0].isActive).toBe(false));
    await user.click(screen.getByLabelText('Mostrar inativas'));
    await screen.findByRole('button', { name: 'Reativar' });
    await user.click(screen.getByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(accounts[0].isActive).toBe(true));
  });
  it('troca workspace limpa dados e formulário antigos', async () => {
    accounts.push(
      {
        ...base,
        id: 'a',
        name: 'Conta A',
        type: 'CASH',
        initialBalance: '0.00',
        currency: 'BRL',
        ownerMemberId: null,
      },
      {
        ...base,
        workspaceId: 'workspace-b',
        id: 'b',
        name: 'Conta B',
        type: 'CASH',
        initialBalance: '0.00',
        currency: 'BRL',
        ownerMemberId: null,
      },
    );
    const user = userEvent.setup();
    const view = render(<Accounts />);
    await screen.findByText('Conta A');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    mocks.workspaceId = 'workspace-b';
    view.rerender(<Accounts />);
    expect(screen.queryByText('Conta A')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('Conta B');
  });
  it('erro com ação de tentar novamente e loading', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Falha de conexão'));
    render(<Accounts />);
    expect(screen.getByRole('status').textContent).toContain('Carregando');
    await screen.findByRole('alert');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Você ainda não possui contas cadastradas.');
  });
});
describe('Categorias', () => {
  it('cria categoria e subcategoria com hierarquia', async () => {
    const user = userEvent.setup();
    render(<Categories />);
    await screen.findByText('Suas categorias começam por você.');
    await user.click(screen.getByRole('button', { name: '＋ Nova categoria' }));
    await user.type(screen.getByLabelText('Nome'), 'Alimentação');
    await user.click(screen.getByRole('button', { name: 'Salvar categoria' }));
    await screen.findByText('Alimentação');
    await user.click(
      screen.getByRole('button', { name: 'Criar subcategoria de Alimentação' }),
    );
    expect(
      (screen.getByLabelText('Categoria pai (opcional)') as HTMLSelectElement)
        .value,
    ).toBe(categories[0].id);
    await user.type(screen.getByLabelText('Nome'), 'Mercado');
    await user.click(screen.getByRole('button', { name: 'Salvar categoria' }));
    await screen.findByText('Mercado');
    expect(categories[1].parentId).toBe(categories[0].id);
    expect(
      screen.getByText('Mercado').closest('li')?.parentElement?.parentElement
        ?.textContent,
    ).toContain('Alimentação');
    expect(screen.getByRole('heading', { name: 'Despesas' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Receitas' })).toBeTruthy();
  });
  it('edita; pais excluem próprio registro, descendentes e tipos diferentes', async () => {
    categories.push(
      {
        ...base,
        id: 'root',
        name: 'Alimentação',
        type: 'EXPENSE',
        parentId: null,
      },
      {
        ...base,
        id: 'child',
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: 'root',
      },
      {
        ...base,
        id: 'income',
        name: 'Salário',
        type: 'INCOME',
        parentId: null,
      },
    );
    const user = userEvent.setup();
    render(<Categories />);
    await screen.findByText('Alimentação');
    await user.click(
      screen.getByRole('button', { name: 'Editar Alimentação' }),
    );
    const select = screen.getByLabelText('Categoria pai (opcional)');
    expect(within(select).getAllByRole('option')).toHaveLength(1);
    const name = screen.getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'Comida');
    await user.click(screen.getByRole('button', { name: 'Salvar categoria' }));
    await screen.findByText('Comida');
  });
  it('desativar pai preserva filho e mantém pai inativo como contexto', async () => {
    categories.push(
      {
        ...base,
        id: 'root',
        name: 'Alimentação',
        type: 'EXPENSE',
        parentId: null,
      },
      {
        ...base,
        id: 'child',
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: 'root',
      },
    );
    const user = userEvent.setup();
    render(<Categories />);
    await screen.findByText('Alimentação');
    await user.click(
      screen.getByRole('button', { name: 'Desativar Alimentação' }),
    );
    expect(screen.getByRole('dialog').textContent).toContain(
      'Somente esta categoria',
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Desativar',
      }),
    );
    await screen.findByRole('button', { name: 'Reativar Alimentação' });
    expect(screen.getByText('Mercado')).toBeTruthy();
    expect(categories[1].isActive).toBe(true);
  });
  it('troca de workspace substitui categorias', async () => {
    categories.push(
      {
        ...base,
        id: 'a',
        name: 'Categoria A',
        type: 'EXPENSE',
        parentId: null,
      },
      {
        ...base,
        workspaceId: 'workspace-b',
        id: 'b',
        name: 'Categoria B',
        type: 'INCOME',
        parentId: null,
      },
    );
    const view = render(<Categories />);
    await screen.findByText('Categoria A');
    mocks.workspaceId = 'workspace-b';
    view.rerender(<Categories />);
    expect(screen.queryByText('Categoria A')).toBeNull();
    await screen.findByText('Categoria B');
  });
});
it('formata dinheiro sem perder centavos e rejeita entrada ambígua', () => {
  expect(formatMoney('9007199254740993.01')).toContain(
    '9.007.199.254.740.993,01',
  );
  expect(parseMoneyInput('-350,25')).toBe('-350.25');
  expect(() => parseMoneyInput('1.234,56')).toThrow();
  expect(() => parseMoneyInput('1,001')).toThrow();
});
