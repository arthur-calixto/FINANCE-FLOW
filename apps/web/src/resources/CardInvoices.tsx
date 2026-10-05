import { PermanentDeletionDialog } from './PermanentDeletionDialog';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import type {
  AccountRecord,
  CreditCardRecord,
  InvoiceRecord,
  InvoiceDetail,
  TransactionRecord,
} from '@finance-flow/types';
import { payInvoiceSchema } from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import { formatMoney, parseMoneyInput } from '../money';
import {
  brazilToday,
  formatDate,
  monthLabel,
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
import { useCardData } from './use-card-data';
import { invoiceLabels } from './CreditCards';
export function CardInvoices() {
  const { activeWorkspaceId } = useAuth(),
    { cardId, invoiceId } = useParams();
  return activeWorkspaceId && cardId ? (
    <InvoicePage
      key={activeWorkspaceId + cardId + (invoiceId ?? '')}
      ws={activeWorkspaceId}
      cardId={cardId}
      invoiceId={invoiceId}
    />
  ) : null;
}
function PayInvoiceForm({
  ws,
  invoice,
  close,
  saved,
}: {
  ws: string;
  invoice: InvoiceDetail;
  close: () => void;
  saved: () => void;
}) {
  const accounts = useCardData<AccountRecord[]>('/accounts', ws),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const body = payInvoiceSchema.parse({
        accountId: v.accountId,
        amount: parseMoneyInput(String(v.amount)),
        paidAt: paymentTimestamp(String(v.paidAt)),
      });
      await apiRequest(
        `/credit-cards/${invoice.creditCardId}/invoices/${invoice.id}/pay`,
        ws,
        undefined,
        { method: 'POST', body },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira conta, data e valor integral.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Pagar fatura" onClose={close} busy={busy}>
      <p>
        Pagamento integral. As compras serão realizadas sem gerar outra despesa.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <FormField label="Conta do pagamento">
            <Select
              name="accountId"
              aria-label="Conta do pagamento"
              required
              defaultValue=""
            >
              <option value="">Selecione uma conta ativa</option>
              {accounts.data
                ?.filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Valor integral (R$)">
            <Input
              name="amount"
              required
              readOnly
              value={invoice.total.replace('.', ',')}
            />
          </FormField>
          <FormField label="Data do pagamento">
            <Input
              type="date"
              name="paidAt"
              required
              defaultValue={brazilToday()}
            />
          </FormField>
        </fieldset>
        {accounts.error && (
          <ErrorState message={accounts.error} retry={accounts.reload} />
        )}{' '}
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
          <Button disabled={busy || !accounts.data?.length}>
            Confirmar pagamento
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function InvoicePage({
  ws,
  cardId,
  invoiceId,
}: {
  ws: string;
  cardId: string;
  invoiceId?: string;
}) {
  const { me } = useAuth();
  const writable = me?.workspaces.find((w) => w.id === ws)?.role !== 'VIEWER';
  const card = useCardData<CreditCardRecord>('/credit-cards/' + cardId, ws);
  const [month, setMonth] = useState('');
  return (
    <>
      <Link to="/app/credit-cards">← Cartões</Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Faturas do cartão</span>
          <h1>{card.data?.name ?? 'Faturas'}</h1>
          <p>Consulte as compras e o próximo compromisso financeiro.</p>
        </div>
      </div>
      {card.error ? (
        <ErrorState message={card.error} retry={card.reload} />
      ) : !card.data ? (
        <LoadingState />
      ) : (
        <>
          <FormField label="Consultar competência">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </FormField>
          <InvoiceHistory key={month} ws={ws} cardId={cardId} month={month} />
          {invoiceId && (
            <InvoiceContent
              key={invoiceId}
              ws={ws}
              cardId={cardId}
              invoiceId={invoiceId}
              writable={writable}
              onPaid={card.reload}
            />
          )}
        </>
      )}
    </>
  );
}
function InvoiceHistory({
  ws,
  cardId,
  month,
}: {
  ws: string;
  cardId: string;
  month: string;
}) {
  const list = useCardData<InvoiceRecord[]>(
    `/credit-cards/${cardId}/invoices${month ? '?month=' + month : ''}`,
    ws,
  );
  return list.error ? (
    <ErrorState message={list.error} retry={list.reload} />
  ) : !list.data ? (
    <LoadingState />
  ) : !list.data.length ? (
    <Card>
      <EmptyState
        title="Nenhuma fatura neste período."
        description="As faturas são criadas automaticamente ao registrar compras."
      />
    </Card>
  ) : (
    <nav aria-label="Histórico de faturas" className="invoice-history">
      {list.data.map((i) => (
        <Link key={i.id} to={`/app/credit-cards/${cardId}/invoices/${i.id}`}>
          <strong>{monthLabel(i.referenceMonth.slice(0, 7))}</strong>
          <span>
            {invoiceLabels[i.status]} · {formatMoney(i.total)}
          </span>
          <small>Vence {formatDate(i.dueDate)}</small>
        </Link>
      ))}
    </nav>
  );
}
function InvoiceContent({
  ws,
  cardId,
  invoiceId,
  writable,
  onPaid,
}: {
  ws: string;
  cardId: string;
  invoiceId: string;
  writable: boolean;
  onPaid: () => void;
}) {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<TransactionRecord | null>(
    null,
  );
  const detail = useCardData<InvoiceDetail>(
    `/credit-cards/${cardId}/invoices/${invoiceId}`,
    ws,
  );
  const [pay, setPay] = useState(false),
    [target, setTarget] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        `/credit-cards/${cardId}/purchases/${target}`,
        ws,
        undefined,
        { method: 'DELETE' },
      );
      setTarget(null);
      setSuccess('Compra cancelada. O limite foi liberado.');
      detail.reload();
      onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cancelar.');
    } finally {
      setBusy(false);
    }
  }
  const invoice = detail.data;
  return detail.error ? (
    <ErrorState message={detail.error} retry={detail.reload} />
  ) : !invoice ? (
    <LoadingState />
  ) : (
    <>
      <Card className="invoice-detail">
        <div className="transaction-heading">
          <h2>Fatura {monthLabel(invoice.referenceMonth.slice(0, 7))}</h2>
          <span className={'badge status-' + invoice.status}>
            {invoiceLabels[invoice.status]}
          </span>
        </div>
        <p>
          Vencimento: {formatDate(invoice.dueDate)} · Virada:{' '}
          {formatDate(invoice.closingDate)}
        </p>
        <div className="invoice-total">
          <span>Total da fatura</span>
          <strong>{formatMoney(invoice.total)}</strong>
          <small>
            {invoice.purchaseCount}{' '}
            {invoice.purchaseCount === 1 ? 'compra válida' : 'compras válidas'}
          </small>
        </div>
        {invoice.status === 'PAID' ? (
          <p role="status">
            Paga usando {invoice.paymentAccount?.name ?? 'conta registrada'} ·{' '}
            {formatMoney(invoice.paidAmount ?? invoice.total)}. Reabertura não
            disponível nesta etapa.
          </p>
        ) : (
          writable &&
          invoice.total !== '0.00' && (
            <Button onClick={() => setPay(true)}>Pagar fatura</Button>
          )
        )}
      </Card>
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <div className="transactions-list">
        {invoice.purchases.map((p) => (
          <Card
            key={p.id}
            className={p.status === 'CANCELLED' ? 'muted-card' : ''}
          >
            <div className="transaction-heading">
              <h3>{p.description}</h3>
              <span>
                {p.status === 'CANCELLED'
                  ? 'Cancelada'
                  : p.status === 'PAID'
                    ? 'Paga'
                    : 'Pendente'}
              </span>
            </div>
            <p>
              {formatDate(p.transactionDate)} ·{' '}
              {p.category?.name ?? 'Sem categoria'}
            </p>
            <strong>{formatMoney(p.amount ?? '0.00')}</strong>
            {p.installmentGroupId && (
              <p>
                <Link to={`/app/installment-groups/${p.installmentGroupId}`}>
                  Ver parcelamento
                </Link>
              </p>
            )}
            {writable && (
              <div className="invoice-row-actions">
                <details className="row-menu">
                  <summary aria-label={`Ações de ${p.description}`}>⋮</summary>
                  <div>
                    {invoice.status === 'PAID' ? (
                      <p className="form-note">
                        Esta compra pertence a uma fatura já paga e não pode ser
                        excluída diretamente.
                      </p>
                    ) : (
                      <>
                        {p.status !== 'CANCELLED' && !p.installmentGroupId && (
                          <Button
                            variant="quiet"
                            onClick={() => {
                              setError('');
                              setTarget(p.id);
                            }}
                          >
                            Cancelar compra
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          onClick={() =>
                            setDeleteTarget({
                              ...p,
                              creditCardId: cardId,
                              invoiceId,
                            })
                          }
                        >
                          Excluir definitivamente
                        </Button>
                      </>
                    )}
                  </div>
                </details>
              </div>
            )}
          </Card>
        ))}
      </div>
      {deleteTarget && (
        <PermanentDeletionDialog
          key={deleteTarget.id}
          row={deleteTarget}
          workspaceId={ws}
          close={() => setDeleteTarget(null)}
          saved={(result) => {
            setDeleteTarget(null);
            if (result.deletedInvoiceIds.includes(invoiceId))
              navigate(`/app/credit-cards/${cardId}/invoices`, {
                replace: true,
              });
            else {
              setSuccess(
                'Lançamento excluído definitivamente. Faturas e limite atualizados.',
              );
              detail.reload();
              onPaid();
            }
          }}
        />
      )}
      {pay && (
        <PayInvoiceForm
          ws={ws}
          invoice={invoice}
          close={() => setPay(false)}
          saved={() => {
            setPay(false);
            setSuccess('Fatura paga com sucesso.');
            detail.reload();
            onPaid();
          }}
        />
      )}
      {target && (
        <Dialog
          title="Cancelar compra?"
          onClose={() => setTarget(null)}
          busy={busy}
        >
          <p>
            A compra sairá do total da fatura e liberará o limite. O histórico
            será preservado.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button
              variant="secondary"
              onClick={() => setTarget(null)}
              disabled={busy}
            >
              Voltar
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Confirmar cancelamento
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
