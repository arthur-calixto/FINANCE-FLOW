import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('Parcelamentos: atomicidade, soma, faturas, limite e isolamento', async (t) => {
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
      ids.map((id) => signer.token(id, `${id}@installments-test.invalid`)),
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
          body: { name: 'Despesa', type: 'EXPENSE' },
        }),
      );
      cards.push(
        await call('/credit-cards', {
          who,
          method: 'POST',
          expected: 201,
          body: {
            name: 'Nubank',
            creditLimit: '5000',
            closingDay: 25,
            dueDay: 10,
          },
        }),
      );
    }
    const common = (changes = {}) => ({
      description: 'Curso',
      type: 'EXPENSE',
      totalAmount: '1000',
      installmentCount: 3,
      transactionDate: '2026-09-29',
      firstDueDate: '2026-10-10',
      accountId: accounts[0].id,
      categoryId: categories[0].id,
      ...changes,
    });
    const cardBody = (changes = {}) => ({
      description: 'Notebook',
      totalAmount: '1000',
      installmentCount: 10,
      transactionDate: '2026-09-29',
      categoryId: categories[0].id,
      ...changes,
    });
    const cardPath = '/credit-cards/' + cards[0].id;
    let group, cardGroup;
    await t.test('prévia, EXPENSE e INCOME, soma e numeração', async () => {
      const plan = await call('/installments/preview', {
        method: 'POST',
        body: {
          totalAmount: '1000',
          installmentCount: 3,
          firstDueDate: '2026-10-10',
        },
      });
      assert.deepEqual(
        plan.installments.map((p) => p.amount),
        ['333.33', '333.33', '333.34'],
      );
      group = await call('/installments', {
        method: 'POST',
        expected: 201,
        body: common(),
      });
      assert.equal(group.installments.length, 3);
      assert.deepEqual(
        group.installments.map((p) => p.expectedAmount),
        ['333.33', '333.33', '333.34'],
      );
      assert.deepEqual(
        group.installments.map((p) => p.installmentNumber),
        [1, 2, 3],
      );
      assert.equal(group.installments[0].description, 'Curso 1/3');
      assert.equal(group.type, 'EXPENSE');
      assert.equal(group.origin, 'ACCOUNT');
      const income = await call('/categories', {
        method: 'POST',
        expected: 201,
        body: { name: 'Venda', type: 'INCOME' },
      });
      const sale = await call('/installments', {
        method: 'POST',
        expected: 201,
        body: common({
          type: 'INCOME',
          categoryId: income.id,
          totalAmount: '3000',
          firstDueDate: '2027-01-31',
        }),
      });
      assert.equal(sale.type, 'INCOME');
      assert.deepEqual(
        sale.installments.map((p) => p.dueDate),
        ['2027-01-31', '2027-02-28', '2027-03-31'],
      );
      assert.equal(
        (await call('/transactions?month=2026-10'))[0].installmentGroup.id,
        group.id,
      );
      assert.equal(
        (await call('/transactions/summary?month=2026-10')).expense.expected,
        '333.33',
      );
    });
    await t.test('validações e falhas não criam grupos parciais', async () => {
      const before = await db.installmentGroup.count({
        where: { workspaceId: workspaces[0] },
      });
      for (const data of [
        { totalAmount: '0' },
        { totalAmount: '-1' },
        { installmentCount: 0 },
        { installmentCount: 121 },
        { totalAmount: '0.01', installmentCount: 2 },
        { accountId: accounts[1].id },
        { categoryId: categories[1].id },
        { type: 'INCOME' },
        { firstDueDate: '2026-02-30' },
        { firstDueDate: '9999-12-01' },
        { workspaceId: workspaces[1] },
      ])
        await call('/installments', {
          method: 'POST',
          expected: 400,
          body: common(data),
        });
      await call('/accounts/' + accounts[0].id, { method: 'DELETE' });
      await call('/installments', {
        method: 'POST',
        expected: 400,
        body: common(),
      });
      await call('/accounts/' + accounts[0].id, {
        method: 'PATCH',
        body: { isActive: true },
      });
      assert.equal(
        await db.installmentGroup.count({
          where: { workspaceId: workspaces[0] },
        }),
        before,
      );
      const max = await call('/installments', {
        method: 'POST',
        expected: 201,
        body: common({
          installmentCount: 120,
          totalAmount: '1.20',
          firstDueDate: '2040-01-31',
        }),
      });
      assert.equal(max.installments.length, 120);
      assert.equal(max.installments[119].expectedAmount, '0.01');
    });
    await t.test(
      'baixa comum, estrutura imutável e cancelamento futuro preserva pagas',
      async () => {
        const first = group.installments[0],
          second = group.installments[1];
        await call('/transactions/' + second.id + '/pay', {
          method: 'POST',
          body: { paidAt: '2026-11-10T12:00:00Z' },
        });
        await call('/transactions/' + first.id, {
          method: 'PATCH',
          expected: 409,
          body: { dueDate: '2028-01-01' },
        });
        await call('/installment-groups/' + group.id + '/cancel', {
          method: 'POST',
          body: { scope: 'FROM', fromInstallmentNumber: 1 },
        });
        const detail = await call('/installment-groups/' + group.id);
        assert.deepEqual(
          detail.installments.map((p) => p.status),
          ['CANCELLED', 'PAID', 'CANCELLED'],
        );
        await call('/installment-groups/' + group.id + '/cancel', {
          method: 'POST',
          expected: 409,
          body: { scope: 'ONE', fromInstallmentNumber: 2 },
        });
        const one = await call('/installments', {
          method: 'POST',
          expected: 201,
          body: common({ firstDueDate: '2029-01-10' }),
        });
        await call('/installment-groups/' + one.id + '/cancel', {
          method: 'POST',
          body: { scope: 'ONE', fromInstallmentNumber: 2 },
        });
        const after = await call('/installment-groups/' + one.id);
        assert.equal(after.installments[1].status, 'CANCELLED');
        assert.equal(after.installments[0].status, 'PENDING');
      },
    );
    await t.test(
      'cartão 10x em faturas consecutivas e limite integral',
      async () => {
        const preview = await call(cardPath + '/installments/preview', {
          method: 'POST',
          body: {
            totalAmount: '1000',
            installmentCount: 10,
            transactionDate: '2026-09-29',
          },
        });
        assert.equal(preview.availableBefore, '5000.00');
        assert.equal(preview.availableAfter, '4000.00');
        cardGroup = await call(cardPath + '/installments', {
          method: 'POST',
          expected: 201,
          body: cardBody(),
        });
        assert.equal(cardGroup.installments.length, 10);
        assert.equal(cardGroup.installments[0].competenceDate, '2026-11-01');
        assert.equal(cardGroup.installments[9].competenceDate, '2027-08-01');
        assert.equal(
          new Set(cardGroup.installments.map((p) => p.invoiceId)).size,
          10,
        );
        assert.ok(
          cardGroup.installments.every(
            (p) => p.accountId === null && p.amount === '100.00',
          ),
        );
        assert.equal((await call(cardPath)).usedLimit, '1000.00');
        assert.equal(
          (await call('/transactions/summary?month=2026-11')).expense.expected,
          '433.33',
        );
        await call(cardPath + '/installments', {
          method: 'POST',
          expected: 409,
          body: cardBody({ totalAmount: '4500' }),
        });
        await call(cardPath + '/purchases/' + cardGroup.installments[0].id, {
          method: 'DELETE',
          expected: 404,
        });
      },
    );
    await t.test(
      'pagamento libera só a parcela, sem despesa duplicada',
      async () => {
        const first = cardGroup.installments[0];
        const count = await db.transaction.count({
          where: { workspaceId: workspaces[0] },
        });
        await call(cardPath + '/invoices/' + first.invoiceId + '/pay', {
          method: 'POST',
          body: { accountId: accounts[0].id, paidAt: '2026-11-10T12:00:00Z' },
        });
        assert.equal((await call(cardPath)).usedLimit, '900.00');
        assert.equal((await call(cardPath)).availableLimit, '4100.00');
        const detail = await call('/installment-groups/' + cardGroup.id);
        assert.equal(detail.installments[0].status, 'PAID');
        assert.ok(
          detail.installments.slice(1).every((p) => p.status === 'PENDING'),
        );
        assert.equal(
          (await call('/transactions/summary?month=2026-11')).expense.realized,
          '433.33',
        );
        assert.equal(
          await db.transaction.count({ where: { workspaceId: workspaces[0] } }),
          count,
        );
        await call('/installment-groups/' + cardGroup.id, {
          method: 'DELETE',
          expected: 409,
        });
      },
    );
    await t.test(
      'rollback em fatura paga e cancelamento completo antes da baixa',
      async () => {
        const before = await db.installmentGroup.count({
            where: { workspaceId: workspaces[0] },
          }),
          invoicesBefore = await db.creditCardInvoice.count({
            where: { workspaceId: workspaces[0] },
          });
        // Outubro seria criado, mas novembro já está pago: nada da operação pode restar.
        await call(cardPath + '/installments', {
          method: 'POST',
          expected: 409,
          body: cardBody({
            transactionDate: '2026-09-24',
            installmentCount: 3,
          }),
        });
        assert.equal(
          await db.installmentGroup.count({
            where: { workspaceId: workspaces[0] },
          }),
          before,
        );
        assert.equal(
          await db.creditCardInvoice.count({
            where: { workspaceId: workspaces[0] },
          }),
          invoicesBefore,
        );
        const newGroup = await call(cardPath + '/installments', {
          method: 'POST',
          expected: 201,
          body: cardBody({
            transactionDate: '2026-10-29',
            totalAmount: '100',
            installmentCount: 3,
          }),
        });
        assert.equal(
          newGroup.installments[0].invoiceId,
          cardGroup.installments[1].invoiceId,
        );
        await call('/installment-groups/' + newGroup.id, { method: 'DELETE' });
        assert.equal((await call(cardPath)).usedLimit, '900.00');
        assert.ok(
          (await call('/installment-groups/' + newGroup.id)).installments.every(
            (p) => p.status === 'CANCELLED',
          ),
        );
      },
    );
    await t.test(
      'concorrência respeita total e unicidade de parcelas/faturas',
      async () => {
        const small = await call('/credit-cards', {
          method: 'POST',
          expected: 201,
          body: {
            name: 'Pequeno',
            creditLimit: '100',
            closingDay: 25,
            dueDay: 10,
          },
        });
        const results = await Promise.all(
          [1, 2].map(() =>
            fetch(base + '/credit-cards/' + small.id + '/installments', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens[0]}`,
                'X-Workspace-Id': workspaces[0],
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(
                cardBody({ totalAmount: '60', installmentCount: 3 }),
              ),
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          await db.creditCardInvoice.count({
            where: { creditCardId: small.id },
          }),
          3,
        );
        assert.equal(
          await db.transaction.count({ where: { creditCardId: small.id } }),
          3,
        );
      },
    );
    await t.test(
      'valor individual e retroativo comum preservam plano e histórico',
      async () => {
        for (const [amount, count, total] of [
          ['100', 5, '500.00'],
          ['333.33', 3, '999.99'],
        ]) {
          const g = await call('/installments', {
            method: 'POST',
            expected: 201,
            body: common({
              amountMode: 'INSTALLMENT',
              totalAmount: undefined,
              installmentAmount: amount,
              installmentCount: count,
              firstDueDate: '2035-10-10',
            }),
          });
          assert.equal(g.totalAmount, total);
          assert.equal(g.controlledAmount, total);
          assert.equal(g.startingInstallment, 1);
          assert.ok(
            g.installments.every(
              (p) => p.expectedAmount === Number(amount).toFixed(2),
            ),
          );
        }
        const g = await call('/installments', {
          method: 'POST',
          expected: 201,
          body: common({
            amountMode: 'INSTALLMENT',
            totalAmount: undefined,
            installmentAmount: '500',
            installmentCount: 12,
            startingInstallment: 7,
            firstDueDate: '2036-10-15',
          }),
        });
        assert.equal(g.totalAmount, '6000.00');
        assert.equal(g.controlledAmount, '3000.00');
        assert.equal(g.previousInstallmentCount, 6);
        assert.equal(g.controlledInstallmentCount, 6);
        assert.deepEqual(
          g.installments.map((p) => p.installmentNumber),
          [7, 8, 9, 10, 11, 12],
        );
        assert.equal(g.installments[0].dueDate, '2036-10-15');
        assert.equal(g.installments[5].dueDate, '2037-03-15');
        assert.equal(
          (await call('/transactions/summary?month=2036-09')).expense.expected,
          '0.00',
        );
        assert.equal(
          (await call('/transactions/summary?month=2036-10')).expense.expected,
          '500.00',
        );
        await call('/transactions/' + g.installments[1].id + '/pay', {
          method: 'POST',
          body: { amount: '499', paidAt: '2036-11-15T12:00:00Z' },
        });
        await call('/installment-groups/' + g.id + '/cancel', {
          method: 'POST',
          expected: 400,
          body: { scope: 'FROM', fromInstallmentNumber: 1 },
        });
        const cancelled = await call(
          '/installment-groups/' + g.id + '/cancel',
          { method: 'POST', body: { scope: 'FROM', fromInstallmentNumber: 7 } },
        );
        assert.equal(cancelled.controlledAmount, '3000.00');
        assert.equal(cancelled.startingInstallment, 7);
        assert.deepEqual(
          cancelled.installments.map((p) => p.status),
          [
            'CANCELLED',
            'PAID',
            'CANCELLED',
            'CANCELLED',
            'CANCELLED',
            'CANCELLED',
          ],
        );
        const residual = await call('/installments', {
          method: 'POST',
          expected: 201,
          body: common({
            amountMode: 'TOTAL',
            totalAmount: '100',
            startingInstallment: 3,
            firstDueDate: '2038-10-10',
          }),
        });
        assert.equal(residual.installments.length, 1);
        assert.equal(residual.installments[0].installmentNumber, 3);
        assert.equal(residual.installments[0].expectedAmount, '33.34');
        assert.equal(residual.totalAmount, '100.00');
        assert.equal(residual.controlledAmount, '33.34');
        const income = await call('/categories', {
          method: 'POST',
          expected: 201,
          body: { name: 'Receita retroativa', type: 'INCOME' },
        });
        const revenue = await call('/installments', {
          method: 'POST',
          expected: 201,
          body: common({
            type: 'INCOME',
            categoryId: income.id,
            startingInstallment: 3,
            firstDueDate: '2038-10-10',
          }),
        });
        assert.equal(revenue.type, 'INCOME');
        assert.equal(revenue.installments.length, 1);
        for (const patch of [
          { startingInstallment: 4 },
          { amountMode: 'INSTALLMENT', installmentAmount: '10' },
          {
            amountMode: 'INSTALLMENT',
            totalAmount: undefined,
            installmentAmount: '99999999999999999.99',
          },
          { startingInstallment: 2, accountId: accounts[1].id },
          { startingInstallment: 2, categoryId: categories[1].id },
        ])
          await call('/installments', {
            method: 'POST',
            expected: 400,
            body: common(patch),
          });
        await call('/installment-groups/' + g.id, { who: 1, expected: 404 });
        await call('/transactions/' + g.installments[0].id, {
          who: 1,
          expected: 404,
        });
      },
    );
    await t.test(
      'cartão em andamento cria somente faturas controladas e libera limite normalmente',
      async () => {
        const retroCard = await call('/credit-cards', {
          method: 'POST',
          expected: 201,
          body: {
            name: 'Retroativo',
            creditLimit: '2000',
            closingDay: 25,
            dueDay: 10,
          },
        });
        const path = '/credit-cards/' + retroCard.id;
        const payload = {
          description: 'Notebook retroativo',
          amountMode: 'INSTALLMENT',
          installmentAmount: '300',
          installmentCount: 10,
          startingInstallment: 5,
          firstInvoiceMonth: '2032-10',
          categoryId: categories[0].id,
        };
        const preview = await call(path + '/installments/preview', {
          method: 'POST',
          body: {
            amountMode: payload.amountMode,
            installmentAmount: payload.installmentAmount,
            installmentCount: 10,
            startingInstallment: 5,
            firstInvoiceMonth: '2032-10',
          },
        });
        assert.equal(preview.totalAmount, '3000.00');
        assert.equal(preview.controlledAmount, '1800.00');
        assert.equal(preview.availableAfter, '200.00');
        const g = await call(path + '/installments', {
          method: 'POST',
          expected: 201,
          body: payload,
        });
        assert.equal(g.totalAmount, '3000.00');
        assert.equal(g.controlledAmount, '1800.00');
        assert.equal(g.purchaseDate, '2032-10-01');
        assert.deepEqual(
          g.installments.map((p) => p.installmentNumber),
          [5, 6, 7, 8, 9, 10],
        );
        assert.deepEqual(
          g.installments.map((p) => p.competenceDate),
          [
            '2032-10-01',
            '2032-11-01',
            '2032-12-01',
            '2033-01-01',
            '2033-02-01',
            '2033-03-01',
          ],
        );
        assert.equal(
          await db.transaction.count({ where: { installmentGroupId: g.id } }),
          6,
        );
        assert.equal(
          await db.creditCardInvoice.count({
            where: { creditCardId: retroCard.id },
          }),
          6,
        );
        assert.equal((await call(path)).usedLimit, '1800.00');
        assert.equal(
          (await call('/transactions/summary?month=2032-09')).expense.expected,
          '0.00',
        );
        assert.equal(
          (await call('/transactions/summary?month=2032-10')).expense.expected,
          '300.00',
        );
        const reuse = await call(path + '/installments', {
          method: 'POST',
          expected: 201,
          body: {
            ...payload,
            installmentAmount: '100',
            startingInstallment: 10,
            transactionDate: '2000-01-01',
          },
        });
        assert.equal(reuse.installments.length, 1);
        assert.equal(
          reuse.installments[0].invoiceId,
          g.installments[0].invoiceId,
        );
        await call('/installment-groups/' + reuse.id, { method: 'DELETE' });
        const meta = await call('/installment-groups/' + reuse.id);
        assert.equal(meta.controlledAmount, '100.00');
        assert.equal(meta.startingInstallment, 10);
        await call(path + '/installments', {
          method: 'POST',
          expected: 409,
          body: payload,
        });
        await call(path + '/invoices/' + g.installments[0].invoiceId + '/pay', {
          method: 'POST',
          body: { accountId: accounts[0].id, paidAt: '2032-10-10T12:00:00Z' },
        });
        assert.equal((await call(path)).usedLimit, '1500.00');
        assert.equal(
          (await call('/transactions/summary?month=2032-10')).expense.realized,
          '300.00',
        );
        await call('/installment-groups/' + g.id, {
          method: 'DELETE',
          expected: 409,
        });
        // Falha na segunda fatura paga desfaz a fatura nova da primeira posição.
        await call(path + '/installments', {
          method: 'POST',
          expected: 409,
          body: {
            ...payload,
            installmentAmount: '1',
            firstInvoiceMonth: '2032-09',
          },
        });
        assert.equal(
          await db.creditCardInvoice.count({
            where: { creditCardId: retroCard.id },
          }),
          6,
        );
        for (const patch of [
          { firstInvoiceMonth: undefined },
          { firstInvoiceMonth: '2032-13' },
          { startingInstallment: 11 },
          { startingInstallment: 1 },
          { totalAmount: '3000' },
          { categoryId: categories[1].id },
        ])
          await call(path + '/installments', {
            method: 'POST',
            expected: 400,
            body: { ...payload, ...patch },
          });
        await call('/credit-cards/' + cards[1].id + '/installments', {
          method: 'POST',
          expected: 404,
          body: payload,
        });
        await call(path + '/installments/preview', {
          who: 1,
          method: 'POST',
          expected: 404,
          body: {
            amountMode: 'INSTALLMENT',
            installmentAmount: '300',
            installmentCount: 10,
            startingInstallment: 5,
            firstInvoiceMonth: '2032-10',
          },
        });
        await call(path + '/invoices/' + g.installments[0].invoiceId, {
          who: 1,
          expected: 404,
        });
      },
    );
    await t.test('cross-tenant, papéis e proteção de vínculos', async () => {
      await call('/installment-groups/' + group.id, { who: 1, expected: 404 });
      await call('/installment-groups/' + group.id + '/cancel', {
        who: 1,
        method: 'POST',
        expected: 404,
        body: { scope: 'ONE', fromInstallmentNumber: 1 },
      });
      await call('/installment-groups/' + cardGroup.id, {
        who: 1,
        method: 'DELETE',
        expected: 404,
      });
      await call('/credit-cards/' + cards[1].id + '/installments', {
        method: 'POST',
        expected: 404,
        body: cardBody(),
      });
      await call(cardPath + '/installments', {
        method: 'POST',
        expected: 400,
        body: cardBody({ categoryId: categories[1].id }),
      });
      await call('/transactions/' + cardGroup.installments[0].id, {
        who: 1,
        expected: 404,
      });
      await call(
        cardPath + '/invoices/' + cardGroup.installments[0].invoiceId,
        { who: 1, expected: 404 },
      );
      await db.workspaceMember.updateMany({
        where: { workspaceId: workspaces[0], userId: users[0] },
        data: { role: 'VIEWER' },
      });
      await call('/installment-groups/' + group.id);
      await call('/installments', {
        method: 'POST',
        expected: 403,
        body: common(),
      });
      await call(cardPath + '/installments', {
        method: 'POST',
        expected: 403,
        body: cardBody(),
      });
    });
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
      await tx.installmentGroup.deleteMany({
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
