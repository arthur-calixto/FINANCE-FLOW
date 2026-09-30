import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AccountRecord,
  CategoryRecord,
  TransactionRecord,
} from '@finance-flow/types';
import {
  updateRecurrenceSchema,
  updateTransactionSchema,
} from '@finance-flow/validation';
import { apiRequest } from '../api';
import { parseMoneyInput } from '../money';
import { Button, Dialog, FormField, Input, Select } from '../ui';
export function RecurrenceEdit({
  row,
  accounts,
  categories,
  workspaceId,
  close,
  saved,
}: {
  row: TransactionRecord;
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  workspaceId: string;
  close: () => void;
  saved: () => void;
}) {
  const [scope, setScope] = useState(row.status === 'PAID' ? 'FROM' : 'ONE'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const changes = {
        description: v.description,
        expectedAmount: parseMoneyInput(String(v.expectedAmount)),
        accountId: v.accountId,
        categoryId: v.categoryId,
        notes: v.notes || null,
      };
      const body =
        scope === 'ONE'
          ? updateTransactionSchema.parse({
              ...changes,
              dueDate: v.dueDate,
              recurrenceScope: 'ONE',
            })
          : updateRecurrenceSchema.parse({
              ...changes,
              fromTransactionId: row.id,
            });
      await apiRequest(
        scope === 'ONE'
          ? '/transactions/' + row.id
          : '/recurrences/' + row.recurrenceId,
        workspaceId,
        undefined,
        { method: 'PATCH', body },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira os campos e informe um valor previsto positivo.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Editar lançamento recorrente" onClose={close} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <FormField label="Como deseja aplicar esta alteração?">
            <Select
              aria-label="Como deseja aplicar esta alteração?"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="ONE" disabled={row.status === 'PAID'}>
                Somente este lançamento
              </option>
              <option value="FROM">Este e os próximos</option>
            </Select>
          </FormField>
          <p className="form-note">
            {scope === 'ONE'
              ? 'A regra da recorrência e os outros meses serão preservados.'
              : 'Atualiza as ocorrências pendentes a partir desta posição. Pagas, canceladas e regras posteriores já agendadas serão preservadas. Frequência e dia-base não mudam.'}
          </p>
          <FormField label="Descrição">
            <Input
              name="description"
              defaultValue={row.description}
              required
              maxLength={500}
            />
          </FormField>
          <FormField label="Valor previsto (R$)">
            <Input
              name="expectedAmount"
              defaultValue={row.expectedAmount?.replace('.', ',')}
              required
              inputMode="decimal"
            />
          </FormField>
          {scope === 'ONE' && (
            <FormField label="Vencimento">
              <Input
                name="dueDate"
                type="date"
                defaultValue={row.dueDate}
                required
              />
            </FormField>
          )}
          <FormField label="Conta">
            <Select
              aria-label="Conta"
              name="accountId"
              defaultValue={row.accountId ?? ''}
              required
            >
              {accounts
                .filter((a) => a.isActive || a.id === row.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isActive ? '' : ' (inativa)'}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Categoria">
            <Select
              aria-label="Categoria"
              name="categoryId"
              defaultValue={row.categoryId ?? ''}
              required
            >
              {categories
                .filter(
                  (c) =>
                    c.type === row.type &&
                    (c.isActive || c.id === row.categoryId),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? '' : ' (inativa)'}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Observações">
            <textarea
              className="input"
              name="notes"
              maxLength={5000}
              defaultValue={row.notes ?? ''}
            />
          </FormField>
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
          <Button disabled={busy}>Salvar alteração</Button>
        </div>
      </form>
    </Dialog>
  );
}
