import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('Transactions: domínio, competência, baixa e isolamento PostgreSQL', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false });
  const db = app.get(PrismaService).client;
  const ids = [randomUUID(), randomUUID()];
  const users = [];
  const workspaces = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const tokens = await Promise.all(
      ids.map((id) => signer.token(id, `${id}@transactions-test.invalid`)),
    );
    async function call(
      path,
      {
        method = 'GET',
        body,
        who = 0,
        ws = workspaces[who],
        expected = 200,
      } = {},
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
      const data = await res.json();
      assert.equal(
        res.status,
        expected,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      return data;
    }
    for (let who = 0; who < 2; who++) {
      const me = await call('/me', { who });
      users.push(me.user.id);
      workspaces.push(me.workspaces[0].id);
    }
    const accounts = [],
      expenses = [],
      incomes = [];
    for (let who = 0; who < 2; who++) {
      accounts.push(
        await call('/accounts', {
          who,
          method: 'POST',
          expected: 201,
          body: { name: 'Conta', type: 'CHECKING' },
        }),
      );
      expenses.push(
        await call('/categories', {
          who,
          method: 'POST',
          expected: 201,
          body: { name: 'Energia', type: 'EXPENSE' },
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
    const payload = (who = 0) => ({
      description: 'Energia',
      type: 'EXPENSE',
      expectedAmount: '200.00',
      transactionDate: '2026-09-29',
      dueDate: '2026-10-10',
      accountId: accounts[who].id,
      categoryId: expenses[who].id,
    });
    const create = (body, who = 0) =>
      call('/transactions', { who, method: 'POST', expected: 201, body });
    let expense, income, other;
    await t.test(
      'criação de receita/despesa e competência civil pelo vencimento',
      async () => {
        expense = await create(payload());
        other = await create(payload(1), 1);
        income = await create({
          ...payload(),
          type: 'INCOME',
          categoryId: incomes[0].id,
          description: 'Salário',
          expectedAmount: '5000',
          dueDate: '2026-10-05',
        });
        assert.equal(expense.competenceDate, '2026-10-01');
        assert.equal(expense.transactionDate, '2026-09-29');
        assert.equal(expense.dueDate, '2026-10-10');
        assert.equal(expense.amount, null);
        assert.equal(expense.createdBy, users[0]);
        assert.equal(expense.workspaceId, workspaces[0]);
        assert.equal(
          (await db.transaction.findUnique({ where: { id: expense.id } }))
            .status,
          'PENDING',
        );
        const amountOnly = await create({
          ...payload(),
          expectedAmount: null,
          amount: '9007199254740993.01',
          dueDate: '2026-11-10',
        });
        assert.equal(amountOnly.amount, '9007199254740993.01');
        await call('/transactions/' + amountOnly.id, { method: 'DELETE' });
      },
    );
    await t.test('valores, datas e campos protegidos rejeitados', async () => {
      for (const change of [
        { expectedAmount: null, amount: null },
        { expectedAmount: -1 },
        { amount: 0 },
        { amount: '0.00' },
        { amount: '-0.01' },
        { amount: '1.001' },
        { transactionDate: '2026-02-30' },
        { dueDate: '2026-13-01' },
        { status: 'PAID' },
        { competenceDate: '2026-09-01' },
        { createdBy: users[1] },
        { workspaceId: workspaces[1] },
        { creditCardId: randomUUID() },
        { categoryId: incomes[0].id },
        { accountId: accounts[1].id },
        { categoryId: expenses[1].id },
      ])
        await call('/transactions', {
          method: 'POST',
          expected: 400,
          body: { ...payload(), ...change },
        });
      await call('/transactions/' + expense.id, {
        method: 'PATCH',
        body: { expectedAmount: null, amount: null },
        expected: 400,
      });
      await call('/transactions/' + expense.id, {
        method: 'PATCH',
        body: {},
        expected: 400,
      });
      const owner = await db.workspaceMember.findFirst({
        where: { workspaceId: workspaces[1] },
      });
      await call('/transactions', {
        method: 'POST',
        expected: 400,
        body: { ...payload(), ownerMemberId: owner.id },
      });
    });
    await t.test(
      'vencimento recalcula competência; filtros mensais e combinados',
      async () => {
        const updated = await call('/transactions/' + expense.id, {
          method: 'PATCH',
          body: { dueDate: '2026-11-11' },
        });
        assert.equal(updated.competenceDate, '2026-11-01');
        assert.deepEqual(
          (await call('/transactions?month=2026-10')).map((r) => r.id),
          [income.id],
        );
        assert.equal(
          (
            await call(
              '/transactions?month=2026-11&type=EXPENSE&accountId=' +
                accounts[0].id +
                '&categoryId=' +
                expenses[0].id +
                '&search=energia',
            )
          ).some((r) => r.id === expense.id),
          true,
        );
        await call('/transactions/' + expense.id, {
          method: 'PATCH',
          body: { dueDate: '2026-10-10', amount: '217.30' },
        });
        const summary = await call('/transactions/summary?month=2026-10');
        assert.deepEqual(summary, {
          income: { expected: '5000.00', realized: '0.00' },
          expense: { expected: '200.00', realized: '0.00' },
        });
        for (const path of [
          '/transactions?month=2026-13',
          '/transactions/summary',
          '/transactions?status=INVALID',
        ])
          await call(path, { expected: 400 });
      },
    );
    await t.test(
      'baixa exige timestamp e valores positivos; realizado e edição conservadora',
      async () => {
        for (const body of [
          { amount: '217.30' },
          { amount: null, paidAt: '2026-10-10T12:00:00-03:00' },
          { amount: 0, paidAt: '2026-10-10T12:00:00-03:00' },
          { paidAt: '2026-10-10' },
        ])
          await call('/transactions/' + expense.id + '/pay', {
            method: 'POST',
            body,
            expected: 400,
          });
        expense = await call('/transactions/' + expense.id + '/pay', {
          method: 'POST',
          body: { amount: '217.30', paidAt: '2026-10-10T14:30:00-03:00' },
        });
        assert.equal(expense.status, 'PAID');
        assert.equal(expense.amount, '217.30');
        assert.equal(expense.expectedAmount, '200.00');
        assert.equal(expense.paidAt, '2026-10-10T17:30:00.000Z');
        await call('/transactions/' + expense.id, {
          method: 'PATCH',
          body: { amount: '1' },
          expected: 409,
        });
        await call('/transactions/' + expense.id, {
          method: 'DELETE',
          expected: 409,
        });
        await call('/transactions/' + expense.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-10T12:00:00Z' },
          expected: 409,
        });
        income = await call('/transactions/' + income.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-05T12:00:00-03:00' },
        });
        assert.equal(income.amount, '5000.00');
        assert.deepEqual(await call('/transactions/summary?month=2026-10'), {
          income: { expected: '5000.00', realized: '5000.00' },
          expense: { expected: '200.00', realized: '217.30' },
        });
      },
    );
    await t.test(
      'reabertura preserva amount e baixa usa valor conhecido antes do previsto',
      async () => {
        const row = await call('/transactions/' + expense.id + '/reopen', {
          method: 'POST',
          body: {},
        });
        assert.equal(row.paidAt, null);
        assert.equal(row.amount, '217.30');
        assert.equal(
          (await db.transaction.findUnique({ where: { id: row.id } })).status,
          'PENDING',
        );
        assert.equal(
          (await call('/transactions/summary?month=2026-10')).expense.realized,
          '0.00',
        );
        await call('/transactions/' + expense.id + '/reopen', {
          method: 'POST',
          body: {},
          expected: 409,
        });
        const paid = await call('/transactions/' + expense.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-10T12:00:00Z' },
        });
        assert.equal(paid.amount, '217.30');
        await call('/transactions/' + expense.id + '/reopen', {
          method: 'POST',
          body: {},
        });
      },
    );
    await t.test(
      'cancelamento preserva histórico e exclui resumo',
      async () => {
        const row = await call('/transactions/' + expense.id, {
          method: 'DELETE',
        });
        assert.equal(row.status, 'CANCELLED');
        assert.ok(await db.transaction.findUnique({ where: { id: row.id } }));
        assert.deepEqual(
          (await call('/transactions/summary?month=2026-10')).expense,
          { expected: '0.00', realized: '0.00' },
        );
        await call('/transactions/' + expense.id, { method: 'DELETE' });
        await call('/transactions/' + expense.id, {
          method: 'PATCH',
          body: { description: 'mudança' },
          expected: 409,
        });
        await call('/transactions/' + expense.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-10-10T12:00:00Z' },
          expected: 409,
        });
        await call('/transactions/' + expense.id + '/reopen', {
          method: 'POST',
          body: {},
          expected: 409,
        });
      },
    );
    await t.test(
      'atraso efetivo sem persistência e filtros coerentes',
      async () => {
        const past = await create({ ...payload(), dueDate: '2000-01-01' });
        assert.equal(past.status, 'OVERDUE');
        assert.equal(
          (await db.transaction.findUnique({ where: { id: past.id } })).status,
          'PENDING',
        );
        assert.equal(
          (await call('/transactions?status=OVERDUE')).some(
            (r) => r.id === past.id,
          ),
          true,
        );
        assert.equal(
          (await call('/transactions?status=PENDING')).some(
            (r) => r.id === past.id,
          ),
          false,
        );
        const future = await create({ ...payload(), dueDate: '2099-01-01' });
        assert.equal(future.status, 'PENDING');
        const paid = await call('/transactions/' + past.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2000-01-02T12:00:00Z' },
        });
        assert.equal(paid.status, 'PAID');
      },
    );
    await t.test(
      'históricos inativos permanecem válidos; novos vínculos ativos e categoria estável',
      async () => {
        await call('/accounts/' + accounts[0].id, { method: 'DELETE' });
        await call('/categories/' + expenses[0].id, { method: 'DELETE' });
        await call('/transactions', {
          method: 'POST',
          body: payload(),
          expected: 400,
        });
        await call('/categories/' + expenses[0].id, {
          method: 'PATCH',
          body: { type: 'INCOME' },
          expected: 400,
        });
        const history = (await call('/transactions?month=2099-01'))[0];
        await call('/transactions/' + history.id, {
          method: 'PATCH',
          body: { description: 'Histórico preservado' },
        });
        await call('/accounts/' + accounts[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
        await call('/categories/' + expenses[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
      },
    );
    await t.test(
      'isolamento de leitura, edição, baixa, reabertura, cancelamento e VIEWER',
      async () => {
        for (const [suffix, method, body] of [
          ['', 'GET'],
          ['', 'PATCH', { description: 'Invasão' }],
          ['/pay', 'POST', { paidAt: '2026-10-10T12:00:00Z' }],
          ['/reopen', 'POST', {}],
          ['', 'DELETE'],
        ])
          await call('/transactions/' + other.id + suffix, {
            method,
            body,
            expected: 404,
          });
        assert.equal(
          (await call('/transactions?accountId=' + accounts[1].id)).length,
          0,
        );
        await call('/transactions', { ws: workspaces[1], expected: 403 });
        const denied = await fetch(base + '/transactions');
        assert.equal(denied.status, 401);
        await db.workspaceMember.updateMany({
          where: { workspaceId: workspaces[0], userId: users[0] },
          data: { role: 'VIEWER' },
        });
        await call('/transactions');
        await call('/transactions', {
          method: 'POST',
          body: payload(),
          expected: 403,
        });
        await call('/transactions/' + income.id + '/reopen', {
          method: 'POST',
          body: {},
          expected: 403,
        });
        await db.workspaceMember.updateMany({
          where: { workspaceId: workspaces[0], userId: users[0] },
          data: { role: 'OWNER' },
        });
      },
    );
    await t.test(
      'baixas concorrentes não sobrescrevem uma à outra',
      async () => {
        const row = await create(payload());
        const responses = await Promise.all(
          [10, 20].map((amount) =>
            fetch(base + '/transactions/' + row.id + '/pay', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens[0]}`,
                'X-Workspace-Id': workspaces[0],
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ amount, paidAt: '2026-10-10T12:00:00Z' }),
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      },
    );
  } finally {
    await db.$transaction(async (tx) => {
      const fixtures = await tx.user.findMany({
        where: { authUserId: { in: ids } },
        select: { id: true },
      });
      const userIds = fixtures.map((u) => u.id);
      const spaces = await tx.workspace.findMany({
        where: { ownerId: { in: userIds } },
        select: { id: true },
      });
      const wsIds = spaces.map((w) => w.id);
      await tx.transaction.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.account.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await tx.category.updateMany({
        where: { workspaceId: { in: wsIds } },
        data: { parentId: null },
      });
      await tx.category.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await tx.workspaceMember.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await app.close();
    await signer.close();
  }
});
