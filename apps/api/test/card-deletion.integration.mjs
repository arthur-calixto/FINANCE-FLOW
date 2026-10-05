import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('Complemento FIN-9: exclusão de parcelas de cartão por escopo', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false }),
    db = app.get(PrismaService).client,
    authIds = [randomUUID(), randomUUID()],
    spaces = [],
    users = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(),
      tokens = await Promise.all(
        authIds.map((id) => signer.token(id, id + '@card-deletion.invalid')),
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
      const result = await raw(path, options);
      assert.equal(
        result.status,
        options.expected ?? 200,
        `${path}: ${JSON.stringify(result)}`,
      );
      return result.body;
    }
    const post = (path, body) =>
        call(path, { method: 'POST', body, expected: 201 }),
      remove = (row, scope = 'THIS', options = {}) =>
        call(`/transactions/${row.id}/permanent`, {
          method: 'DELETE',
          body: { confirm: true, scope },
          ...options,
        }),
      preview = (row) => call(`/transactions/${row.id}/deletion-options`);
    for (let who = 0; who < 2; who++) {
      const me = await call('/me', { who });
      users.push(me.user.id);
      spaces.push(me.workspaces[0].id);
    }
    const account = await post('/accounts', {
        name: 'Conta',
        type: 'CHECKING',
      }),
      category = await post('/categories', {
        name: 'Compras',
        type: 'EXPENSE',
      });
    async function fixture(name, start = 1) {
      const card = await post('/credit-cards', {
          name,
          closingDay: 25,
          dueDay: 10,
          creditLimit: '10000',
        }),
        group = await post(`/credit-cards/${card.id}/installments`, {
          description: name,
          categoryId: category.id,
          amountMode: 'INSTALLMENT',
          installmentAmount: '300',
          installmentCount: 10,
          startingInstallment: start,
          ...(start === 1
            ? { transactionDate: '2026-09-20' }
            : { firstInvoiceMonth: '2026-10' }),
        });
      return { card, group };
    }
    const pay = (card, row) =>
      call(`/credit-cards/${card.id}/invoices/${row.invoiceId}/pay`, {
        method: 'POST',
        body: { accountId: account.id, paidAt: '2026-10-10T12:00:00Z' },
      });
    const used = async (card) =>
      (await call('/credit-cards/' + card.id)).usedLimit;
    const detail = (group) => call('/installment-groups/' + group.id);
    const remaining = async (group) =>
      (await detail(group)).installments.map((r) => r.installmentNumber);
    const where = (card) => ({ workspaceId: spaces[0], creditCardId: card.id });
    await t.test(
      'compra errada sai de 830 para 650, sem histórico; contrato individual legado',
      async () => {
        const { card, group } = await fixture('Notebook retro', 5);
        const purchase = (description, amount) =>
          post(`/credit-cards/${card.id}/purchases`, {
            description,
            amount,
            categoryId: category.id,
            transactionDate: '2026-09-20',
          });
        await purchase('Mercado', '350');
        const wrong = await purchase('Compra errada', '180'),
          path = `/credit-cards/${card.id}/invoices/${wrong.invoiceId}`;
        assert.equal((await call(path)).total, '830.00');
        assert.equal(await used(card), '2330.00');
        const before = await call('/transactions/summary?month=2026-10');
        await remove(wrong, 'THIS', { body: { confirm: true } });
        assert.equal((await call(path)).total, '650.00');
        assert.equal(await used(card), '2150.00');
        assert.equal(
          Number(before.expense.expected) -
            Number(
              (await call('/transactions/summary?month=2026-10')).expense
                .expected,
            ),
          180,
        );
        await call('/transactions/' + wrong.id, { expected: 404 });
        assert.equal(
          await db.transaction.count({ where: { id: wrong.id } }),
          0,
        );
        assert.equal((await detail(group)).startingInstallment, 5);
      },
    );
    await t.test(
      'THIS exclui 5/10 sem renumerar e limpa somente sua fatura vazia',
      async () => {
        const { card, group } = await fixture('Individual');
        const selected = group.installments[4];
        const choices = await preview(selected);
        assert.deepEqual(
          choices.options.map((o) => [o.scope, o.count]),
          [
            ['THIS', 1],
            ['THIS_AND_FUTURE', 6],
            ['ALL', 10],
          ],
        );
        assert.equal(
          (await call('/transactions/' + selected.id))
            .permanentDeleteBlockedReason,
          null,
        );
        const result = await remove(selected);
        assert.equal(result.deletedCount, 1);
        assert.deepEqual(result.deletedInvoiceIds, [selected.invoiceId]);
        assert.deepEqual(await remaining(group), [1, 2, 3, 4, 6, 7, 8, 9, 10]);
        assert.equal(await used(card), '2700.00');
        assert.equal(
          await db.creditCardInvoice.count({
            where: { id: selected.invoiceId },
          }),
          0,
        );
        const record = await detail(group);
        assert.equal(record.installmentCount, 10);
        assert.equal(record.controlledAmount, '3000.00');
        assert.equal(record.startingInstallment, 1);
        assert.equal(
          (
            await call(
              '/transactions/month-view?month=2027-02&search=Individual',
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      'THIS_AND_FUTURE deixa 1–4; ALL remove grupo e faturas; retroativo preserva metadados',
      async () => {
        const { card, group } = await fixture('Futuras');
        const result = await remove(group.installments[4], 'THIS_AND_FUTURE');
        assert.equal(result.deletedCount, 6);
        assert.equal(result.deletedInvoiceIds.length, 6);
        assert.deepEqual(await remaining(group), [1, 2, 3, 4]);
        assert.equal(await used(card), '1200.00');
        assert.equal(
          await db.creditCardInvoice.count({ where: where(card) }),
          4,
        );
        const full = await fixture('Inteiro');
        await remove(full.group.installments[4], 'ALL');
        assert.equal(
          await db.transaction.count({ where: where(full.card) }),
          0,
        );
        assert.equal(
          await db.installmentGroup.count({ where: { id: full.group.id } }),
          0,
        );
        assert.equal(
          await db.creditCardInvoice.count({ where: where(full.card) }),
          0,
        );
        assert.equal(await used(full.card), '0.00');
        assert.equal(
          (await call('/transactions/month-view?month=2026-10&search=Inteiro'))
            .summary.expense.expected,
          '0.00',
        );
        const retro = await fixture('Retroativo', 5);
        await remove(retro.group.installments[0]);
        const r = await detail(retro.group);
        assert.equal(r.startingInstallment, 5);
        assert.equal(r.previousInstallmentCount, 4);
        assert.equal(r.controlledAmount, '1800.00');
        assert.deepEqual(
          r.installments.map((i) => i.installmentNumber),
          [6, 7, 8, 9, 10],
        );
      },
    );
    await t.test(
      'parcialmente pago omite ALL e permite remover 5–10 preservando pagamentos 1–2',
      async () => {
        const { card, group } = await fixture('Parcial');
        await pay(card, group.installments[0]);
        await pay(card, group.installments[1]);
        const paidBefore = await db.creditCardInvoice.findMany({
          where: { ...where(card), status: 'PAID' },
          orderBy: { id: 'asc' },
        });
        const choices = await preview(group.installments[4]);
        assert.deepEqual(
          choices.options.map((o) => o.scope),
          ['THIS', 'THIS_AND_FUTURE'],
        );
        const snapshot = await detail(group);
        await remove(group.installments[4], 'ALL', { expected: 409 });
        assert.deepEqual(await detail(group), snapshot);
        await remove(group.installments[4], 'THIS_AND_FUTURE');
        assert.deepEqual(await remaining(group), [1, 2, 3, 4]);
        assert.equal(await used(card), '600.00');
        assert.deepEqual(
          await db.creditCardInvoice.findMany({
            where: { ...where(card), status: 'PAID' },
            orderBy: { id: 'asc' },
          }),
          paidBefore,
        );
        assert.deepEqual(
          (await detail(group)).installments.map((r) => r.status),
          ['PAID', 'PAID', 'PENDING', 'PENDING'],
        );
      },
    );
    await t.test(
      'fatura paga selecionada ou futura bloqueia lote inteiro; preview e confirmação revalidados',
      async () => {
        const { card, group } = await fixture('Bloqueio');
        const selected = group.installments[4];
        await preview(selected);
        await pay(card, group.installments[6]);
        const before = await detail(group),
          limit = await used(card),
          summary = await call('/transactions/summary?month=2027-04');
        assert.deepEqual(
          (await preview(selected)).options.map((o) => o.scope),
          ['THIS'],
        );
        await remove(selected, 'THIS_AND_FUTURE', { expected: 409 });
        await remove(selected, 'ALL', { expected: 409 });
        await remove(group.installments[6], 'THIS', { expected: 409 });
        assert.equal((await preview(group.installments[6])).options.length, 0);
        assert.deepEqual(await detail(group), before);
        assert.equal(await used(card), limit);
        assert.deepEqual(
          await call('/transactions/summary?month=2027-04'),
          summary,
        );
        await remove(selected, 'THIS', {
          body: { confirm: true, scope: 'THIS', expectedCount: 2 },
          expected: 409,
        });
        assert.deepEqual(await detail(group), before);
        await remove(group.installments[9]);
        const opts = await preview(selected);
        assert.equal(opts.options[0].count, 1);
      },
    );
    await t.test(
      'quantidade confirma apenas parcelas existentes; canceladas excluídas; fatura compartilhada preservada',
      async () => {
        const { card, group } = await fixture('Lacunas');
        const other = await post(`/credit-cards/${card.id}/purchases`, {
          description: 'Outra compra',
          amount: '75',
          categoryId: category.id,
          transactionDate: '2026-09-20',
        });
        await remove(group.installments[5]);
        assert.equal(
          (await preview(group.installments[4])).options.find(
            (o) => o.scope === 'THIS_AND_FUTURE',
          ).count,
          5,
        );
        await remove(group.installments[4], 'THIS_AND_FUTURE', {
          body: { confirm: true, scope: 'THIS_AND_FUTURE', expectedCount: 6 },
          expected: 409,
        });
        assert.equal(
          await db.transaction.count({
            where: { installmentGroupId: group.id },
          }),
          9,
        );
        await call('/installment-groups/' + group.id, { method: 'DELETE' });
        assert.equal(await used(card), '75.00');
        await remove(group.installments[0], 'ALL');
        assert.equal(
          await db.installmentGroup.count({ where: { id: group.id } }),
          0,
        );
        assert.equal(
          await db.creditCardInvoice.count({ where: where(card) }),
          1,
        );
        assert.equal(
          (await call(`/credit-cards/${card.id}/invoices/${other.invoiceId}`))
            .total,
          '75.00',
        );
      },
    );
    await t.test(
      'isolamento, permissões e contrato restrito de scopes',
      async () => {
        const { group } = await fixture('Protegido'),
          row = group.installments[4];
        await call(`/transactions/${row.id}/deletion-options`, {
          who: 1,
          expected: 404,
        });
        await remove(row, 'ALL', { who: 1, expected: 404 });
        await db.workspaceMember.updateMany({
          where: { workspaceId: spaces[0], userId: users[0] },
          data: { role: 'VIEWER' },
        });
        await remove(row, 'ALL', { expected: 403 });
        await db.workspaceMember.updateMany({
          where: { workspaceId: spaces[0], userId: users[0] },
          data: { role: 'OWNER' },
        });
        await remove(row, 'INVALID', { expected: 400 });
        await remove(row, 'ALL', {
          body: { confirm: false, scope: 'ALL' },
          expected: 400,
        });
        assert.equal((await detail(group)).installments.length, 10);
        const simple = await post('/transactions', {
          description: 'Comum',
          type: 'EXPENSE',
          expectedAmount: '10',
          transactionDate: '2026-10-01',
          dueDate: '2026-10-10',
          accountId: account.id,
          categoryId: category.id,
        });
        await remove(simple, 'ALL', { expected: 400 });
        await remove(simple);
      },
    );
    await t.test(
      'concorrência de lote versus pagamento e duas exclusões mantém integridade',
      async () => {
        for (let n = 0; n < 3; n++) {
          const { card, group } = await fixture('Corrida ' + n),
            selected = group.installments[4],
            future = group.installments[6];
          const results = await Promise.all([
            raw(`/transactions/${selected.id}/permanent`, {
              method: 'DELETE',
              body: { confirm: true, scope: 'THIS_AND_FUTURE' },
            }),
            raw(`/credit-cards/${card.id}/invoices/${future.invoiceId}/pay`, {
              method: 'POST',
              body: { accountId: account.id, paidAt: '2027-04-10T12:00:00Z' },
            }),
          ]);
          if (results[0].status === 200) {
            assert.equal(results[1].status, 404);
            assert.deepEqual(await remaining(group), [1, 2, 3, 4]);
            assert.equal(await used(card), '1200.00');
          } else {
            assert.equal(results[0].status, 409);
            assert.equal(results[1].status, 200);
            assert.equal((await detail(group)).installments.length, 10);
            assert.equal(await used(card), '2700.00');
          }
        }
        const { group } = await fixture('Duplo');
        const results = await Promise.all(
          [1, 2].map(() =>
            raw(`/transactions/${group.installments[4].id}/permanent`, {
              method: 'DELETE',
              body: { confirm: true, scope: 'ALL' },
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
        assert.equal(
          await db.installmentGroup.count({ where: { id: group.id } }),
          0,
        );
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
