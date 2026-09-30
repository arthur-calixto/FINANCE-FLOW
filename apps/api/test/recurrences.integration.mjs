import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { RecurrenceClock } from '../dist/resources/recurrence-calendar.js';
import { RecurrencesService } from '../dist/resources/recurrences.service.js';
import { signingServer } from './helpers/jwt.mjs';
test('Recorrências: janela, exceções, versões, encerramento e isolamento PostgreSQL', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false }),
    db = app.get(PrismaService).client;
  let today = '2026-10-01';
  app.get(RecurrenceClock).today = () => today;
  const service = app.get(RecurrencesService),
    authIds = [randomUUID(), randomUUID()],
    users = [],
    spaces = [],
    accounts = [],
    categories = [],
    incomes = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const tokens = await Promise.all(
      authIds.map((id) => signer.token(id, id + '@recurrences-test.invalid')),
    );
    async function call(
      path,
      { method = 'GET', body, who = 0, ws = spaces[who], expected = 200 } = {},
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
      const result = await res.json();
      assert.equal(
        res.status,
        expected,
        `${method} ${path}: ${JSON.stringify(result)}`,
      );
      return result;
    }
    for (let who = 0; who < 2; who++) {
      const me = await call('/me', { who });
      users.push(me.user.id);
      spaces.push(me.workspaces[0].id);
      accounts.push(
        await call('/accounts', {
          who,
          method: 'POST',
          expected: 201,
          body: { name: 'Conta', type: 'CHECKING' },
        }),
      );
      categories.push(
        await call('/categories', {
          who,
          method: 'POST',
          expected: 201,
          body: { name: 'Serviços', type: 'EXPENSE' },
        }),
      );
      incomes.push(
        await call('/categories', {
          who,
          method: 'POST',
          expected: 201,
          body: { name: 'Salário', type: 'INCOME' },
        }),
      );
    }
    const payload = (patch = {}) => ({
      description: 'Internet',
      type: 'EXPENSE',
      expectedAmount: '120',
      frequency: 'MONTHLY',
      firstDueDate: '2026-10-10',
      accountId: accounts[0].id,
      categoryId: categories[0].id,
      notes: 'Contrato',
      ...patch,
    });
    let internet, salary;
    await t.test(
      'criação e preview de 12 meses; renda e resumo sem duplicação',
      async () => {
        const preview = await call('/recurrences/preview', {
          method: 'POST',
          body: {
            expectedAmount: '120',
            frequency: 'MONTHLY',
            firstDueDate: '2026-10-10',
          },
        });
        assert.equal(preview.occurrences.length, 12);
        internet = await call('/recurrences', {
          method: 'POST',
          expected: 201,
          body: payload(),
        });
        salary = await call('/recurrences', {
          method: 'POST',
          expected: 201,
          body: payload({
            description: 'Salário',
            type: 'INCOME',
            expectedAmount: '5000',
            categoryId: incomes[0].id,
            firstDueDate: '2026-10-05',
          }),
        });
        for (const row of [internet, salary]) {
          assert.equal(row.occurrences.length, 12);
          assert.ok(
            row.occurrences.every(
              (o) =>
                o.amount === null &&
                o.status === 'PENDING' &&
                o.recurrenceId === row.id,
            ),
          );
          assert.equal(row.occurrences[0].competenceDate, '2026-10-01');
          assert.equal(row.occurrences[11].competenceDate, '2027-09-01');
        }
        const summary = await call('/transactions/summary?month=2026-10');
        assert.equal(summary.expense.expected, '120.00');
        assert.equal(summary.income.expected, '5000.00');
        assert.equal((await call('/transactions?month=2026-10')).length, 2);
      },
    );
    await t.test(
      'materialização simultânea, identidade única e avanço automático da janela',
      async () => {
        await Promise.all(
          Array.from({ length: 6 }, () => call('/recurrences')),
        );
        assert.equal(
          await db.transaction.count({ where: { recurrenceId: internet.id } }),
          12,
        );
        today = '2026-11-01';
        await call('/transactions/summary?month=2027-10');
        const detail = await call('/recurrences/' + internet.id);
        assert.equal(detail.occurrences.length, 13);
        assert.equal(detail.occurrences[12].dueDate, '2027-10-10');
        const first = await db.transaction.findFirst({
          where: { recurrenceId: internet.id },
        });
        const { id, createdAt, updatedAt, ...copy } = first;
        void id;
        void createdAt;
        void updatedAt;
        await assert.rejects(
          db.transaction.create({ data: copy }),
          (e) => e.code === 'P2002',
        );
        today = '2026-10-01';
      },
    );
    await t.test(
      'somente este preserva regra e identidade mesmo mudando competência',
      async () => {
        const dec = internet.occurrences[2];
        await call('/transactions/' + dec.id, {
          method: 'PATCH',
          expected: 400,
          body: { expectedAmount: '140' },
        });
        await call('/transactions/' + dec.id, {
          method: 'PATCH',
          body: {
            recurrenceScope: 'ONE',
            expectedAmount: '140',
            dueDate: '2027-01-02',
          },
        });
        await call('/recurrences');
        const changed = await call('/transactions/' + dec.id);
        assert.equal(changed.expectedAmount, '140.00');
        assert.equal(changed.recurrenceDate, '2026-12-10');
        assert.equal(changed.competenceDate, '2027-01-01');
        // Força uma nova varredura da janela: a constraint conserva a exceção.
        await db.recurrence.update({
          where: { id: internet.id },
          data: { nextGenerationDate: new Date('2026-10-01T00:00:00Z') },
        });
        await service.ensureRecurrenceHorizon(spaces[0]);
        assert.equal(
          (await call('/transactions/' + dec.id)).expectedAmount,
          '140.00',
        );
        assert.equal(
          await db.transaction.count({
            where: {
              recurrenceId: internet.id,
              recurrenceDate: new Date('2026-12-10T00:00:00Z'),
            },
          }),
          1,
        );
        assert.equal(
          (await call('/recurrences/' + internet.id)).expectedAmount,
          '120.00',
        );
      },
    );
    await t.test(
      'baixa diferente, este e próximos e revisões fora de ordem preservam PAID',
      async () => {
        await call('/transactions/' + internet.occurrences[0].id + '/pay', {
          method: 'POST',
          body: { amount: '126.90', paidAt: '2026-10-10T12:00:00Z' },
        });
        await call('/transactions/' + internet.occurrences[4].id + '/pay', {
          method: 'POST',
          body: { paidAt: '2027-02-10T12:00:00Z' },
        });
        await call('/recurrences/' + internet.id, {
          method: 'PATCH',
          body: {
            fromTransactionId: internet.occurrences[3].id,
            expectedAmount: '135',
            description: 'Internet reajustada',
            notes: 'Novo contrato',
          },
        });
        let detail = await call('/recurrences/' + internet.id);
        assert.deepEqual(
          detail.occurrences.slice(0, 6).map((o) => o.expectedAmount),
          ['120.00', '120.00', '140.00', '135.00', '120.00', '135.00'],
        );
        assert.equal(detail.occurrences[0].amount, '126.90');
        assert.equal(detail.occurrences[4].status, 'PAID');
        // Corte sobre PAID preserva o título pago e muda os elegíveis seguintes.
        await call('/recurrences/' + internet.id, {
          method: 'PATCH',
          body: {
            fromTransactionId: internet.occurrences[4].id,
            expectedAmount: '150',
          },
        });
        await call('/recurrences/' + internet.id, {
          method: 'PATCH',
          body: {
            fromTransactionId: internet.occurrences[1].id,
            expectedAmount: '125',
          },
        });
        detail = await call('/recurrences/' + internet.id);
        assert.equal(detail.occurrences[1].expectedAmount, '125.00');
        assert.equal(detail.occurrences[3].expectedAmount, '135.00');
        assert.equal(detail.occurrences[4].expectedAmount, '120.00');
        assert.equal(detail.occurrences[5].expectedAmount, '150.00');
        today = '2026-12-01';
        await call('/transactions?month=2027-11');
        detail = await call('/recurrences/' + internet.id);
        assert.equal(detail.occurrences.at(-1).expectedAmount, '150.00');
        today = '2026-10-01';
        await call('/transactions/' + salary.occurrences[0].id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-05T12:00:00Z' },
        });
        await call('/recurrences/' + salary.id, {
          method: 'PATCH',
          body: {
            fromTransactionId: salary.occurrences[3].id,
            expectedAmount: '5500',
          },
        });
        assert.equal(
          (await call('/transactions/summary?month=2026-10')).income.realized,
          '5000.00',
        );
      },
    );
    await t.test(
      'cancelamento individual permanece cancelado e não termina a série',
      async () => {
        const occurrence = internet.occurrences[6];
        await call('/transactions/' + occurrence.id, { method: 'DELETE' });
        await db.recurrence.update({
          where: { id: internet.id },
          data: { nextGenerationDate: new Date('2026-10-01T00:00:00Z') },
        });
        await call('/recurrences');
        const detail = await call('/recurrences/' + internet.id);
        assert.equal(
          detail.occurrences.find((o) => o.id === occurrence.id).status,
          'CANCELLED',
        );
        assert.equal(detail.occurrences[7].status, 'PENDING');
        assert.equal(detail.status, 'ACTIVE');
        await call('/recurrences/' + internet.id, {
          method: 'PATCH',
          body: { fromTransactionId: occurrence.id, expectedAmount: '155' },
        });
        assert.equal(
          (await call('/transactions/' + occurrence.id)).status,
          'CANCELLED',
        );
      },
    );
    await t.test(
      'encerramento preserva anterior e PAID, cancela pendentes e bloqueia geração',
      async () => {
        const ended = await call('/recurrences/' + internet.id, {
          method: 'DELETE',
          body: { fromDate: '2027-01-10' },
        });
        assert.equal(ended.status, 'ENDING');
        assert.equal(ended.occurrences[0].status, 'PAID');
        assert.equal(ended.occurrences[1].status, 'PENDING');
        assert.equal(ended.occurrences[3].status, 'CANCELLED');
        assert.equal(ended.occurrences[4].status, 'PAID');
        assert.ok(
          ended.occurrences.slice(5).every((o) => o.status === 'CANCELLED'),
        );
        await call('/transactions/' + internet.occurrences[4].id + '/reopen', {
          method: 'POST',
          expected: 409,
          body: {},
        });
        const count = await db.transaction.count({
          where: { recurrenceId: internet.id },
        });
        today = '2027-03-01';
        const detail = await call('/recurrences/' + internet.id);
        assert.equal(detail.status, 'ENDED');
        await call('/recurrences');
        assert.equal(
          await db.transaction.count({ where: { recurrenceId: internet.id } }),
          count,
        );
        await call('/recurrences/' + internet.id, {
          method: 'PATCH',
          expected: 409,
          body: {
            fromTransactionId: internet.occurrences[3].id,
            expectedAmount: '160',
          },
        });
        today = '2026-10-01';
      },
    );
    await t.test(
      'retroativo, anual bissexto, início futuro e vínculos desativados',
      async () => {
        const retro = await call('/recurrences', {
          method: 'POST',
          expected: 201,
          body: payload({ firstDueDate: '2020-01-31' }),
        });
        assert.equal(retro.occurrences[0].dueDate, '2026-10-31');
        assert.equal(retro.occurrences.length, 12);
        const yearly = await call('/recurrences', {
          method: 'POST',
          expected: 201,
          body: payload({ frequency: 'YEARLY', firstDueDate: '2024-02-29' }),
        });
        assert.equal(yearly.occurrences.length, 1);
        assert.equal(yearly.occurrences[0].dueDate, '2027-02-28');
        const future = await call('/recurrences', {
          method: 'POST',
          expected: 201,
          body: payload({ firstDueDate: '2030-03-15' }),
        });
        assert.equal(future.occurrences.length, 0);
        await call('/categories/' + categories[0].id, {
          method: 'PATCH',
          expected: 400,
          body: { type: 'INCOME' },
        });
        await call('/accounts/' + accounts[0].id, { method: 'DELETE' });
        await call('/categories/' + categories[0].id, { method: 'DELETE' });
        today = '2027-11-01';
        const extended = await call('/recurrences/' + yearly.id);
        assert.equal(extended.occurrences.at(-1).dueDate, '2028-02-29');
        await call('/transactions/' + retro.occurrences[0].id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-31T12:00:00Z' },
        });
        await call('/recurrences', {
          method: 'POST',
          expected: 400,
          body: payload(),
        });
        await call('/accounts/' + accounts[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
        await call('/categories/' + categories[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
        today = '2026-10-01';
      },
    );
    await t.test(
      'cross-tenant, payloads inválidos, materialização e VIEWER',
      async () => {
        assert.equal((await call('/recurrences', { who: 1 })).length, 0);
        assert.equal(
          await db.transaction.count({ where: { workspaceId: spaces[1] } }),
          0,
        );
        await call('/recurrences/' + internet.id, { who: 1, expected: 404 });
        await call('/recurrences/' + internet.id, {
          who: 1,
          method: 'DELETE',
          expected: 404,
          body: { fromDate: '2027-01-01' },
        });
        await call('/recurrences/' + salary.id, {
          who: 1,
          method: 'PATCH',
          expected: 404,
          body: {
            fromTransactionId: salary.occurrences[0].id,
            expectedAmount: '1',
          },
        });
        await call('/transactions/' + salary.occurrences[1].id, {
          who: 1,
          method: 'PATCH',
          expected: 404,
          body: { recurrenceScope: 'ONE', expectedAmount: '1' },
        });
        await call('/transactions/' + salary.occurrences[1].id + '/pay', {
          who: 1,
          method: 'POST',
          expected: 404,
          body: { paidAt: '2026-11-05T12:00:00Z' },
        });
        for (const patch of [
          { accountId: accounts[1].id },
          { categoryId: categories[1].id },
          { categoryId: incomes[0].id },
          { expectedAmount: '0' },
          { frequency: 'DAILY' },
          { firstDueDate: '2026-02-30' },
          { workspaceId: spaces[1] },
        ])
          await call('/recurrences', {
            method: 'POST',
            expected: 400,
            body: payload(patch),
          });
        await call('/recurrences/' + salary.id, {
          method: 'PATCH',
          expected: 404,
          body: {
            fromTransactionId: internet.occurrences[0].id,
            expectedAmount: '1',
          },
        });
        await call('/recurrences/' + salary.id, {
          method: 'PATCH',
          expected: 400,
          body: {
            fromTransactionId: salary.occurrences[1].id,
            accountId: accounts[1].id,
          },
        });
        await call('/recurrences/' + salary.id, {
          method: 'PATCH',
          expected: 400,
          body: {
            fromTransactionId: salary.occurrences[1].id,
            frequency: 'MONTHLY',
          },
        });
        await call('/recurrences', { who: 1, ws: spaces[0], expected: 403 });
        await db.workspaceMember.updateMany({
          where: { workspaceId: spaces[0], userId: users[0] },
          data: { role: 'VIEWER' },
        });
        await call('/recurrences');
        await call('/recurrences', {
          method: 'POST',
          expected: 403,
          body: payload(),
        });
        await call('/recurrences/' + salary.id, {
          method: 'PATCH',
          expected: 403,
          body: {
            fromTransactionId: salary.occurrences[1].id,
            expectedAmount: '1',
          },
        });
        await call('/recurrences/' + salary.id, {
          method: 'DELETE',
          expected: 403,
          body: { fromDate: '2027-01-01' },
        });
      },
    );
  } finally {
    await db.$transaction(async (tx) => {
      const people = await tx.user.findMany({
        where: { authUserId: { in: authIds } },
        select: { id: true },
      });
      const ids = people.map((p) => p.id);
      const ws = await tx.workspace.findMany({
        where: { ownerId: { in: ids } },
        select: { id: true },
      });
      const wsIds = ws.map((w) => w.id);
      await tx.transaction.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.recurrenceRevision.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.recurrence.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await tx.account.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await tx.category.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await tx.workspaceMember.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    await app.close();
    await signer.close();
  }
});
