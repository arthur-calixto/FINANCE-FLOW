import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AccountRecord,
  CategoryRecord,
  DashboardResponse,
  CategoryType,
} from '@finance-flow/types';
import { dashboardQuerySchema } from '@finance-flow/validation';
import { useAuth } from './auth';
import { apiRequest } from './api';
import { Button, Card, ErrorState, FormField, Input, LoadingState } from './ui';
import { brazilToday, formatDate, monthLabel, shiftMonth } from './dates';
import { formatMoney } from './money';
import { TransactionDialog } from './resources/Transactions';
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Não foi possível carregar o dashboard.';
const origins = {
  CREDIT_CARD: 'Cartão',
  RECURRING: 'Recorrente',
  INSTALLMENT: 'Parcelamento',
  SINGLE: 'Avulso',
};
const accountTypes = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CASH: 'Dinheiro',
  INVESTMENT: 'Investimento',
  OTHER: 'Outra',
};
function Amount({ value }: { value: string }) {
  return (
    <span className={value.startsWith('-') ? 'dashboard-negative' : ''}>
      {formatMoney(value)}
    </span>
  );
}
function Metric({
  label,
  value,
  main = false,
}: {
  label: string;
  value: string;
  main?: boolean;
}) {
  return (
    <div className={`dashboard-metric ${main ? 'dashboard-metric-main' : ''}`}>
      <dt>{label}</dt>
      <dd>
        <Amount value={value} />
      </dd>
    </div>
  );
}
function Bar({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: string;
}) {
  return (
    <div className="dashboard-bar-item">
      <div>
        <strong>{label}</strong>
        <span>
          <Amount value={value} /> <small>· {percent.replace('.', ',')}%</small>
        </span>
      </div>
      <div className="dashboard-bar" aria-hidden="true">
        <span
          style={{ width: `${Math.min(100, Math.max(0, Number(percent)))}%` }}
        />
      </div>
    </div>
  );
}
function Evolution({ rows }: { rows: DashboardResponse['evolution'] }) {
  const [mode, setMode] = useState<'planned' | 'actual'>('planned');
  const series = [
    { key: 'income', label: 'Receitas' },
    { key: 'expense', label: 'Despesas' },
    { key: 'result', label: 'Resultado' },
  ] as const;
  // Number somente na geometria SVG. Valores financeiros vêm prontos da API e são formatados como strings.
  const max = Math.max(
    1,
    ...rows.flatMap((r) => series.map((s) => Math.abs(Number(r[s.key][mode])))),
  );
  const baseline = rows.some((r) =>
    series.some((s) => Number(r[s.key][mode]) < 0),
  )
    ? 135
    : 225;
  const hasValues = rows.some((r) =>
    series.some((s) => Number(r[s.key][mode]) !== 0),
  );
  return (
    <Card className="dashboard-evolution">
      <div className="dashboard-section-heading">
        <div>
          <span className="eyebrow">Seis competências</span>
          <h2>Evolução financeira</h2>
        </div>
        <div
          className="dashboard-toggle"
          role="group"
          aria-label="Modo da evolução"
        >
          <Button
            variant={mode === 'planned' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'planned'}
            onClick={() => setMode('planned')}
          >
            Previsto
          </Button>
          <Button
            variant={mode === 'actual' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'actual'}
            onClick={() => setMode('actual')}
          >
            Realizado
          </Button>
        </div>
      </div>
      <div className="dashboard-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i className={`series-${s.key}`} />
            {s.label}
          </span>
        ))}
      </div>
      {!hasValues ? (
        <p className="dashboard-empty">
          Nenhuma movimentação neste período para o modo selecionado.
        </p>
      ) : (
        <figure className="dashboard-chart">
          <svg
            viewBox="0 0 660 260"
            role="img"
            aria-label={`Evolução de receitas, despesas e resultado ${mode === 'planned' ? 'previstos' : 'realizados'} em seis meses`}
          >
            <line
              x1="15"
              x2="645"
              y1={baseline}
              y2={baseline}
              className="dashboard-axis"
            />
            <text x="15" y={baseline - 7} className="dashboard-axis-label">
              0
            </text>
            {rows.map((r, i) => (
              <g key={r.month}>
                {series.map((s, j) => {
                  const value = Number(r[s.key][mode]);
                  const height = (Math.abs(value) / max) * (baseline - 25);
                  return (
                    <rect
                      key={s.key}
                      className={`series-${s.key}`}
                      x={42 + i * 102 + j * 22}
                      y={value >= 0 ? baseline - height : baseline}
                      width="16"
                      height={height}
                      rx="3"
                    >
                      <title>
                        {monthLabel(r.month)} · {s.label}:{' '}
                        {formatMoney(r[s.key][mode])}
                      </title>
                    </rect>
                  );
                })}
                <text
                  x={72 + i * 102}
                  y="258"
                  textAnchor="middle"
                  className="dashboard-axis-label"
                >
                  {r.month.slice(5)}/{r.month.slice(2, 4)}
                </text>
              </g>
            ))}
          </svg>
          <figcaption>
            Valores completos abaixo. Barras abaixo de zero indicam resultado
            negativo.
          </figcaption>
        </figure>
      )}
      <div className="dashboard-evolution-values">
        {rows.map((r) => (
          <div key={r.month}>
            <h3>{monthLabel(r.month)}</h3>
            <dl>
              {series.map((s) => (
                <Metric key={s.key} label={s.label} value={r[s.key][mode]} />
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
export function Dashboard() {
  const { activeWorkspaceId } = useAuth();
  return activeWorkspaceId ? (
    <DashboardContent key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
  ) : null;
}
function DashboardContent({ workspaceId }: { workspaceId: string }) {
  const auth = useAuth();
  const currentMonth = brazilToday().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{
    type: CategoryType;
    accounts: AccountRecord[];
    categories: CategoryRecord[];
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const writable =
    auth.me?.workspaces.find((w) => w.id === workspaceId)?.role !== 'VIEWER';
  useEffect(() => {
    const controller = new AbortController();
    apiRequest(`/dashboard?month=${month}`, workspaceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result as DashboardResponse);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [workspaceId, month, revision]);
  function refresh() {
    setData(null);
    setError('');
    setRevision((n) => n + 1);
  }
  function select(value: string) {
    if (value === month) return;
    if (!dashboardQuerySchema.safeParse({ month: value }).success) return;
    setError('');
    setData(null);
    setSuccess('');
    setMonth(value);
  }
  async function open(type: CategoryType) {
    setOpening(true);
    setActionError('');
    try {
      const [accounts, categories] = await Promise.all([
        apiRequest('/accounts', workspaceId),
        apiRequest('/categories', workspaceId),
      ]);
      setEditor({
        type,
        accounts: accounts as AccountRecord[],
        categories: categories as CategoryRecord[],
      });
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  const transactionsLink = `/app/transactions?month=${month}`;
  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Seu dinheiro, com mais clareza</span>
          <h1>Dashboard</h1>
          <p>
            Olá, {auth.me?.user.name.split(' ')[0]}. Acompanhe suas finanças por
            competência.
          </p>
        </div>
        {writable && (
          <div className="dashboard-actions">
            <Button
              variant="secondary"
              disabled={opening}
              onClick={() => void open('INCOME')}
            >
              ＋ Nova receita
            </Button>
            <Button disabled={opening} onClick={() => void open('EXPENSE')}>
              ＋ Nova despesa
            </Button>
          </div>
        )}
      </div>
      <div className="dashboard-month">
        <Button
          variant="quiet"
          aria-label="Mês anterior"
          disabled={month === '0001-06'}
          onClick={() => select(shiftMonth(month, -1))}
        >
          ←
        </Button>
        <FormField label="Competência">
          <Input
            type="month"
            min="0001-06"
            max="9999-12"
            value={month}
            onChange={(e) => select(e.target.value)}
          />
        </FormField>
        <Button
          variant="quiet"
          aria-label="Próximo mês"
          disabled={month === '9999-12'}
          onClick={() => select(shiftMonth(month, 1))}
        >
          →
        </Button>
        <strong>{monthLabel(month)}</strong>
        <Button
          variant="secondary"
          disabled={month === currentMonth}
          onClick={() => select(currentMonth)}
        >
          Mês atual
        </Button>
      </div>
      {success && <p role="status">{success}</p>}
      {actionError && <ErrorState message={actionError} />}
      {error ? (
        <ErrorState message={error} retry={refresh} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          {!data.hasActivity && (
            <Card className="dashboard-onboarding">
              <h2>Seu dashboard começa aqui</h2>
              <p>
                Cadastre uma conta e uma categoria e registre seu primeiro
                lançamento. Seu workspace ainda não tem movimentações válidas.
              </p>
              <Link to="/app/accounts">Organizar contas</Link> ·{' '}
              <Link to="/app/categories">Organizar categorias</Link>
            </Card>
          )}
          {data.hasActivity && data.transactionCount === 0 && (
            <p className="dashboard-empty">
              Nenhuma movimentação nesta competência. Seus saldos e limites
              atuais continuam disponíveis.
            </p>
          )}
          <div className="dashboard-summary">
            <Card className="dashboard-income">
              <span className="eyebrow">Entradas do mês</span>
              <h2>Receitas</h2>
              <dl>
                <Metric
                  label="Previsto"
                  value={data.summary.income.planned}
                  main
                />
                <Metric label="Realizado" value={data.summary.income.actual} />
                <Metric label="A receber" value={data.summary.income.pending} />
              </dl>
            </Card>
            <Card className="dashboard-expense">
              <span className="eyebrow">Saídas do mês</span>
              <h2>Despesas</h2>
              <dl>
                <Metric
                  label="Previsto"
                  value={data.summary.expense.planned}
                  main
                />
                <Metric label="Realizado" value={data.summary.expense.actual} />
                <Metric label="A pagar" value={data.summary.expense.pending} />
              </dl>
            </Card>
            <Card className="dashboard-result">
              <span className="eyebrow">Receitas menos despesas</span>
              <h2>Resultado</h2>
              <dl>
                <Metric
                  label="Resultado previsto"
                  value={data.summary.result.planned}
                  main
                />
                <Metric
                  label="Resultado realizado"
                  value={data.summary.result.actual}
                />
              </dl>
              <p>Resultado da competência, não o saldo em conta.</p>
            </Card>
            <Card className="dashboard-pending">
              <span className="eyebrow">Ainda não realizados</span>
              <h2>Pendências</h2>
              <dl>
                <Metric
                  label="Saldo das pendências"
                  value={data.summary.result.pending}
                  main
                />
                <Metric label="A receber" value={data.summary.income.pending} />
                <Metric label="A pagar" value={data.summary.expense.pending} />
              </dl>
            </Card>
          </div>
          <Card className="dashboard-upcoming">
            <div className="dashboard-section-heading">
              <div>
                <span className="eyebrow">
                  Pendentes na competência · inclui atrasados
                </span>
                <h2>Próximos vencimentos</h2>
              </div>
              <Link to={transactionsLink}>Ver lançamentos →</Link>
            </div>
            {data.upcoming.length === 0 ? (
              <p className="dashboard-empty">
                Nenhum vencimento pendente nesta competência.
              </p>
            ) : (
              <ul className="dashboard-list">
                {data.upcoming.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.description}</strong>
                      <p>
                        {item.type === 'INCOME' ? 'Receita' : 'Despesa'} ·{' '}
                        {origins[item.origin]}
                      </p>
                    </div>
                    <div className="dashboard-due">
                      <span>{formatDate(item.dueDate)}</span>
                      <small
                        className={
                          item.status === 'OVERDUE' ? 'dashboard-negative' : ''
                        }
                      >
                        {item.status === 'OVERDUE' ? 'Atrasado' : 'Pendente'}
                      </small>
                    </div>
                    <strong>
                      <Amount value={item.amount} />
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            <small>
              Até 10 itens, por vencimento. Compras de cartão aparecem
              individualmente.
            </small>
          </Card>
          <div className="dashboard-current">
            <Card>
              <div className="dashboard-section-heading">
                <div>
                  <span className="eyebrow">
                    Saldo atual · todas as competências
                  </span>
                  <h2>Contas</h2>
                </div>
                <Link to="/app/accounts">Ver contas →</Link>
              </div>
              <dl>
                <Metric
                  label="Saldo total em contas"
                  value={data.accounts.totalBalance}
                  main
                />
              </dl>
              {!data.accounts.items.length ? (
                <p className="dashboard-empty">
                  Nenhuma conta ativa.{' '}
                  <Link to="/app/accounts">Cadastre sua primeira conta.</Link>
                </p>
              ) : (
                <ul className="dashboard-list">
                  {data.accounts.items.map((a) => (
                    <li key={a.id}>
                      <div>
                        <strong>{a.name}</strong>
                        <p>{accountTypes[a.type]}</p>
                        <small>
                          Saldo inicial: {formatMoney(a.initialBalance)}
                        </small>
                      </div>
                      <strong>
                        <Amount value={a.balance} />
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="dashboard-section-heading">
                <div>
                  <span className="eyebrow">
                    Utilização atual · todas as competências
                  </span>
                  <h2>Cartões</h2>
                </div>
                <Link to="/app/credit-cards">Ver cartões →</Link>
              </div>
              {!data.creditCards.length ? (
                <p className="dashboard-empty">
                  Nenhum cartão ativo.{' '}
                  <Link to="/app/credit-cards">Cadastre um cartão.</Link>
                </p>
              ) : (
                <ul className="dashboard-card-list">
                  {data.creditCards.map((c) => (
                    <li key={c.id}>
                      <Bar
                        label={c.name}
                        value={c.usedLimit}
                        percent={c.usagePercentage}
                      />
                      <dl>
                        <Metric label="Limite total" value={c.creditLimit} />
                        <Metric label="Disponível" value={c.availableLimit} />
                      </dl>
                      <p>
                        {c.currentInvoice ? (
                          <>
                            Próxima fatura em aberto:{' '}
                            <strong>
                              {formatMoney(c.currentInvoice.total)}
                            </strong>{' '}
                            · {formatDate(c.currentInvoice.dueDate)}
                          </>
                        ) : (
                          'Nenhuma fatura em aberto.'
                        )}
                      </p>
                      <Link
                        to={`/app/credit-cards/${c.id}/invoices${c.currentInvoice ? '/' + c.currentInvoice.id : ''}`}
                      >
                        Ver cartão →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <small>Limite de cartão não é saldo disponível em conta.</small>
            </Card>
          </div>
          <div className="dashboard-analysis">
            <Card>
              <span className="eyebrow">Previsto na competência</span>
              <h2>Despesas por categoria</h2>
              {!data.expensesByCategory.length ? (
                <p className="dashboard-empty">
                  Nenhuma despesa prevista registrada neste mês.
                </p>
              ) : (
                data.expensesByCategory.map((c) => (
                  <Bar
                    key={c.id ?? 'uncategorized'}
                    label={c.name}
                    value={c.amount}
                    percent={c.percentage}
                  />
                ))
              )}
            </Card>
            <Card>
              <span className="eyebrow">Previsto na competência</span>
              <h2>Composição das despesas</h2>
              {data.expenseComposition.total === '0.00' ? (
                <p className="dashboard-empty">
                  Nenhuma despesa prevista registrada neste mês.
                </p>
              ) : (
                <>
                  {(
                    [
                      ['recurring', 'Fixas / recorrentes'],
                      ['creditCards', 'Cartões de crédito'],
                      ['other', 'Outras despesas'],
                    ] as const
                  ).map(([key, label]) => (
                    <Bar
                      key={key}
                      label={label}
                      value={data.expenseComposition[key]}
                      percent={data.expenseComposition.percentages[key]}
                    />
                  ))}
                  <dl>
                    <Metric
                      label="Total previsto"
                      value={data.expenseComposition.total}
                    />
                  </dl>
                </>
              )}
              <p>
                Compras entram uma vez. Pagar a fatura não gera uma segunda
                despesa.
              </p>
            </Card>
          </div>
          <Evolution rows={data.evolution} />
        </>
      )}
      {editor && (
        <TransactionDialog
          workspaceId={workspaceId}
          editor={{ kind: 'edit', type: editor.type }}
          accounts={editor.accounts}
          categories={editor.categories}
          defaultDate={month === currentMonth ? brazilToday() : month + '-01'}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setSuccess('Lançamento criado. Dashboard atualizado.');
            refresh();
          }}
        />
      )}
    </div>
  );
}
