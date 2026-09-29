import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  InstallmentGroupRecord,
  TransactionRecord,
} from '@finance-flow/types';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import {
  brazilToday,
  formatDate,
  monthLabel,
  paymentTimestamp,
} from '../dates';
import { formatMoney, parseMoneyInput } from '../money';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  FormField,
  Input,
  LoadingState,
} from '../ui';
import { useCardData } from './use-card-data';
export function InstallmentGroup() {
  const { activeWorkspaceId } = useAuth(),
    { id } = useParams();
  return activeWorkspaceId && id ? (
    <GroupContent key={activeWorkspaceId + id} ws={activeWorkspaceId} id={id} />
  ) : null;
}
function GroupContent({ ws, id }: { ws: string; id: string }) {
  const { me } = useAuth(),
    detail = useCardData<InstallmentGroupRecord>(
      '/installment-groups/' + id,
      ws,
    );
  const writable = me?.workspaces.find((w) => w.id === ws)?.role !== 'VIEWER';
  const [action, setAction] = useState<{
      kind: 'ALL' | 'ONE' | 'FROM' | 'PAY';
      row?: TransactionRecord;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (action!.kind === 'PAY')
        await apiRequest(
          `/transactions/${action!.row!.id}/pay`,
          ws,
          undefined,
          {
            method: 'POST',
            body: {
              amount: parseMoneyInput(String(v.amount)),
              paidAt: paymentTimestamp(String(v.paidAt)),
            },
          },
        );
      else
        await apiRequest(
          '/installment-groups/' +
            id +
            (action!.kind === 'ALL' ? '' : '/cancel'),
          ws,
          undefined,
          {
            method: action!.kind === 'ALL' ? 'DELETE' : 'POST',
            ...(action!.kind !== 'ALL'
              ? {
                  body: {
                    scope: action!.kind,
                    fromInstallmentNumber: action!.row!.installmentNumber,
                  },
                }
              : {}),
          },
        );
      setAction(null);
      detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }
  const group = detail.data;
  if (detail.error)
    return <ErrorState message={detail.error} retry={detail.reload} />;
  if (!group) return <LoadingState />;
  const card = group.origin === 'CREDIT_CARD',
    paid = group.installments.some((p) => p.status === 'PAID');
  return (
    <>
      <Link to="/app/transactions">← Lançamentos</Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            Parcelamento {card ? 'no cartão' : 'financeiro'}
          </span>
          <h1>{group.description}</h1>
          <p>
            {formatMoney(group.totalAmount)} em {group.installmentCount}x ·{' '}
            {card ? group.creditCard?.name : group.account?.name}
          </p>
        </div>
        {card &&
          writable &&
          !paid &&
          group.installments.some((p) => p.status !== 'CANCELLED') && (
            <Button
              variant="danger"
              onClick={() => {
                setError('');
                setAction({ kind: 'ALL' });
              }}
            >
              Cancelar compra parcelada
            </Button>
          )}
      </div>
      <p>
        Valor original: {formatMoney(group.totalAmount)} ·{' '}
        {group.installmentCount} parcelas.
        <br />
        Controle iniciado em {group.startingInstallment}/
        {group.installmentCount}.<br />
        Parcelas anteriores ao FINANCE FLOW: {group.previousInstallmentCount}.
        <br />
        Valor controlado inicialmente: {formatMoney(group.controlledAmount)} (
        {group.controlledInstallmentCount} parcelas).
      </p>
      <p className="form-note">
        Estrutura preservada após a criação.{' '}
        {card
          ? 'Se alguma parcela já foi paga, o cancelamento da compra fica bloqueado.'
          : 'Cancelamentos futuros preservam parcelas já pagas.'}
      </p>
      <div className="transactions-list">
        {group.installments.map((p) => (
          <Card key={p.id}>
            <div className="transaction-heading">
              <h2>{p.description}</h2>
              <span className={'badge status-' + p.status}>
                {p.status === 'PAID'
                  ? group.type === 'INCOME'
                    ? 'Recebida'
                    : 'Paga'
                  : p.status === 'CANCELLED'
                    ? 'Cancelada'
                    : p.status === 'OVERDUE'
                      ? 'Atrasada'
                      : 'Pendente'}
              </span>
            </div>
            <p>
              Vencimento: {formatDate(p.dueDate)} ·{' '}
              {monthLabel(p.competenceDate.slice(0, 7))}
            </p>
            <strong>
              {formatMoney(p.expectedAmount ?? p.amount ?? '0.00')}
            </strong>
            {p.amount && p.amount !== p.expectedAmount && (
              <p>Realizado: {formatMoney(p.amount)}</p>
            )}
            <div className="card-actions">
              {card && p.invoiceId ? (
                <Link
                  to={`/app/credit-cards/${group.creditCardId}/invoices/${p.invoiceId}`}
                >
                  Ver fatura
                </Link>
              ) : (
                writable &&
                ['PENDING', 'OVERDUE'].includes(p.status) && (
                  <>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setError('');
                        setAction({ kind: 'ONE', row: p });
                      }}
                    >
                      Cancelar esta parcela
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setError('');
                        setAction({ kind: 'FROM', row: p });
                      }}
                    >
                      Cancelar esta e as próximas
                    </Button>
                    <Button
                      onClick={() => {
                        setError('');
                        setAction({ kind: 'PAY', row: p });
                      }}
                    >
                      {group.type === 'INCOME' ? 'Receber' : 'Pagar'}
                    </Button>
                  </>
                )
              )}
            </div>
          </Card>
        ))}
      </div>
      {action && (
        <Dialog
          title={
            action.kind === 'PAY' ? 'Baixar parcela' : 'Confirmar cancelamento'
          }
          onClose={() => setAction(null)}
          busy={busy}
        >
          <form onSubmit={submit}>
            {action.kind === 'PAY' ? (
              <fieldset disabled={busy}>
                <FormField label="Valor realizado (R$)">
                  <Input
                    name="amount"
                    defaultValue={(
                      action.row!.amount ??
                      action.row!.expectedAmount ??
                      ''
                    ).replace('.', ',')}
                    required
                  />
                </FormField>
                <FormField label="Data da baixa">
                  <Input
                    name="paidAt"
                    type="date"
                    defaultValue={brazilToday()}
                    required
                  />
                </FormField>
              </fieldset>
            ) : (
              <p>
                {action.kind === 'ALL'
                  ? 'Todas as parcelas desta compra serão canceladas e o limite será liberado.'
                  : action.kind === 'FROM'
                    ? 'Esta e as próximas parcelas pendentes serão canceladas. Parcelas pagas serão preservadas.'
                    : 'Somente a parcela selecionada será cancelada.'}{' '}
                O histórico será mantido.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Voltar
              </Button>
              <Button disabled={busy}>
                {action.kind === 'PAY'
                  ? 'Confirmar baixa'
                  : 'Confirmar cancelamento'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
