import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AccountRecord,
  CategoryRecord,
  CreditCardRecord,
  CategoryType,
  InstallmentPlan,
} from '@finance-flow/types';
import {
  createInstallmentSchema,
  createCardInstallmentSchema,
  installmentPreviewSchema,
  cardInstallmentPreviewSchema,
} from '@finance-flow/validation';
import { apiRequest } from '../api';
import { brazilToday, formatDate, monthLabel } from '../dates';
import { parseMoneyInput, formatMoney } from '../money';
import { Button, Dialog, FormField, Input, Select } from '../ui';
export function InstallmentForm({
  ws,
  origin,
  initialType = 'EXPENSE',
  accounts = [],
  categories,
  cards = [],
  initialCard,
  close,
  saved,
  single,
}: {
  ws: string;
  origin: 'ACCOUNT' | 'CREDIT_CARD';
  initialType?: CategoryType;
  accounts?: AccountRecord[];
  categories: CategoryRecord[];
  cards?: CreditCardRecord[];
  initialCard?: string;
  close: () => void;
  saved: () => void;
  single: () => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    [type, setType] = useState<CategoryType>(initialType),
    [cardId, setCard] = useState(initialCard ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [plan, setPlan] = useState<InstallmentPlan | null>(null);
  const card = origin === 'CREDIT_CARD';
  function values() {
    const v = Object.fromEntries(new FormData(form.current!));
    return {
      description: v.description,
      type: card ? 'EXPENSE' : type,
      totalAmount: parseMoneyInput(String(v.totalAmount)),
      installmentCount: Number(v.installmentCount),
      transactionDate: v.transactionDate,
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
      const body = card
        ? cardInstallmentPreviewSchema.parse({
            totalAmount: v.totalAmount,
            installmentCount: v.installmentCount,
            transactionDate: v.transactionDate,
          })
        : installmentPreviewSchema.parse({
            totalAmount: v.totalAmount,
            installmentCount: v.installmentCount,
            firstDueDate: v.firstDueDate,
          });
      setPlan(
        (await apiRequest(
          card
            ? `/credit-cards/${cardId}/installments/preview`
            : '/installments/preview',
          ws,
          undefined,
          { method: 'POST', body },
        )) as InstallmentPlan,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Informe total positivo, 1 a 120 parcelas e datas válidas.',
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
      const v = values();
      const body = card
        ? createCardInstallmentSchema.parse({
            description: v.description,
            totalAmount: v.totalAmount,
            installmentCount: v.installmentCount,
            transactionDate: v.transactionDate,
            categoryId: v.categoryId,
            notes: v.notes,
          })
        : createInstallmentSchema.parse(v);
      await apiRequest(
        card ? `/credit-cards/${cardId}/installments` : '/installments',
        ws,
        undefined,
        { method: 'POST', body },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira os campos e os vínculos do parcelamento.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        card
          ? 'Compra parcelada'
          : type === 'INCOME'
            ? 'Receita parcelada'
            : 'Despesa parcelada'
      }
      onClose={close}
      busy={busy}
    >
      <form ref={form} onSubmit={submit} onChange={() => setPlan(null)}>
        <fieldset disabled={busy}>
          <FormField label="Pagamento">
            <Select
              aria-label="Pagamento"
              value="INSTALLMENTS"
              onChange={single}
            >
              <option value="SINGLE">À vista</option>
              <option value="INSTALLMENTS">Parcelado</option>
            </Select>
          </FormField>
          {card ? (
            <FormField label="Cartão">
              <Select
                aria-label="Cartão"
                value={cardId}
                onChange={(e) => setCard(e.target.value)}
              >
                {cards
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </FormField>
          ) : (
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
          )}
          <FormField label="Descrição">
            <Input name="description" required maxLength={500} autoFocus />
          </FormField>
          <div className="transaction-form-grid">
            <FormField label="Valor total (R$)">
              <Input name="totalAmount" required inputMode="decimal" />
            </FormField>
            <FormField label="Número de parcelas">
              <Input
                name="installmentCount"
                type="number"
                min={1}
                max={120}
                defaultValue={3}
                required
              />
            </FormField>
            <FormField label={card ? 'Data da compra' : 'Data do lançamento'}>
              <Input
                type="date"
                name="transactionDate"
                defaultValue={brazilToday()}
                required
              />
            </FormField>
            {!card && (
              <FormField label="Primeiro vencimento">
                <Input
                  type="date"
                  name="firstDueDate"
                  defaultValue={brazilToday()}
                  required
                />
              </FormField>
            )}
          </div>
          {!card && (
            <FormField label="Conta">
              <Select
                name="accountId"
                aria-label="Conta"
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
          )}
          <FormField label="Categoria">
            <Select
              key={type}
              name="categoryId"
              aria-label="Categoria"
              required
              defaultValue=""
            >
              <option value="">Selecione uma categoria</option>
              {categories
                .filter(
                  (c) => c.isActive && c.type === (card ? 'EXPENSE' : type),
                )
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Observações">
            <textarea name="notes" className="input" maxLength={5000} />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void preview()}
          >
            Pré-visualizar parcelas
          </Button>
        </fieldset>
        {plan && (
          <section
            aria-label="Prévia do parcelamento"
            className="installment-preview"
          >
            <p>
              {formatMoney(plan.totalAmount)} em {plan.installmentCount}x.
              Diferença de centavos na última parcela.
            </p>
            {plan.availableBefore !== undefined && (
              <p>
                Limite disponível antes: {formatMoney(plan.availableBefore)}
                <br />
                Após a compra: {formatMoney(plan.availableAfter!)}
                {plan.availableAfter!.startsWith('-') && (
                  <strong> — Limite insuficiente</strong>
                )}
              </p>
            )}
            <ol>
              {plan.installments.map((p) => (
                <li key={p.installmentNumber}>
                  <strong>
                    {p.installmentNumber}/{plan.installmentCount}
                  </strong>
                  <span>
                    {card
                      ? monthLabel(p.competenceDate.slice(0, 7))
                      : formatDate(p.dueDate)}
                  </span>
                  <span>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <p className="form-note">
          O grupo e todas as parcelas serão criados juntos. Valor, quantidade e
          calendário não poderão ser editados depois.
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
          <Button
            disabled={busy || !plan || plan.availableAfter?.startsWith('-')}
          >
            {busy ? 'Salvando…' : 'Salvar parcelamento'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
