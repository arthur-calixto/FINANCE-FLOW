import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('Cartões e faturas: limite, pagamento, concorrência e isolamento', async (t) => {
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
      ids.map((id) => signer.token(id, `${id}@cards-test.invalid`)),
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
      categories = [],
      cards = [];
    const cardBody = {
      name: 'Nubank Mastercard',
      creditLimit: '5000',
      closingDay: 25,
      dueDay: 10,
    };
    for (let who = 0; who < 2; who++) {
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
          body: { name: 'Compras', type: 'EXPENSE' },
        }),
      );
      cards.push(
        await call('/credit-cards', {
          who,
          method: 'POST',
          expected: 201,
          body: cardBody,
        }),
      );
    }
    const path = '/credit-cards/' + cards[0].id;
    const body = (changes = {}) => ({
      description: 'Supermercado',
      amount: '350.00',
      transactionDate: '2026-09-24',
      categoryId: categories[0].id,
      ...changes,
    });
    const purchase = (data = body()) =>
      call(path + '/purchases', { method: 'POST', expected: 201, body: data });
    let october, november, other;
    await t.test('CRUD, dias, limite e inatividade', async () => {
      for (const change of [
        { creditLimit: -1 },
        { closingDay: 0 },
        { closingDay: 32 },
        { dueDay: 0 },
        { dueDay: 32 },
        { creditLimit: 'NaN' },
        { workspaceId: workspaces[1] },
      ])
        await call('/credit-cards', {
          method: 'POST',
          expected: 400,
          body: { ...cardBody, ...change },
        });
      assert.equal(
        (await call(path, { method: 'PATCH', body: { name: 'Nubank' } })).name,
        'Nubank',
      );
      await call(path, { method: 'DELETE' });
      assert.equal((await call('/credit-cards')).length, 0);
      assert.equal(
        (await call('/credit-cards?includeInactive=true')).length,
        1,
      );
      await call(path + '/purchases', {
        method: 'POST',
        body: body(),
        expected: 400,
      });
      await call(path, { method: 'PATCH', body: { isActive: true } });
    });
    await t.test(
      'preview e compra geram faturas distintas; sem conta bancária',
      async () => {
        const preview = await call(
          path + '/purchase-preview?transactionDate=2026-09-24',
        );
        assert.deepEqual(preview, {
          referenceMonth: '2026-10-01',
          closingDate: '2026-09-25',
          dueDate: '2026-10-10',
        });
        october = await purchase();
        november = await purchase(
          body({
            description: 'Combustível',
            amount: '200',
            transactionDate: '2026-09-25',
          }),
        );
        assert.equal(october.accountId, null);
        assert.equal(october.status, 'PENDING');
        assert.equal(october.competenceDate, '2026-10-01');
        assert.equal(october.expectedAmount, '350.00');
        assert.equal(november.competenceDate, '2026-11-01');
        assert.notEqual(october.invoiceId, november.invoiceId);
        const card = await call(path);
        assert.equal(card.usedLimit, '550.00');
        assert.equal(card.availableLimit, '4450.00');
        assert.equal(card.currentInvoice.id, october.invoiceId);
        const list = await call(path + '/invoices?month=2026-10');
        assert.equal(list.length, 1);
        assert.equal(list[0].total, '350.00');
        const general = await call('/transactions?month=2026-10');
        assert.equal(general[0].creditCard.id, cards[0].id);
        assert.equal(general[0].account, null);
      },
    );
    await t.test(
      'categoria, campos protegidos, limite e calendário editado bloqueados',
      async () => {
        const income = await call('/categories', {
          method: 'POST',
          expected: 201,
          body: { name: 'Receita', type: 'INCOME' },
        });
        for (const change of [
          { categoryId: income.id },
          { categoryId: categories[1].id },
          { amount: 0 },
          { amount: -1 },
          { invoiceId: october.invoiceId },
          { accountId: accounts[0].id },
          { creditCardId: cards[1].id },
          { competenceDate: '2026-01-01' },
        ])
          await call(path + '/purchases', {
            method: 'POST',
            body: body(change),
            expected: 400,
          });
        await call(path + '/purchases', {
          method: 'POST',
          body: body({ amount: '4450.01' }),
          expected: 409,
        });
        await call(path, {
          method: 'PATCH',
          body: { creditLimit: '549.99' },
          expected: 409,
        });
        await call(path, {
          method: 'PATCH',
          body: { closingDay: 24 },
          expected: 409,
        });
        await call('/categories/' + categories[0].id, { method: 'DELETE' });
        await call(path + '/purchases', {
          method: 'POST',
          body: body(),
          expected: 400,
        });
        await call('/categories/' + categories[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
      },
    );
    await t.test(
      'concorrência cria uma fatura e não ultrapassa limite',
      async () => {
        const small = await call('/credit-cards', {
          method: 'POST',
          expected: 201,
          body: { ...cardBody, name: 'Pequeno', creditLimit: '100' },
        });
        const requests = await Promise.all(
          [1, 2].map(() =>
            fetch(base + `/credit-cards/${small.id}/purchases`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens[0]}`,
                'X-Workspace-Id': workspaces[0],
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body({ amount: '60' })),
            }),
          ),
        );
        assert.deepEqual(requests.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          await db.creditCardInvoice.count({
            where: { creditCardId: small.id },
          }),
          1,
        );
        assert.equal(
          (await call('/credit-cards/' + small.id)).usedLimit,
          '60.00',
        );
        const purchases = await Promise.all(
          [1, 2].map(() =>
            purchase(body({ transactionDate: '2026-11-01', amount: '10' })),
          ),
        );
        assert.equal(purchases[0].invoiceId, purchases[1].invoiceId);
        assert.equal(
          await db.creditCardInvoice.count({
            where: {
              creditCardId: cards[0].id,
              referenceMonth: new Date('2026-12-01'),
            },
          }),
          1,
        );
        for (const p of purchases)
          await call(path + '/purchases/' + p.id, { method: 'DELETE' });
      },
    );
    await t.test(
      'cancelamento libera limite e remove de totais mantendo histórico',
      async () => {
        const cancelled = await purchase(body({ amount: '25' }));
        assert.equal(cancelled.invoiceId, october.invoiceId);
        await call(path + '/purchases/' + cancelled.id, { method: 'DELETE' });
        assert.equal((await call(path)).usedLimit, '550.00');
        const invoice = await call(path + '/invoices/' + october.invoiceId);
        assert.equal(invoice.total, '350.00');
        assert.equal(invoice.purchaseCount, 1);
        assert.equal(invoice.purchases.length, 2);
        assert.equal(
          (await call('/transactions/summary?month=2026-10')).expense.expected,
          '410.00',
        ); // inclui 60 do segundo cartão
      },
    );
    await t.test(
      'isolamento de cartão, compra, fatura, pagamento e conta',
      async () => {
        other = await call('/credit-cards/' + cards[1].id + '/purchases', {
          who: 1,
          method: 'POST',
          expected: 201,
          body: body({ categoryId: categories[1].id }),
        });
        for (const [url, method, bodyData] of [
          [`/credit-cards/${cards[1].id}`, 'GET'],
          [`/credit-cards/${cards[1].id}`, 'PATCH', { name: 'Invadir' }],
          [`/credit-cards/${cards[1].id}`, 'DELETE'],
          [`/credit-cards/${cards[1].id}/purchases`, 'POST', body()],
          [path + '/invoices/' + other.invoiceId, 'GET'],
          [path + '/purchases/' + other.id, 'DELETE'],
          [
            path + '/invoices/' + other.invoiceId + '/pay',
            'POST',
            { accountId: accounts[0].id, paidAt: '2026-10-10T12:00:00Z' },
          ],
        ])
          await call(url, { method, body: bodyData, expected: 404 });
        await call(path + '/invoices/' + october.invoiceId + '/pay', {
          method: 'POST',
          expected: 400,
          body: { accountId: accounts[1].id, paidAt: '2026-10-10T12:00:00Z' },
        });
        await call('/transactions/' + other.id, { expected: 404 });
        await call('/transactions/' + october.id + '/pay', {
          method: 'POST',
          expected: 404,
          body: { paidAt: '2026-10-10T12:00:00Z' },
        });
      },
    );
    await t.test(
      'pagamento integral atômico sem segunda despesa e concorrência idempotente',
      async () => {
        const payPath = path + '/invoices/' + october.invoiceId + '/pay';
        const payment = {
          accountId: accounts[0].id,
          paidAt: '2026-10-10T12:00:00-03:00',
        };
        await call(payPath, {
          method: 'POST',
          body: { ...payment, amount: '349.99' },
          expected: 400,
        });
        await call('/accounts/' + accounts[0].id, { method: 'DELETE' });
        await call(payPath, { method: 'POST', body: payment, expected: 400 });
        await call('/accounts/' + accounts[0].id, {
          method: 'PATCH',
          body: { isActive: true },
        });
        const count = await db.transaction.count({
          where: { workspaceId: workspaces[0] },
        });
        const responses = await Promise.all(
          [1, 2].map(() =>
            fetch(base + payPath, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens[0]}`,
                'X-Workspace-Id': workspaces[0],
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payment),
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const invoice = await call(path + '/invoices/' + october.invoiceId);
        assert.equal(invoice.status, 'PAID');
        assert.equal(invoice.paidAmount, '350.00');
        assert.equal(invoice.paymentAccountId, accounts[0].id);
        assert.equal(invoice.paymentAccount.name, 'Conta');
        assert.equal(
          (await db.transaction.findUnique({ where: { id: october.id } }))
            .status,
          'PAID',
        );
        assert.equal(
          (await db.transaction.findUnique({ where: { id: november.id } }))
            .status,
          'PENDING',
        );
        assert.equal(
          await db.transaction.count({ where: { workspaceId: workspaces[0] } }),
          count,
        );
        const summary = await call('/transactions/summary?month=2026-10');
        assert.equal(summary.expense.expected, '410.00');
        assert.equal(summary.expense.realized, '350.00');
        const card = await call(path);
        assert.equal(card.usedLimit, '200.00');
        assert.equal(card.availableLimit, '4800.00');
        assert.equal(card.currentInvoice.id, november.invoiceId);
        const cash = await db.creditCardInvoice.aggregate({
          where: {
            workspaceId: workspaces[0],
            paymentAccountId: accounts[0].id,
            status: 'PAID',
          },
          _sum: { paidAmount: true },
        });
        assert.equal(cash._sum.paidAmount.toFixed(2), '350.00');
        await call(path + '/purchases/' + october.id, {
          method: 'DELETE',
          expected: 409,
        });
        await call(path + '/purchases', {
          method: 'POST',
          body: body(),
          expected: 409,
        });
      },
    );
    await t.test('FK de liquidação e CHECKs protegem o banco', async () => {
      for (const data of [
        { paymentAccountId: accounts[1].id },
        { paidAmount: '-1.00' },
        { paidAmount: null },
        { status: 'OPEN' },
      ])
        await assert.rejects(
          db.creditCardInvoice.update({
            where: { id: october.invoiceId },
            data,
          }),
        );
      const preserved = await db.creditCardInvoice.findUnique({
        where: { id: october.invoiceId },
      });
      assert.equal(preserved.status, 'PAID');
      assert.equal(preserved.paymentAccountId, accounts[0].id);
      assert.equal(preserved.paidAmount.toFixed(2), '350.00');
    });
    await t.test(
      'VIEWER lê mas não escreve; autenticação obrigatória',
      async () => {
        assert.equal((await fetch(base + '/credit-cards')).status, 401);
        await db.workspaceMember.updateMany({
          where: { workspaceId: workspaces[0], userId: users[0] },
          data: { role: 'VIEWER' },
        });
        await call(path);
        await call(path + '/invoices/' + october.invoiceId);
        await call(path + '/purchases', {
          method: 'POST',
          body: body(),
          expected: 403,
        });
        await call(path + '/invoices/' + november.invoiceId + '/pay', {
          method: 'POST',
          body: { accountId: accounts[0].id, paidAt: '2026-11-10T12:00:00Z' },
          expected: 403,
        });
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
      await tx.creditCardInvoice.deleteMany({
        where: { workspaceId: { in: wsIds } },
      });
      await tx.creditCard.deleteMany({ where: { workspaceId: { in: wsIds } } });
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
