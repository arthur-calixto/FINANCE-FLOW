import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  CategoryRecord,
  CreditCardRecord,
  InvoicePreview,
} from '@finance-flow/types';
import {
  createCreditCardSchema,
  createPurchaseSchema,
  civilDateSchema,
} from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import { formatMoney, parseMoneyInput } from '../money';
import { brazilToday, formatDate, monthLabel } from '../dates';
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
import { useResources } from './use-resources';
import { useCardData } from './use-card-data';
export const invoiceLabels = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
  OVERDUE: 'Atrasada',
};
function CardForm({
  record,
  ws,
  close,
  saved,
}: {
  record?: CreditCardRecord;
  ws: string;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const body = createCreditCardSchema.parse({
        name: v.name,
        creditLimit: parseMoneyInput(String(v.creditLimit)),
        closingDay: Number(v.closingDay),
        dueDay: Number(v.dueDay),
      });
      await apiRequest(
        '/credit-cards' + (record ? '/' + record.id : ''),
        ws,
        undefined,
        { method: record ? 'PATCH' : 'POST', body },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira nome, limite e dias de 1 a 31.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={record ? 'Editar cartão' : 'Novo cartão'}
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
              autoFocus
            />
          </FormField>
          <FormField label="Limite (R$)">
            <Input
              name="creditLimit"
              required
              inputMode="decimal"
              defaultValue={record?.creditLimit.replace('.', ',')}
            />
          </FormField>
          <FormField
            label="Dia da virada da fatura"
            hint="A partir deste dia, novas compras entram na próxima fatura."
          >
            <Input
              name="closingDay"
              type="number"
              min={1}
              max={31}
              required
              defaultValue={record?.closingDay ?? 25}
            />
          </FormField>
          <FormField label="Dia do vencimento">
            <Input
              name="dueDay"
              type="number"
              min={1}
              max={31}
              required
              defaultValue={record?.dueDay ?? 10}
            />
          </FormField>
          {record && (
            <p className="form-note">
              Se já houver faturas, os dias de virada e vencimento são
              preservados para proteger o histórico.
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
          <Button disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar cartão'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function PurchaseForm({
  cards,
  initialCard,
  ws,
  close,
  saved,
}: {
  cards: CreditCardRecord[];
  initialCard: string;
  ws: string;
  close: () => void;
  saved: () => void;
}) {
  const [cardId, setCard] = useState(initialCard),
    [day, setDay] = useState(brazilToday()),
    [preview, setPreview] = useState<InvoicePreview | null>(null),
    [previewError, setPreviewError] = useState('');
  const categories = useCardData<CategoryRecord[]>('/categories', ws);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (civilDateSchema.safeParse(day).success)
      apiRequest(
        `/credit-cards/${cardId}/purchase-preview?transactionDate=${day}`,
        ws,
        controller.signal,
      )
        .then((p) => {
          if (!controller.signal.aborted) setPreview(p as InvoicePreview);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setPreviewError(
              e instanceof Error
                ? e.message
                : 'Não foi possível prever a fatura.',
            );
        });
    return () => controller.abort();
  }, [day, cardId, ws]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const body = createPurchaseSchema.parse({
        description: v.description,
        amount: parseMoneyInput(String(v.amount)),
        transactionDate: day,
        categoryId: v.categoryId,
        notes: v.notes || null,
      });
      await apiRequest(`/credit-cards/${cardId}/purchases`, ws, undefined, {
        method: 'POST',
        body,
      });
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira os campos e informe um valor positivo.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Nova compra" onClose={close} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <FormField label="Cartão">
            <Select
              aria-label="Cartão"
              value={cardId}
              onChange={(e) => {
                setPreview(null);
                setPreviewError('');
                setCard(e.target.value);
              }}
            >
              {cards
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Descrição">
            <Input name="description" required maxLength={500} autoFocus />
          </FormField>
          <FormField label="Valor (R$)">
            <Input name="amount" required inputMode="decimal" />
          </FormField>
          <FormField label="Data da compra">
            <Input
              type="date"
              required
              value={day}
              onChange={(e) => {
                setPreview(null);
                setPreviewError('');
                setDay(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Categoria">
            <Select
              aria-label="Categoria"
              name="categoryId"
              required
              defaultValue=""
            >
              <option value="">Selecione uma despesa</option>
              {categories.data
                ?.filter((c) => c.isActive && c.type === 'EXPENSE')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Observações">
            <textarea name="notes" className="input" maxLength={5000} />
          </FormField>
        </fieldset>
        {preview ? (
          <p className="success" role="status">
            Esta compra entrará na fatura de{' '}
            {monthLabel(preview.referenceMonth.slice(0, 7))}. Vencimento:{' '}
            {formatDate(preview.dueDate)}.
          </p>
        ) : previewError ? (
          <ErrorState message={previewError} />
        ) : (
          <p role="status">
            Selecione uma data válida para consultar a fatura.
          </p>
        )}
        {categories.error && (
          <ErrorState message={categories.error} retry={categories.reload} />
        )}
        <p className="form-note">
          Compra à vista no cartão, sem saída imediata da conta bancária.
        </p>
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
          <Button disabled={busy || !preview || !categories.data}>
            {busy ? 'Salvando…' : 'Salvar compra'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function CreditCards() {
  const { activeWorkspaceId } = useAuth();
  return activeWorkspaceId ? (
    <CardsContent key={activeWorkspaceId} ws={activeWorkspaceId} />
  ) : null;
}
function CardsContent({ ws }: { ws: string }) {
  const { me } = useAuth(),
    list = useResources<CreditCardRecord>('/credit-cards', ws);
  const writable = me?.workspaces.find((w) => w.id === ws)?.role !== 'VIEWER';
  const [inactive, setInactive] = useState(false),
    [editor, setEditor] = useState<CreditCardRecord | 'new' | null>(null),
    [purchase, setPurchase] = useState<string | null>(null),
    [target, setTarget] = useState<CreditCardRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function toggle(card: CreditCardRecord) {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/credit-cards/' + card.id, ws, undefined, {
        method: card.isActive ? 'DELETE' : 'PATCH',
        ...(!card.isActive ? { body: { isActive: true } } : {}),
      });
      setTarget(null);
      setSuccess(card.isActive ? 'Cartão desativado.' : 'Cartão reativado.');
      list.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível alterar o cartão.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Compras e compromissos</span>
          <h1>Cartões</h1>
          <p>
            Acompanhe limites e faturas, sem perder de vista o próximo
            vencimento.
          </p>
        </div>
        {writable && (
          <Button onClick={() => setEditor('new')}>＋ Novo cartão</Button>
        )}
      </div>
      <div className="list-toolbar">
        <p>
          Fatura atual é a obrigação não paga com vencimento mais próximo,
          priorizando atrasadas.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Mostrar inativos
        </label>
      </div>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      {error && !target && <ErrorState message={error} />}{' '}
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} retry={list.reload} />
      ) : !list.rows.filter((c) => inactive || c.isActive).length ? (
        <Card>
          <EmptyState
            title="Nenhum cartão cadastrado."
            description="Cadastre seu cartão para organizar compras e faturas. Cartões inativos aparecem pelo filtro acima."
          />
        </Card>
      ) : (
        <div className="accounts-grid">
          {list.rows
            .filter((c) => inactive || c.isActive)
            .map((c) => (
              <Card key={c.id} className={c.isActive ? '' : 'muted-card'}>
                <div className="account-heading">
                  <span className="account-symbol" aria-hidden="true">
                    ▤
                  </span>
                  <span className="badge">
                    {c.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <h2>{c.name}</h2>
                <dl className="card-limits">
                  <div>
                    <dt>Limite</dt>
                    <dd>{formatMoney(c.creditLimit)}</dd>
                  </div>
                  <div>
                    <dt>Utilizado</dt>
                    <dd>{formatMoney(c.usedLimit)}</dd>
                  </div>
                  <div>
                    <dt>Disponível</dt>
                    <dd>{formatMoney(c.availableLimit)}</dd>
                  </div>
                </dl>
                <p>
                  Virada: dia {c.closingDay} · Vencimento: dia {c.dueDay}
                </p>
                {c.currentInvoice ? (
                  <div className="current-invoice">
                    <span>
                      Fatura atual · {invoiceLabels[c.currentInvoice.status]}
                    </span>
                    <h3>
                      {monthLabel(c.currentInvoice.referenceMonth.slice(0, 7))}
                    </h3>
                    <strong>{formatMoney(c.currentInvoice.total)}</strong>
                    <p>Vence {formatDate(c.currentInvoice.dueDate)}</p>
                    <Link
                      to={`/app/credit-cards/${c.id}/invoices/${c.currentInvoice.id}`}
                    >
                      Ver fatura
                    </Link>
                  </div>
                ) : (
                  <p>Nenhuma fatura a pagar.</p>
                )}
                <div className="card-actions">
                  <Link
                    className="button button-quiet"
                    to={`/app/credit-cards/${c.id}/invoices`}
                  >
                    Histórico de faturas
                  </Link>
                  {writable && (
                    <>
                      <Button variant="quiet" onClick={() => setEditor(c)}>
                        Editar
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => {
                          if (c.isActive) {
                            setError('');
                            setTarget(c);
                          } else void toggle(c);
                        }}
                      >
                        {c.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                      {c.isActive && (
                        <Button onClick={() => setPurchase(c.id)}>
                          Nova compra
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            ))}
        </div>
      )}
      {editor && (
        <CardForm
          record={editor === 'new' ? undefined : editor}
          ws={ws}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setSuccess('Cartão salvo com sucesso.');
            list.reload();
          }}
        />
      )}
      {purchase && (
        <PurchaseForm
          cards={list.rows}
          initialCard={purchase}
          ws={ws}
          close={() => setPurchase(null)}
          saved={() => {
            setPurchase(null);
            setSuccess('Compra registrada na fatura.');
            list.reload();
          }}
        />
      )}
      {target && (
        <Dialog
          title={`Desativar ${target.name}?`}
          onClose={() => setTarget(null)}
          busy={busy}
        >
          <p>
            Compras novas serão bloqueadas. Faturas e pagamentos existentes
            continuam disponíveis.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              Voltar
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void toggle(target)}
            >
              Desativar cartão
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
