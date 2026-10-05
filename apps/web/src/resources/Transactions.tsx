import { useSearchParams } from 'react-router-dom';
import { monthSchema } from '@finance-flow/validation';
import { PermanentDeletionDialog } from './PermanentDeletionDialog';
import { RecurrenceEdit } from './RecurrenceEdit';
import { InstallmentForm } from './InstallmentForm';
import { TransactionTables } from './TransactionTables';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AccountRecord,
  CategoryRecord,
  CategoryType,
  TransactionRecord,
  TransactionMonthView,
} from '@finance-flow/types';
import {
  createTransactionSchema,
  updateTransactionSchema,
  payTransactionSchema,
} from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import { formatMoney, parseMoneyInput, moneyDifference } from '../money';
import {
  brazilToday,
  monthLabel,
  shiftMonth,
  paymentTimestamp,
} from '../dates';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Select,
} from '../ui';
const statuses = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELLED: 'Cancelado',
};
export type Editor =
  | { kind: 'edit'; row?: TransactionRecord; type: CategoryType }
  | { kind: 'pay' | 'cancel' | 'reopen'; row: TransactionRecord }
  | { kind: 'delete'; row: TransactionRecord };
type TransactionDialogProps = {
  editor: Editor;
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  workspaceId: string;
  defaultDate?: string;
  close: () => void;
  saved: () => void;
};
export function TransactionDialog(props: TransactionDialogProps) {
  if (props.editor.kind === 'delete')
    return (
      <PermanentDeletionDialog
        row={props.editor.row}
        workspaceId={props.workspaceId}
        close={props.close}
        saved={props.saved}
      />
    );
  return <TransactionFormDialog {...props} editor={props.editor} />;
}
function TransactionFormDialog({
  editor,
  accounts,
  categories,
  workspaceId,
  defaultDate,
  close,
  saved,
}: Omit<TransactionDialogProps, 'editor'> & {
  editor: Exclude<Editor, { kind: 'delete' }>;
}) {
  const row = editor.row;
  const [installments, setInstallments] = useState(false);
  const [type, setType] = useState<CategoryType>(
    editor.kind === 'edit' ? editor.type : row!.type,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const title =
    editor.kind === 'edit'
      ? row
        ? 'Editar lançamento'
        : type === 'INCOME'
          ? 'Nova receita'
          : 'Nova despesa'
      : editor.kind === 'pay'
        ? type === 'INCOME'
          ? 'Receber receita'
          : 'Pagar despesa'
        : editor.kind === 'reopen'
          ? 'Reabrir lançamento'
          : 'Cancelar lançamento';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (editor.kind === 'edit') {
        const data = {
          description: v.description,
          type,
          expectedAmount: v.expectedAmount
            ? parseMoneyInput(String(v.expectedAmount))
            : null,
          amount: v.amount ? parseMoneyInput(String(v.amount)) : null,
          transactionDate: v.transactionDate,
          dueDate: v.dueDate,
          accountId: v.accountId,
          categoryId: v.categoryId,
          notes: v.notes || null,
        };
        const body = (
          row ? updateTransactionSchema : createTransactionSchema
        ).parse(data);
        await apiRequest(
          '/transactions' + (row ? '/' + row.id : ''),
          workspaceId,
          undefined,
          { method: row ? 'PATCH' : 'POST', body },
        );
      } else if (editor.kind === 'pay') {
        const body = payTransactionSchema.parse({
          amount: parseMoneyInput(String(v.amount)),
          paidAt: paymentTimestamp(String(v.paidAt)),
        });
        await apiRequest(
          `/transactions/${row!.id}/pay`,
          workspaceId,
          undefined,
          { method: 'POST', body },
        );
      } else {
        await apiRequest(
          `/transactions/${row!.id}/${editor.kind}`,
          workspaceId,
          undefined,
          { method: 'POST', body: {} },
        );
      }

      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira os campos. Informe datas válidas e pelo menos um valor positivo.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (row?.recurrenceId && editor.kind === 'edit')
    return (
      <RecurrenceEdit
        row={row}
        accounts={accounts}
        categories={categories}
        workspaceId={workspaceId}
        close={close}
        saved={saved}
      />
    );
  if (installments && !row && editor.kind === 'edit')
    return (
      <InstallmentForm
        ws={workspaceId}
        origin="ACCOUNT"
        initialType={type}
        accounts={accounts}
        categories={categories}
        close={close}
        saved={saved}
        single={() => setInstallments(false)}
      />
    );
  return (
    <Dialog title={title} onClose={close} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {editor.kind === 'edit' ? (
            <>
              {!row && (
                <FormField label="Pagamento">
                  <Select
                    aria-label="Pagamento"
                    value="SINGLE"
                    onChange={() => setInstallments(true)}
                  >
                    <option value="SINGLE">À vista</option>
                    <option value="INSTALLMENTS">Parcelado</option>
                  </Select>
                </FormField>
              )}
              <FormField label="Tipo">
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value as CategoryType)}
                >
                  <option value="EXPENSE">Despesa</option>
                  <option value="INCOME">Receita</option>
                </Select>
              </FormField>
              <FormField label="Descrição">
                <Input
                  name="description"
                  required
                  maxLength={500}
                  defaultValue={row?.description}
                  autoFocus
                />
              </FormField>
              <div className="transaction-form-grid">
                <FormField label="Valor previsto (R$)">
                  <Input
                    name="expectedAmount"
                    inputMode="decimal"
                    defaultValue={row?.expectedAmount?.replace('.', ',')}
                  />
                </FormField>
                <FormField
                  label="Valor realizado conhecido (R$)"
                  hint="Pode ser informado antes da baixa."
                >
                  <Input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={row?.amount?.replace('.', ',')}
                  />
                </FormField>
                <FormField label="Data do lançamento">
                  <Input
                    type="date"
                    name="transactionDate"
                    required
                    defaultValue={
                      row?.transactionDate ?? defaultDate ?? brazilToday()
                    }
                  />
                </FormField>
                <FormField
                  label="Vencimento"
                  hint="Define automaticamente o mês financeiro."
                >
                  <Input
                    type="date"
                    name="dueDate"
                    required
                    defaultValue={row?.dueDate ?? defaultDate ?? brazilToday()}
                  />
                </FormField>
              </div>
              <FormField label="Conta">
                <Select
                  name="accountId"
                  required
                  defaultValue={row?.accountId ?? ''}
                >
                  <option value="">Selecione uma conta</option>
                  {accounts
                    .filter((a) => a.isActive || a.id === row?.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {!a.isActive ? ' (inativa)' : ''}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="Categoria">
                <Select
                  key={type}
                  name="categoryId"
                  required
                  defaultValue={
                    row?.type === type ? (row.categoryId ?? '') : ''
                  }
                >
                  <option value="">Selecione uma categoria</option>
                  {categories
                    .filter(
                      (c) =>
                        c.type === type &&
                        (c.isActive || c.id === row?.categoryId),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {!c.isActive ? ' (inativa)' : ''}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="Observações">
                <textarea
                  className="input"
                  name="notes"
                  maxLength={5000}
                  defaultValue={row?.notes ?? ''}
                />
              </FormField>
              <p className="form-note">
                Use valores positivos, com vírgula para centavos. Cadastre
                contas e categorias antes de criar lançamentos.
              </p>
            </>
          ) : editor.kind === 'pay' ? (
            <>
              <p>
                {row!.description} · Previsto:{' '}
                {row!.expectedAmount
                  ? formatMoney(row!.expectedAmount)
                  : 'Não informado'}
              </p>
              <FormField
                label={
                  type === 'INCOME' ? 'Valor recebido (R$)' : 'Valor pago (R$)'
                }
              >
                <Input
                  name="amount"
                  required
                  inputMode="decimal"
                  defaultValue={(
                    row!.amount ??
                    row!.expectedAmount ??
                    ''
                  ).replace('.', ',')}
                  autoFocus
                />
              </FormField>
              <FormField
                label={
                  type === 'INCOME'
                    ? 'Data do recebimento'
                    : 'Data do pagamento'
                }
              >
                <Input
                  type="date"
                  name="paidAt"
                  required
                  defaultValue={brazilToday()}
                />
              </FormField>
            </>
          ) : (
            <p>
              {editor.kind === 'reopen'
                ? 'O lançamento voltará a ficar pendente. O valor realizado conhecido será preservado.'
                : row?.recurrenceId
                  ? 'Somente este lançamento será cancelado. A recorrência e os outros meses continuam ativos.'
                  : 'O lançamento será cancelado e removido dos totais. Seu histórico será preservado.'}
            </p>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={busy}
          >
            Voltar
          </Button>
          <Button
            disabled={busy}
            variant={editor.kind === 'cancel' ? 'danger' : 'primary'}
          >
            {busy
              ? 'Salvando…'
              : editor.kind === 'edit'
                ? 'Salvar lançamento'
                : editor.kind === 'pay'
                  ? 'Confirmar baixa'
                  : editor.kind === 'reopen'
                    ? 'Reabrir'
                    : 'Confirmar cancelamento'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Transactions() {
  const { activeWorkspaceId } = useAuth();
  return activeWorkspaceId ? (
    <TransactionsContent
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
    />
  ) : null;
}
function TransactionsContent({ workspaceId }: { workspaceId: string }) {
  const { me } = useAuth();
  const writable =
    me?.workspaces.find((w) => w.id === workspaceId)?.role !== 'VIEWER';
  const [params] = useSearchParams();
  const [month, setMonth] = useState(() => {
    const parsed = monthSchema.safeParse(params.get('month'));
    return parsed.success ? parsed.data : brazilToday().slice(0, 7);
  });
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [accountId, setAccount] = useState(''),
    [categoryId, setCategory] = useState('');
  const [data, setData] = useState<{
    view: TransactionMonthView;
    accounts: AccountRecord[];
    categories: CategoryRecord[];
  } | null>(null);
  const [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [success, setSuccess] = useState(''),
    [editor, setEditor] = useState<Editor | null>(null);
  const query = new URLSearchParams({
    month,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status } : {}),
    ...(accountId ? { accountId } : {}),
    ...(categoryId ? { categoryId } : {}),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest(
        '/transactions/month-view?' + query,
        workspaceId,
        controller.signal,
      ),
      apiRequest(
        '/accounts?includeInactive=true',
        workspaceId,
        controller.signal,
      ),
      apiRequest(
        '/categories?includeInactive=true',
        workspaceId,
        controller.signal,
      ),
    ])
      .then(([view, accounts, categories]) => {
        if (!controller.signal.aborted)
          setData({
            view: view as TransactionMonthView,
            accounts: accounts as AccountRecord[],
            categories: categories as CategoryRecord[],
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Não foi possível carregar.',
          );
      });
    return () => controller.abort();
  }, [workspaceId, query, month, revision]);
  function refresh() {
    setData(null);
    setError('');
    setRevision((n) => n + 1);
  }
  function filter(action: () => void) {
    setData(null);
    setError('');
    setSuccess('');
    action();
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Seu mês financeiro</span>
          <h1>Lançamentos</h1>
          <p>
            Organize o que está previsto e acompanhe os pagamentos e
            recebimentos.
          </p>
        </div>
        {writable && (
          <div className="transaction-actions">
            <Button
              onClick={() => setEditor({ kind: 'edit', type: 'INCOME' })}
              disabled={!data}
            >
              ＋ Nova receita
            </Button>
            <Button
              variant="secondary"
              onClick={() => setEditor({ kind: 'edit', type: 'EXPENSE' })}
              disabled={!data}
            >
              ＋ Nova despesa
            </Button>
          </div>
        )}
      </div>
      <div className="month-navigation">
        <Button
          aria-label="Mês anterior"
          variant="secondary"
          disabled={month === '0001-01'}
          onClick={() => filter(() => setMonth(shiftMonth(month, -1)))}
        >
          ←
        </Button>
        <FormField label="Mês financeiro">
          <Input
            type="month"
            min="0001-01"
            max="9999-12"
            value={month}
            onChange={(e) => {
              if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                filter(() => setMonth(e.target.value));
            }}
          />
        </FormField>
        <Button
          aria-label="Próximo mês"
          variant="secondary"
          disabled={month === '9999-12'}
          onClick={() => filter(() => setMonth(shiftMonth(month, 1)))}
        >
          →
        </Button>
        <strong>{monthLabel(month)}</strong>
      </div>
      <div className="transaction-filters">
        <FormField label="Buscar lançamento">
          <Input
            type="search"
            value={search}
            maxLength={200}
            placeholder="Descrição"
            onChange={(e) => filter(() => setSearch(e.target.value))}
          />
        </FormField>
        <FormField label="Filtrar status">
          <Select
            aria-label="Filtrar status"
            value={status}
            onChange={(e) => filter(() => setStatus(e.target.value))}
          >
            <option value="">Todos os status</option>
            {Object.entries(statuses).map(([v, l]) => (
              <option value={v} key={v}>
                {v === 'PAID' ? 'Pago / Recebido' : l}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Filtrar conta">
          <Select
            aria-label="Filtrar conta"
            value={accountId}
            onChange={(e) => filter(() => setAccount(e.target.value))}
          >
            <option value="">Todas as contas</option>
            {data?.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Filtrar categoria">
          <Select
            aria-label="Filtrar categoria"
            value={categoryId}
            onChange={(e) => filter(() => setCategory(e.target.value))}
          >
            <option value="">Todas as categorias</option>
            {data?.categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      {error ? (
        <ErrorState message={error} retry={refresh} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          <div className="monthly-summary" aria-label="Resumo mensal">
            {(['income', 'expense'] as const).map((key) => (
              <Card key={key}>
                <span>
                  {key === 'income'
                    ? 'Receitas previstas'
                    : 'Despesas previstas'}
                </span>
                <strong>{formatMoney(data.view.summary[key].expected)}</strong>
                <small>
                  Realizado {formatMoney(data.view.summary[key].realized)}
                </small>
              </Card>
            ))}
            <Card>
              <span>Resultado previsto</span>
              <strong>
                {formatMoney(
                  moneyDifference(
                    data.view.summary.income.expected,
                    data.view.summary.expense.expected,
                  ),
                )}
              </strong>
              <small>
                Realizado{' '}
                {formatMoney(
                  moneyDifference(
                    data.view.summary.income.realized,
                    data.view.summary.expense.realized,
                  ),
                )}
              </small>
            </Card>
          </div>
          <p className="form-note">
            {search || status || accountId || categoryId
              ? 'Resumo e subtotais dos lançamentos filtrados neste mês.'
              : 'Resumo de todo o mês.'}{' '}
            Realizados incluem somente lançamentos pagos ou recebidos.
          </p>
          {!data.view.rows.length && (
            <Card>
              <EmptyState
                title="Nenhum lançamento neste mês."
                description="Crie uma receita ou despesa, ou ajuste os filtros."
              />
            </Card>
          )}
          <TransactionTables
            view={data.view}
            writable={writable}
            edit={setEditor}
          />
        </>
      )}
      {editor && data && (
        <TransactionDialog
          editor={editor}
          accounts={data.accounts}
          categories={data.categories}
          workspaceId={workspaceId}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setSuccess('Lançamento atualizado com sucesso.');
            refresh();
          }}
        />
      )}
    </>
  );
}
