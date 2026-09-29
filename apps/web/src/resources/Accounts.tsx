import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AccountRecord, AccountType } from '@finance-flow/types';
import { createAccountSchema } from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import { formatMoney, parseMoneyInput } from '../money';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Select,
} from '../ui';
import { useResources } from './use-resources';
export const accountLabels: Record<AccountType, string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CASH: 'Dinheiro',
  INVESTMENT: 'Investimento',
  OTHER: 'Outra',
};
function AccountForm({
  record,
  workspaceId,
  close,
  saved,
}: {
  record?: AccountRecord;
  workspaceId: string;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    setBusy(true);
    try {
      const data = createAccountSchema.parse({
        name: values.name,
        type: values.type,
        initialBalance: parseMoneyInput(String(values.initialBalance)),
        currency: 'BRL',
      });
      await apiRequest(
        `/accounts${record ? '/' + record.id : ''}`,
        workspaceId,
        undefined,
        { method: record ? 'PATCH' : 'POST', body: data },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira o nome, tipo e saldo informado.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={record ? 'Editar conta' : 'Nova conta'}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <FormField label="Nome">
            <Input
              name="name"
              required
              maxLength={120}
              defaultValue={record?.name}
              placeholder="Ex.: Nubank"
              autoFocus
            />
          </FormField>
          <FormField label="Tipo">
            <Select name="type" defaultValue={record?.type ?? 'CHECKING'}>
              {Object.entries(accountLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Saldo inicial (R$)"
            hint="Valor de partida da conta. Use vírgula para centavos, sem separador de milhar. Pode ser negativo."
          >
            <Input
              name="initialBalance"
              inputMode="decimal"
              required
              defaultValue={record?.initialBalance.replace('.', ',') ?? '0,00'}
            />
          </FormField>
          <p className="form-note">
            Moeda: real brasileiro (BRL). Este valor não é um saldo calculado
            por movimentações.
          </p>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={close}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar conta'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Accounts() {
  const { activeWorkspaceId } = useAuth();
  return activeWorkspaceId ? (
    <AccountsContent key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
  ) : null;
}
function AccountsContent({ workspaceId }: { workspaceId: string }) {
  const { me } = useAuth();
  const writable =
    me?.workspaces.find((w) => w.id === workspaceId)?.role !== 'VIEWER';
  const list = useResources<AccountRecord>('/accounts', workspaceId);
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<AccountRecord | 'new' | null>(null);
  const [target, setTarget] = useState<AccountRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function changeStatus(row: AccountRecord, active: boolean) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/accounts/${row.id}`, workspaceId, undefined, {
        method: active ? 'PATCH' : 'DELETE',
        ...(active ? { body: { isActive: true } } : {}),
      });
      setTarget(null);
      setSuccess(
        active
          ? 'Conta reativada.'
          : 'Conta desativada. Seu histórico foi preservado.',
      );
      list.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível alterar a conta.',
      );
    } finally {
      setBusy(false);
    }
  }
  const rows = list.rows.filter((row) => inactive || row.isActive);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Organização</span>
          <h1>Contas</h1>
          <p>Os lugares onde você guarda e movimenta seu dinheiro.</p>
        </div>
        {writable && (
          <Button onClick={() => setEditing('new')}>＋ Nova conta</Button>
        )}
      </div>
      <div className="list-toolbar">
        <p>Seu ponto de partida, conta por conta.</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Mostrar inativas
        </label>
      </div>
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {error && !target && <ErrorState message={error} />}
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} retry={list.reload} />
      ) : !rows.length ? (
        <Card>
          <EmptyState
            title="Você ainda não possui contas cadastradas."
            description="Cadastre sua primeira conta para começar a organizar suas finanças. Contas inativas podem ser vistas pelo filtro acima."
            action={
              writable && (
                <Button onClick={() => setEditing('new')}>Nova conta</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="accounts-grid">
          {rows.map((row) => (
            <Card key={row.id} className={row.isActive ? '' : 'muted-card'}>
              <div className="account-heading">
                <span
                  className={`account-symbol type-${row.type}`}
                  aria-hidden="true"
                >
                  {row.name.slice(0, 1).toUpperCase()}
                </span>
                <Badge active={row.isActive} />
              </div>
              <h2>{row.name}</h2>
              <p className="account-type">{accountLabels[row.type]}</p>
              <div className="account-balance">
                <span>Saldo inicial</span>
                <strong
                  className={
                    row.initialBalance.startsWith('-') ? 'negative' : ''
                  }
                >
                  {formatMoney(row.initialBalance)}
                </strong>
              </div>
              {writable && (
                <div className="card-actions">
                  <Button variant="quiet" onClick={() => setEditing(row)}>
                    Editar
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      if (row.isActive) {
                        setError('');
                        setTarget(row);
                      } else void changeStatus(row, true);
                    }}
                  >
                    {row.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <AccountForm
          record={editing === 'new' ? undefined : editing}
          workspaceId={workspaceId}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            setSuccess('Conta salva com sucesso.');
            list.reload();
          }}
        />
      )}
      {target && (
        <ConfirmDialog
          title={`Desativar ${target.name}?`}
          description="A conta ficará inativa. Os dados e o histórico serão preservados, e você poderá reativá-la depois."
          busy={busy}
          error={error}
          onClose={() => setTarget(null)}
          onConfirm={() => void changeStatus(target, false)}
        />
      )}
    </>
  );
}
