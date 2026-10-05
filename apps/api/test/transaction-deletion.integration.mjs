import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { RecurrenceClock } from '../dist/resources/recurrence-calendar.js';
import { signingServer } from './helpers/jwt.mjs';
test('FIN-9: visão mensal e exclusão definitiva no PostgreSQL', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false }),
    db = app.get(PrismaService).client;
  app.get(RecurrenceClock).today = () => '2026-10-01';
  const authIds = [randomUUID(), randomUUID()],
    spaces = [],
    users = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(),
      tokens = await Promise.all(
        authIds.map((id) => signer.token(id, id + '@fin9-test.invalid')),
      );
    async function raw(
      path,
      { method = 'GET', body, who = 0, ws = spaces[who] } = {},
    ) {
      const res = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${tokens[who]}`,
          ...(ws ? { 'X-Workspace-Id': ws } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    }
    async function call(path, options = {}) {
      const res = await raw(path, options);
      assert.equal(
        res.status,
        options.expected ?? 200,
        `${path}: ${JSON.stringify(res)}`,
      );
      return res.body;
    }
    const post = (path, body) =>
        call(path, { method: 'POST', expected: 201, body }),
      remove = (id, options = {}) =>
        call(`/transactions/${id}/permanent`, {
          method: 'DELETE',
          body: { confirm: true },
          ...options,
        });
    for (let who = 0; who < 2; who++) {
      const me = await call('/me', { who });
      spaces.push(me.workspaces[0].id);
      users.push(me.user.id);
    }
    const account = await post('/accounts', {
        name: 'Conta',
        type: 'CHECKING',
      }),
      expense = await post('/categories', {
        name: 'Despesas',
        type: 'EXPENSE',
      }),
      income = await post('/categories', { name: 'Receitas', type: 'INCOME' });
    const simple = (description, expectedAmount = '100', type = 'EXPENSE') =>
      post('/transactions', {
        description,
        expectedAmount,
        type,
        transactionDate: '2026-10-01',
        dueDate: '2026-10-10',
        accountId: account.id,
        categoryId: type === 'INCOME' ? income.id : expense.id,
      });
    const recurrence = (description, expectedAmount, type = 'EXPENSE') =>
      post('/recurrences', {
        description,
        expectedAmount,
        type,
        frequency: 'MONTHLY',
        firstDueDate: '2026-10-10',
        accountId: account.id,
        categoryId: type === 'INCOME' ? income.id : expense.id,
      });
    const card = (name) =>
      post('/credit-cards', {
        name,
        creditLimit: '10000',
        closingDay: 25,
        dueDay: 10,
      });
    const purchase = (id, description, amount) =>
      post(`/credit-cards/${id}/purchases`, {
        description,
        amount,
        categoryId: expense.id,
        transactionDate: '2026-09-20',
      });
    const view = () => call('/transactions/month-view?month=2026-10');
    const group = (description, count = 10, start = 1) =>
      post('/installments', {
        description,
        type: 'EXPENSE',
        amountMode: 'INSTALLMENT',
        installmentAmount: '10',
        installmentCount: count,
        startingInstallment: start,
        transactionDate: '2026-10-01',
        firstDueDate: '2026-10-10',
        accountId: account.id,
        categoryId: expense.id,
      });
    let internet, energy, market, nubank, inter, notebook;
    await t.test(
      'dataset oficial, classificação, subtotais, filtros e summary consistente',
      async () => {
        await recurrence('Salário', '5000', 'INCOME');
        await simple('Freelance', '1000', 'INCOME');
        internet = await recurrence('Internet', '120');
        await recurrence('Condomínio', '650');
        energy = await simple('Energia', '200');
        nubank = await card('Nubank');
        inter = await card('Inter');
        market = await purchase(nubank.id, 'Mercado', '350');
        await purchase(inter.id, 'Combustível', '250');
        notebook = await post(`/credit-cards/${nubank.id}/installments`, {
          description: 'Notebook',
          amountMode: 'INSTALLMENT',
          installmentAmount: '300',
          installmentCount: 10,
          startingInstallment: 5,
          firstInvoiceMonth: '2026-10',
          categoryId: expense.id,
        });
        const result = await view();
        assert.equal(result.rows.length, 8);
        assert.deepEqual(
          result.summary,
          await call('/transactions/summary?month=2026-10'),
        );
        assert.equal(result.summary.income.expected, '6000.00');
        assert.equal(result.summary.expense.expected, '1870.00');
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(result.subtotals).map(([k, v]) => [k, v.expected]),
          ),
          {
            incomeFixed: '5000.00',
            incomeOther: '1000.00',
            expenseFixed: '770.00',
            expenseOther: '200.00',
            ['card:' + nubank.id]: '650.00',
            ['card:' + inter.id]: '250.00',
            cards: '900.00',
          },
        );
        assert.equal(
          result.rows.find((r) => r.description.startsWith('Notebook'))
            .installmentNumber,
          5,
        );
        const filtered = await call(
          '/transactions/month-view?month=2026-10&search=internet&accountId=' +
            account.id +
            '&categoryId=' +
            expense.id +
            '&status=PENDING',
        );
        assert.equal(filtered.rows.length, 1);
        assert.equal(filtered.summary.expense.expected, '120.00');
        assert.equal(
          (await call('/transactions/month-view?month=2026-11&search=Energia'))
            .rows.length,
          0,
        );
        await call('/transactions/month-view', { expected: 400 });
      },
    );
    await t.test(
      'hard delete avulso, compra e reflexos em fatura/limite/resumo',
      async () => {
        await remove(energy.id, { body: {}, expected: 400 });
        await remove(energy.id);
        await call('/transactions/' + energy.id, { expected: 404 });
        assert.equal(
          await db.transaction.count({ where: { id: energy.id } }),
          0,
        );
        assert.equal((await view()).summary.expense.expected, '1670.00');
        assert.ok(
          !(await call('/transactions?month=2026-10')).some(
            (r) => r.id === energy.id,
          ),
        );
        const before = await call('/credit-cards/' + nubank.id);
        await remove(market.id);
        const result = await view();
        assert.equal(result.summary.expense.expected, '1320.00');
        assert.equal(result.subtotals.cards.expected, '550.00');
        assert.equal(result.subtotals['card:' + nubank.id].expected, '300.00');
        assert.equal(
          (
            await call(
              `/credit-cards/${nubank.id}/invoices/${market.invoiceId}`,
            )
          ).total,
          '300.00',
        );
        assert.equal(
          Number(before.usedLimit) -
            Number((await call('/credit-cards/' + nubank.id)).usedLimit),
          350,
        );
        assert.equal(await db.account.count({ where: { id: account.id } }), 1);
        assert.equal(await db.category.count({ where: { id: expense.id } }), 1);
      },
    );
    await t.test(
      'cancelamento mantém histórico; hard delete CANCELLED e PAID remove realizado',
      async () => {
        const row = await simple('Cancelado');
        await call('/transactions/' + row.id + '/cancel', { method: 'POST' });
        assert.equal(
          (await call('/transactions/' + row.id)).status,
          'CANCELLED',
        );
        assert.equal((await view()).summary.expense.expected, '1320.00');
        await remove(row.id);
        await call('/transactions/' + row.id, { expected: 404 });
        const paid = await simple('Pago');
        await call('/transactions/' + paid.id + '/pay', {
          method: 'POST',
          body: { amount: '126.90', paidAt: '2026-10-10T12:00:00Z' },
        });
        assert.equal((await view()).summary.expense.realized, '126.90');
        await remove(paid.id);
        assert.equal((await view()).summary.expense.realized, '0.00');
      },
    );
    await t.test(
      'ocorrência excluída não volta com cursor reiniciado e mudança de vencimento; PAID também',
      async () => {
        const occurrence = internet.occurrences[1];
        await call('/transactions/' + occurrence.id, {
          method: 'PATCH',
          body: { recurrenceScope: 'ONE', dueDate: '2026-12-01' },
        });
        await remove(occurrence.id);
        const paid = internet.occurrences[2];
        await call('/transactions/' + paid.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-12-10T12:00:00Z' },
        });
        await remove(paid.id);
        await db.recurrence.update({
          where: { id: internet.id },
          data: { nextGenerationDate: new Date('2026-10-01') },
        });
        const series = await call('/recurrences/' + internet.id);
        assert.equal(series.occurrences.length, 10);
        assert.ok(
          !series.occurrences.some((r) =>
            [occurrence.id, paid.id].includes(r.id),
          ),
        );
        assert.equal(
          series.occurrences.find((r) => r.recurrenceDate === '2027-01-10')
            .status,
          'PENDING',
        );
        assert.equal(
          await db.recurrenceOccurrenceExclusion.count({
            where: { recurrenceId: internet.id },
          }),
          2,
        );
        assert.equal(
          await db.transaction.count({
            where: {
              recurrenceId: internet.id,
              recurrenceDate: {
                in: [new Date('2026-11-10'), new Date('2026-12-10')],
              },
            },
          }),
          0,
        );
      },
    );
    await t.test(
      'parcelas comuns preservam 6/10, controle retroativo e removem grupo vazio',
      async () => {
        const normal = await group('Empréstimo');
        await remove(normal.installments[4].id);
        const detail = await call('/installment-groups/' + normal.id);
        assert.deepEqual(
          detail.installments.map((r) => r.installmentNumber),
          [1, 2, 3, 4, 6, 7, 8, 9, 10],
        );
        assert.equal(detail.controlledAmount, '100.00');
        assert.equal(detail.controlledInstallmentCount, 10);
        const retro = await group('Retroativo', 10, 5);
        await remove(retro.installments[0].id);
        const changed = await call('/installment-groups/' + retro.id);
        assert.equal(changed.startingInstallment, 5);
        assert.equal(changed.previousInstallmentCount, 4);
        assert.equal(changed.controlledAmount, '60.00');
        assert.equal(changed.installments[0].installmentNumber, 6);
        for (const row of changed.installments) await remove(row.id);
        await call('/installment-groups/' + retro.id, { expected: 404 });
        assert.equal(
          await db.installmentGroup.count({ where: { id: retro.id } }),
          0,
        );
        await remove(notebook.installments[0].id);
        assert.equal(
          (await call('/installment-groups/' + notebook.id)).installments[0]
            .installmentNumber,
          6,
        );
      },
    );
    await t.test(
      'fatura vazia removida; fatura paga bloqueia exclusão sem alterações',
      async () => {
        const emptyCard = await card('Vazia'),
          only = await purchase(emptyCard.id, 'Única', '100');
        await remove(only.id);
        assert.equal(
          await db.creditCardInvoice.count({ where: { id: only.invoiceId } }),
          0,
        );
        assert.equal(
          (await call('/credit-cards/' + emptyCard.id)).usedLimit,
          '0.00',
        );
        const paidCard = await card('Paga'),
          paid = await purchase(paidCard.id, 'Compra paga', '100');
        await call(
          `/credit-cards/${paidCard.id}/invoices/${paid.invoiceId}/pay`,
          {
            method: 'POST',
            body: { accountId: account.id, paidAt: '2026-10-10T12:00:00Z' },
          },
        );
        const blocked = await remove(paid.id, { expected: 409 });
        assert.match(blocked.message, /fatura já paga/);
        assert.equal((await call('/transactions/' + paid.id)).status, 'PAID');
        assert.equal(
          (
            await call(
              `/credit-cards/${paidCard.id}/invoices/${paid.invoiceId}`,
            )
          ).total,
          '100.00',
        );
      },
    );
    await t.test(
      'cross-tenant, ausência de membership e VIEWER não podem excluir',
      async () => {
        const row = await simple('Protegido');
        await remove(row.id, { who: 1, expected: 404 });
        await remove(row.id, { who: 1, ws: spaces[0], expected: 403 });
        await db.workspaceMember.updateMany({
          where: { workspaceId: spaces[0], userId: users[0] },
          data: { role: 'VIEWER' },
        });
        await remove(row.id, { expected: 403 });
        await call('/transactions/' + row.id + '/cancel', {
          method: 'POST',
          expected: 403,
        });
        await view();
        await db.workspaceMember.updateMany({
          where: { workspaceId: spaces[0], userId: users[0] },
          data: { role: 'OWNER' },
        });
        assert.equal((await call('/transactions/' + row.id)).status, 'PENDING');
        await remove(row.id);
      },
    );
    await t.test(
      'dupla exclusão, exclusão x baixa e exclusão x pagamento da fatura',
      async () => {
        const row = await simple('Concorrente');
        const results = await Promise.all(
          [1, 2].map(() =>
            raw(`/transactions/${row.id}/permanent`, {
              method: 'DELETE',
              body: { confirm: true },
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
        const payRow = await simple('Baixa concorrente');
        const bank = await Promise.all([
          raw(`/transactions/${payRow.id}/permanent`, {
            method: 'DELETE',
            body: { confirm: true },
          }),
          raw(`/transactions/${payRow.id}/pay`, {
            method: 'POST',
            body: { paidAt: '2026-10-10T12:00:00Z' },
          }),
        ]);
        assert.equal(bank[0].status, 200);
        assert.ok([200, 404].includes(bank[1].status));
        assert.equal(
          await db.transaction.count({ where: { id: payRow.id } }),
          0,
        );
        for (let n = 0; n < 3; n++) {
          const cc = await card('Corrida ' + n),
            p = await purchase(cc.id, 'Corrida', '100');
          const outcomes = await Promise.all([
            raw(`/transactions/${p.id}/permanent`, {
              method: 'DELETE',
              body: { confirm: true },
            }),
            raw(`/credit-cards/${cc.id}/invoices/${p.invoiceId}/pay`, {
              method: 'POST',
              body: { accountId: account.id, paidAt: '2026-10-10T12:00:00Z' },
            }),
          ]);
          const invoice = await db.creditCardInvoice.findUnique({
            where: { id: p.invoiceId },
          });
          if (invoice) {
            assert.equal(invoice.status, 'PAID');
            assert.equal(outcomes[0].status, 409);
            assert.equal(outcomes[1].status, 200);
            assert.equal(
              (await db.transaction.findUnique({ where: { id: p.id } })).status,
              'PAID',
            );
          } else {
            assert.equal(outcomes[0].status, 200);
            assert.equal(outcomes[1].status, 404);
          }
        }
      },
    );
  } finally {
    await db.$transaction(async (tx) => {
      const people = await tx.user.findMany({
          where: { authUserId: { in: authIds } },
          select: { id: true },
        }),
        ids = people.map((p) => p.id),
        workspaces = await tx.workspace.findMany({
          where: { ownerId: { in: ids } },
          select: { id: true },
        }),
        ws = workspaces.map((w) => w.id),
        where = { workspaceId: { in: ws } };
      for (const model of [
        'transaction',
        'recurrenceOccurrenceExclusion',
        'recurrenceRevision',
        'recurrence',
        'installmentGroup',
        'creditCardInvoice',
        'creditCard',
        'account',
        'category',
        'workspaceMember',
      ])
        await tx[model].deleteMany({ where });
      await tx.workspace.deleteMany({ where: { id: { in: ws } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    await app.close();
    await signer.close();
  }
});
