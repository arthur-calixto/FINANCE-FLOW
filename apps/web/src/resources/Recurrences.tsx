import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AccountRecord,
  CategoryRecord,
  CategoryType,
  RecurrenceRecord,
  RecurrenceDetail,
  RecurrencePreview,
  TransactionRecord,
} from '@finance-flow/types';
import {
  createRecurrenceSchema,
  recurrencePreviewSchema,
  endRecurrenceSchema,
} from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import { brazilToday, formatDate } from '../dates';
import { formatMoney, parseMoneyInput } from '../money';
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
import { useCardData } from './use-card-data';
import { TransactionDialog } from './Transactions';
const statusLabels = {
  ACTIVE: 'Ativa',
  ENDING: 'Encerramento agendado',
  ENDED: 'Encerrada',
};
const transactionStatus = {
  PENDING: 'Pendente',
  OVERDUE: 'Atrasado',
  PAID: 'Pago / Recebido',
  CANCELLED: 'Cancelado',
};
function frequencyLabel(row: RecurrenceRecord) {
  if (row.interval !== 1)
    return `A cada ${row.interval} ${row.frequency === 'MONTHLY' ? 'meses' : 'anos'}`;
  return row.frequency === 'MONTHLY'
    ? `Mensal · dia ${row.dueDay}`
    : `Anual · ${formatDate(row.startDate).slice(0, 5)}`;
}
function RecurrenceForm({
  ws,
  accounts,
  categories,
  close,
  saved,
}: {
  ws: string;
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  close: () => void;
  saved: () => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    [type, setType] = useState<CategoryType>('EXPENSE'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [plan, setPlan] = useState<RecurrencePreview | null>(null);
  function values() {
    const v = Object.fromEntries(new FormData(form.current!));
    return {
      description: v.description,
      type,
      expectedAmount: parseMoneyInput(String(v.expectedAmount)),
      frequency: v.frequency,
      firstDueDate: v.firstDueDate,
      accountId: v.accountId,
      categoryId: v.categoryId,
      notes: v.notes || null,
    };
  }
  async function preview() {
    setBusy(true);
    setError('');
    setPlan(null);
    try {
      const v = values();
      const body = recurrencePreviewSchema.parse({
        expectedAmount: v.expectedAmount,
        frequency: v.frequency,
        firstDueDate: v.firstDueDate,
      });
      setPlan(
        (await apiRequest('/recurrences/preview', ws, undefined, {
          method: 'POST',
          body,
        })) as RecurrencePreview,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Informe valor positivo, frequência e primeiro vencimento válidos.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/recurrences', ws, undefined, {
        method: 'POST',
        body: createRecurrenceSchema.parse(values()),
      });
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira os campos e selecione conta e categoria compatíveis.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Nova recorrência" onClose={close} busy={busy}>
      <form ref={form} onSubmit={submit} onChange={() => setPlan(null)}>
        <fieldset disabled={busy}>
          <FormField label="Tipo">
            <Select
              aria-label="Tipo"
              value={type}
              onChange={(e) => setType(e.target.value as CategoryType)}
            >
              <option value="EXPENSE">Despesa</option>
              <option value="INCOME">Receita</option>
            </Select>
          </FormField>
          <FormField label="Descrição">
            <Input name="description" required maxLength={500} autoFocus />
          </FormField>
          <div className="transaction-form-grid">
            <FormField label="Valor previsto (R$)">
              <Input name="expectedAmount" required inputMode="decimal" />
            </FormField>
            <FormField label="Frequência">
              <Select
                aria-label="Frequência"
                name="frequency"
                defaultValue="MONTHLY"
              >
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </Select>
            </FormField>
            <FormField label="Primeiro vencimento">
              <Input
                name="firstDueDate"
                type="date"
                required
                defaultValue={brazilToday()}
              />
            </FormField>
          </div>
          <p className="form-note">
            O dia deste vencimento será repetido, ajustado ao último dia nos
            meses mais curtos. Datas anteriores não preenchem meses passados.
          </p>
          <FormField label="Conta">
            <Select
              aria-label="Conta"
              name="accountId"
              required
              defaultValue=""
            >
              <option value="">Selecione uma conta</option>
              {accounts
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Categoria">
            <Select
              aria-label="Categoria"
              name="categoryId"
              key={type}
              required
              defaultValue=""
            >
              <option value="">Selecione uma categoria</option>
              {categories
                .filter((c) => c.isActive && c.type === type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Observações">
            <textarea className="input" name="notes" maxLength={5000} />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void preview()}
          >
            Pré-visualizar ocorrências
          </Button>
        </fieldset>
        {plan && (
          <section
            className="installment-preview"
            aria-label="Prévia da recorrência"
          >
            <p>
              Projeção do mês atual e dos próximos 11 meses. A janela avança
              automaticamente nas consultas.
            </p>
            {plan.occurrences.length ? (
              <>
                <ol>
                  {plan.occurrences.slice(0, 5).map((p) => (
                    <li key={p.dueDate}>
                      <span>{formatDate(p.dueDate)}</span>
                      <strong>{formatMoney(p.expectedAmount)}</strong>
                    </li>
                  ))}
                </ol>
                {plan.occurrences.length > 5 && (
                  <p>+ {plan.occurrences.length - 5} ocorrências futuras</p>
                )}
              </>
            ) : (
              <p>
                Nenhuma ocorrência nesta janela. A recorrência será gerada
                quando o vencimento entrar na projeção.
              </p>
            )}
          </section>
        )}
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
          <Button disabled={busy || !plan}>Salvar recorrência</Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Recurrences() {
  const { activeWorkspaceId } = useAuth();
  const { id } = useParams();
  return activeWorkspaceId ? (
    <Content
      key={activeWorkspaceId + (id ?? '')}
      ws={activeWorkspaceId}
      id={id}
    />
  ) : null;
}
function Content({ ws, id }: { ws: string; id?: string }) {
  const { me } = useAuth();
  const writable = me?.workspaces.find((w) => w.id === ws)?.role !== 'VIEWER';
  const data = useCardData<RecurrenceRecord[] | RecurrenceDetail>(
      id ? '/recurrences/' + id : '/recurrences',
      ws,
    ),
    accounts = useCardData<AccountRecord[]>(
      '/accounts?includeInactive=true',
      ws,
    ),
    categories = useCardData<CategoryRecord[]>(
      '/categories?includeInactive=true',
      ws,
    );
  const [creating, setCreating] = useState(false),
    [ending, setEnding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [editor, setEditor] = useState<
      | { kind: 'edit'; row: TransactionRecord; type: CategoryType }
      | { kind: 'pay' | 'cancel' | 'reopen'; row: TransactionRecord }
      | null
    >(null);
  const group = id ? (data.data as RecurrenceDetail | null) : null;
  function reload() {
    setCreating(false);
    setEnding(false);
    setEditor(null);
    data.reload();
  }
  async function end(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = endRecurrenceSchema.parse(
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      await apiRequest('/recurrences/' + id, ws, undefined, {
        method: 'DELETE',
        body,
      });
      reload();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Informe uma data válida.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (data.error || accounts.error || categories.error)
    return (
      <ErrorState
        message={data.error || accounts.error || categories.error}
        retry={() => {
          data.reload();
          accounts.reload();
          categories.reload();
        }}
      />
    );
  if (!data.data || !accounts.data || !categories.data) return <LoadingState />;
  return (
    <>
      {id && <Link to="/app/recurrences">← Recorrências</Link>}
      <div className="page-heading">
        <div>
          <span className="eyebrow">Fixos e recorrentes</span>
          <h1>{group?.description ?? 'Recorrências'}</h1>
          <p>
            {group
              ? `${group.type === 'INCOME' ? 'Receita' : 'Despesa'} · ${formatMoney(group.expectedAmount)} · ${frequencyLabel(group)}`
              : 'Acompanhe receitas e despesas que se repetem.'}
          </p>
        </div>
        {writable &&
          (group ? (
            group.status !== 'ENDED' && (
              <Button
                variant="danger"
                onClick={() => {
                  setError('');
                  setEnding(true);
                }}
              >
                Encerrar recorrência
              </Button>
            )
          ) : (
            <Button onClick={() => setCreating(true)}>
              ＋ Nova recorrência
            </Button>
          ))}
      </div>
      {group ? (
        <>
          <p>
            {statusLabels[group.status]} · {group.account?.name} ·{' '}
            {group.category?.name}
          </p>
          <p>
            Próximo vencimento:{' '}
            {group.nextDueDate
              ? formatDate(group.nextDueDate)
              : 'Sem ocorrência pendente na janela'}
            {group.endDate &&
              ` · Encerramento a partir de ${formatDate(group.endDate)}`}
          </p>
          {group.revisions.length > 0 && (
            <p className="form-note">
              Regras futuras:{' '}
              {group.revisions
                .map(
                  (r) =>
                    `${formatDate(r.effectiveDate)}: ${formatMoney(r.expectedAmount)}`,
                )
                .join(' · ')}
            </p>
          )}
          <div className="transactions-list">
            {group.occurrences.map((row) => (
              <Card key={row.id}>
                <div className="transaction-heading">
                  <h2>
                    {formatDate(row.dueDate)} · {row.description}
                  </h2>
                  <span className={'badge status-' + row.status}>
                    {transactionStatus[row.status]}
                  </span>
                </div>
                <p>
                  Previsto:{' '}
                  <strong>{formatMoney(row.expectedAmount ?? '0')}</strong>
                  {row.amount && ` · Realizado: ${formatMoney(row.amount)}`}
                </p>
                {writable && row.status !== 'CANCELLED' && (
                  <div className="card-actions">
                    {(group.status !== 'ENDED' || row.status !== 'PAID') && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setEditor({ kind: 'edit', row, type: row.type })
                        }
                      >
                        {row.status === 'PAID' ? 'Alterar próximos' : 'Editar'}
                      </Button>
                    )}
                    {row.status !== 'PAID' && (
                      <>
                        <Button onClick={() => setEditor({ kind: 'pay', row })}>
                          {row.type === 'INCOME' ? 'Receber' : 'Pagar'}
                        </Button>
                        <Button
                          variant="quiet"
                          onClick={() => setEditor({ kind: 'cancel', row })}
                        >
                          Cancelar somente este lançamento
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
          {!group.occurrences.length && (
            <EmptyState
              title="Nenhuma ocorrência nesta janela."
              description="Os lançamentos serão criados quando entrarem na projeção de 12 meses."
            />
          )}
        </>
      ) : (
        <div className="transactions-list">
          {(data.data as RecurrenceRecord[]).map((row) => (
            <Card key={row.id}>
              <div className="transaction-heading">
                <h2>{row.description}</h2>
                <span className="badge">{statusLabels[row.status]}</span>
              </div>
              <p>
                {row.type === 'INCOME' ? 'Receita' : 'Despesa'} ·{' '}
                {formatMoney(row.expectedAmount)} · {frequencyLabel(row)}
              </p>
              <p>
                {row.account?.name} · {row.category?.name}
              </p>
              <p>
                Próximo:{' '}
                {row.nextDueDate
                  ? formatDate(row.nextDueDate)
                  : 'Sem ocorrência pendente na janela'}
              </p>
              <Link
                className="button button-secondary"
                to={'/app/recurrences/' + row.id}
              >
                Ver ocorrências
              </Link>
            </Card>
          ))}
          {!(data.data as RecurrenceRecord[]).length && (
            <EmptyState
              title="Nenhuma recorrência cadastrada."
              description="Cadastre salário, aluguel ou outros compromissos recorrentes."
            />
          )}
        </div>
      )}
      {creating && (
        <RecurrenceForm
          ws={ws}
          accounts={accounts.data}
          categories={categories.data}
          close={() => setCreating(false)}
          saved={reload}
        />
      )}
      {editor && (
        <TransactionDialog
          editor={editor}
          accounts={accounts.data}
          categories={categories.data}
          workspaceId={ws}
          close={() => setEditor(null)}
          saved={reload}
        />
      )}
      {ending && (
        <Dialog
          title="Encerrar recorrência"
          onClose={() => setEnding(false)}
          busy={busy}
        >
          <form onSubmit={end}>
            <fieldset disabled={busy}>
              <FormField label="Encerrar a partir de">
                <Input
                  name="fromDate"
                  type="date"
                  min={group!.startDate}
                  defaultValue={group!.nextDueDate ?? brazilToday()}
                  required
                />
              </FormField>
              <p>
                Ocorrências pendentes a partir dessa data original serão
                canceladas. Pagas e histórico anterior serão preservados. Esta
                ação não pode ser desfeita nesta versão.
              </p>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEnding(false)}
                disabled={busy}
              >
                Voltar
              </Button>
              <Button variant="danger" disabled={busy}>
                Confirmar encerramento
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
