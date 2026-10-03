import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { transactionGroupKey } from '@finance-flow/types';
import type {
  TransactionMonthView,
  TransactionRecord,
  TransactionTotals,
} from '@finance-flow/types';
import { Button } from '../ui';
import { formatDate, monthLabel } from '../dates';
import { formatMoney, moneyDifference } from '../money';
import type { Editor } from './Transactions';
const zero = { expected: '0.00', realized: '0.00' };
const statusLabels = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELLED: 'Cancelado',
};
function Group({
  title,
  total = zero,
  children,
  className = '',
}: {
  title: string;
  total?: TransactionTotals;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={'transaction-group ' + className} open>
      <summary>
        <span>{title}</span>
        <span className="group-total">
          {formatMoney(total.expected)}
          <small>Realizado {formatMoney(total.realized)}</small>
        </span>
      </summary>
      <div className="group-content">{children}</div>
    </details>
  );
}
export function TransactionTables({
  view,
  writable,
  edit,
}: {
  view: TransactionMonthView;
  writable: boolean;
  edit: (editor: Editor) => void;
}) {
  const grouped = new Map<string, TransactionRecord[]>();
  for (const row of view.rows) {
    const key = transactionGroupKey(row),
      group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  function table(rows: TransactionRecord[], card = false) {
    if (!rows.length)
      return <p className="group-empty">Nenhum lançamento neste grupo.</p>;
    const sorted = [...rows].sort((a, b) => {
      const date = card ? 'transactionDate' : 'dueDate';
      return (
        a[date].localeCompare(b[date]) ||
        a.description.localeCompare(b.description, 'pt-BR') ||
        a.id.localeCompare(b.id)
      );
    });
    return (
      <table className="transaction-table">
        <thead>
          <tr>
            {[
              'Descrição',
              'Categoria',
              card ? 'Data' : 'Vencimento',
              card ? 'Parcela' : 'Previsto',
              card ? 'Valor' : rows[0].type === 'INCOME' ? 'Recebido' : 'Pago',
              'Status',
              'Ações',
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pending =
              row.status === 'PENDING' || row.status === 'OVERDUE';
            return (
              <tr
                key={row.id}
                className={row.status === 'CANCELLED' ? 'muted-card' : ''}
              >
                <td data-label="Descrição" className="transaction-description">
                  <h4>{row.description}</h4>
                  {!card && <small>{row.account?.name ?? 'Sem conta'}</small>}
                  {row.recurrenceId && (
                    <Link to={`/app/recurrences/${row.recurrenceId}`}>
                      Recorrente · Ver recorrência
                    </Link>
                  )}
                  {row.installmentGroupId && (
                    <Link
                      to={`/app/installment-groups/${row.installmentGroupId}`}
                    >
                      Ver parcelamento {row.installmentNumber}/
                      {row.installmentGroup?.installmentCount}
                    </Link>
                  )}
                </td>
                <td data-label="Categoria">
                  {row.category?.name ?? 'Sem categoria'}
                </td>
                <td data-label={card ? 'Data' : 'Vencimento'}>
                  <time dateTime={card ? row.transactionDate : row.dueDate}>
                    {formatDate(card ? row.transactionDate : row.dueDate)}
                  </time>
                </td>
                <td data-label={card ? 'Parcela' : 'Previsto'}>
                  {card
                    ? row.installmentGroup
                      ? `${row.installmentNumber}/${row.installmentGroup.installmentCount}`
                      : '—'
                    : row.expectedAmount
                      ? formatMoney(row.expectedAmount)
                      : 'Não informado'}
                </td>
                <td
                  data-label={
                    card ? 'Valor' : row.type === 'INCOME' ? 'Recebido' : 'Pago'
                  }
                  className="transaction-value"
                >
                  {row.amount ? formatMoney(row.amount) : '—'}
                  {!card && row.status !== 'PAID' && row.amount && (
                    <small>Valor conhecido, ainda não realizado</small>
                  )}
                  {row.amount &&
                    row.expectedAmount &&
                    row.amount !== row.expectedAmount && (
                      <small>
                        <span>Diferença</span>{' '}
                        <strong>
                          {formatMoney(
                            moneyDifference(row.amount, row.expectedAmount),
                          )}
                        </strong>
                      </small>
                    )}
                </td>
                <td data-label="Status">
                  <span className={'badge status-' + row.status}>
                    {row.status === 'PAID' && row.type === 'INCOME'
                      ? 'Recebido'
                      : statusLabels[row.status]}
                  </span>
                </td>
                <td data-label="Ações">
                  <div className="row-actions">
                    {writable && !card && pending && (
                      <Button onClick={() => edit({ kind: 'pay', row })}>
                        {row.type === 'INCOME' ? 'Receber' : 'Pagar'}
                      </Button>
                    )}
                    {writable && (
                      <details className="row-menu">
                        <summary aria-label={`Ações de ${row.description}`}>
                          ⋮
                        </summary>
                        <div>
                          {!card && pending && !row.installmentGroupId && (
                            <Button
                              variant="quiet"
                              onClick={() =>
                                edit({ kind: 'edit', row, type: row.type })
                              }
                            >
                              Editar
                            </Button>
                          )}
                          {!card && row.status === 'PAID' && (
                            <Button
                              variant="quiet"
                              onClick={() => edit({ kind: 'reopen', row })}
                            >
                              Reabrir
                            </Button>
                          )}
                          {!card && pending && (
                            <Button
                              variant="quiet"
                              onClick={() => edit({ kind: 'cancel', row })}
                            >
                              {row.installmentGroupId
                                ? 'Cancelar parcela'
                                : 'Cancelar lançamento'}
                            </Button>
                          )}
                          {card && row.invoiceId && (
                            <Link
                              to={`/app/credit-cards/${row.creditCardId}/invoices/${row.invoiceId}`}
                            >
                              Ver fatura / cancelamento
                            </Link>
                          )}
                          {row.permanentDeleteBlockedReason ? (
                            <p className="form-note">
                              {row.permanentDeleteBlockedReason}
                            </p>
                          ) : (
                            <Button
                              variant="danger"
                              onClick={() => edit({ kind: 'delete', row })}
                            >
                              Excluir definitivamente
                            </Button>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  function section(key: string, title: string) {
    return (
      <Group title={title} total={view.subtotals[key]}>
        {table(grouped.get(key) ?? [])}
      </Group>
    );
  }
  const cards = [...grouped]
    .filter(([key]) => key.startsWith('card:'))
    .sort((a, b) =>
      (a[1][0].creditCard?.name ?? '').localeCompare(
        b[1][0].creditCard?.name ?? '',
        'pt-BR',
      ),
    );
  return (
    <div className="transaction-sections">
      <Group
        title="RECEITAS"
        total={view.summary.income}
        className="income-section"
      >
        {section('incomeFixed', 'Fixas / recorrentes')}
        {section('incomeOther', 'Outras receitas')}
      </Group>
      <Group
        title="DESPESAS"
        total={view.summary.expense}
        className="expense-section"
      >
        {section('expenseFixed', 'Fixas / recorrentes')}
        <Group title="Cartões de crédito" total={view.subtotals.cards}>
          {!cards.length && (
            <p className="group-empty">Nenhuma compra de cartão neste mês.</p>
          )}
          {cards.map(([key, rows]) => (
            <Group
              key={key}
              title={rows[0].creditCard?.name ?? 'Cartão'}
              total={view.subtotals[key]}
            >
              {[
                ...new Map(
                  rows
                    .filter((r) => r.invoice)
                    .map((r) => [r.invoice!.id, r.invoice!]),
                ).values(),
              ].map((invoice) => (
                <p className="invoice-context" key={invoice.id}>
                  <Link
                    to={`/app/credit-cards/${rows[0].creditCardId}/invoices/${invoice.id}`}
                  >
                    Fatura {monthLabel(invoice.referenceMonth.slice(0, 7))}
                  </Link>
                  <span>
                    Vencimento {formatDate(invoice.dueDate ?? rows[0].dueDate)}
                  </span>
                  <span>{invoice.status === 'PAID' ? 'Paga' : 'Pendente'}</span>
                </p>
              ))}
              {table(rows, true)}
            </Group>
          ))}
        </Group>
        {section('expenseOther', 'Outras despesas')}
      </Group>
    </div>
  );
}
