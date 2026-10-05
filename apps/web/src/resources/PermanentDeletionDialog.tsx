import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  TransactionRecord,
  TransactionDeletionOptions,
  TransactionDeletionScope,
  TransactionDeletionResult,
} from '@finance-flow/types';
import { apiRequest } from '../api';
import {
  Button,
  Dialog,
  ErrorState,
  FormField,
  LoadingState,
  Select,
} from '../ui';
const labels = {
  THIS: 'Somente esta parcela',
  THIS_AND_FUTURE: 'Esta e as próximas',
  ALL: 'Todo o parcelamento',
};
export function PermanentDeletionDialog({
  row,
  workspaceId,
  close,
  saved,
}: {
  row: TransactionRecord;
  workspaceId: string;
  close: () => void;
  saved: (result: TransactionDeletionResult) => void;
}) {
  const cardInstallment = Boolean(row.creditCardId && row.installmentGroupId);
  const [options, setOptions] = useState<TransactionDeletionOptions | null>(
    cardInstallment
      ? null
      : {
          options: [
            {
              scope: 'THIS',
              count: 1,
              firstInstallment: row.installmentNumber ?? null,
              lastInstallment: row.installmentNumber ?? null,
            },
          ],
          blockedReason: null,
          installmentCount: row.installmentGroup?.installmentCount ?? null,
        },
  );
  const [scope, setScope] = useState<TransactionDeletionScope>('THIS'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!cardInstallment) return;
    const controller = new AbortController();
    apiRequest(
      `/transactions/${row.id}/deletion-options`,
      workspaceId,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setOptions(data as TransactionDeletionOptions);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoadError(
            e instanceof Error
              ? e.message
              : 'Não foi possível consultar as parcelas.',
          );
      });
    return () => controller.abort();
  }, [cardInstallment, row.id, workspaceId, attempt]);
  const selected = options?.options.find((o) => o.scope === scope);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest(
        `/transactions/${row.id}/permanent`,
        workspaceId,
        undefined,
        {
          method: 'DELETE',
          body: {
            confirm: true,
            ...(cardInstallment
              ? { scope, expectedCount: selected.count }
              : {}),
          },
        },
      );
      saved(result as TransactionDeletionResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        selected && selected.count > 1
          ? `Excluir ${selected.count} parcelas definitivamente?`
          : 'Excluir lançamento definitivamente?'
      }
      onClose={close}
      busy={busy}
    >
      <p>
        <strong>{row.description}</strong>
      </p>
      {loadError ? (
        <ErrorState
          message={loadError}
          retry={() => {
            setLoadError('');
            setAttempt((n) => n + 1);
          }}
        />
      ) : !options ? (
        <LoadingState />
      ) : options.blockedReason ? (
        <p role="alert">{options.blockedReason}</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {cardInstallment && (
              <FormField label="Como deseja excluir?">
                <Select
                  aria-label="Como deseja excluir?"
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as TransactionDeletionScope);
                    setError('');
                  }}
                >
                  {options.options.map((o) => (
                    <option key={o.scope} value={o.scope}>
                      {labels[o.scope]}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <p>
              {selected && selected.count > 1
                ? 'Estes lançamentos serão removidos permanentemente da fatura e não aparecerão mais no histórico ou nos relatórios.'
                : `Este lançamento será removido permanentemente${row.creditCardId ? ' da fatura' : ''} e não aparecerá mais no histórico ou nos relatórios.`}{' '}
              Esta ação não pode ser desfeita.
            </p>
            {selected && cardInstallment && (
              <p>
                <strong>
                  {selected.count}{' '}
                  {selected.count === 1
                    ? 'parcela será removida'
                    : 'parcelas serão removidas'}
                </strong>
                : {selected.firstInstallment}/{options.installmentCount}
                {selected.firstInstallment !== selected.lastInstallment
                  ? ` até ${selected.lastInstallment}/${options.installmentCount}`
                  : ''}
                . Somente parcelas ainda existentes neste intervalo serão
                excluídas.
              </p>
            )}
            {row.creditCardId && (
              <p>
                As faturas e o limite do cartão serão recalculados. Nenhuma
                parcela em fatura paga pode ser removida.
              </p>
            )}
            {row.status === 'PAID' && !row.creditCardId && (
              <p>A baixa também será removida dos totais realizados.</p>
            )}
            {row.recurrenceId && (
              <p>
                Somente esta ocorrência será excluída e não será gerada
                novamente. Os próximos meses continuam ativos.
              </p>
            )}
            {row.installmentGroupId && (
              <p>
                A numeração e os valores originais do parcelamento serão
                preservados enquanto houver parcelas.
              </p>
            )}
            <label className="delete-confirmation" key={scope}>
              <input type="checkbox" name="confirm" required /> Entendo que a
              exclusão é definitiva.
            </label>
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
            <Button variant="danger" disabled={busy || !selected}>
              {busy ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
