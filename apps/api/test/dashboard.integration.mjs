import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma.service.js';
import { RecurrenceClock } from '../dist/resources/recurrence-calendar.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { signingServer } from './helpers/jwt.mjs';
import { dashboardScenario, cleanupDashboard } from './helpers/dashboard.mjs';
const Money = Prisma.Decimal.clone({ precision: 40 });
const sum = (values) =>
  values.reduce((a, b) => a.plus(b), new Money(0)).toFixed(2);
test('Dashboard: reconciliação financeira, caixa, cartões e isolamento', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.get(RecurrenceClock).today = () => '2026-10-05';
  const db = app.get(PrismaService).client;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const emails = ids.map((id) => id + '@dashboard-test.invalid');
  const tokens = await Promise.all(
    ids.map((id, i) => signer.token(id, emails[i])),
  );
  let ws;
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function call(
      path,
      { who = 0, workspace = ws, method = 'GET', body, expected = 200 } = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(who === null ? {} : { Authorization: `Bearer ${tokens[who]}` }),
          ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        expected,
        `${path}: ${JSON.stringify(data)}`,
      );
      return data;
    }
    const arthur = await call('/me');
    const maria = await call('/me', { who: 1 });
    await call('/me', { who: 2 });
    const family = await call('/workspaces', {
      method: 'POST',
      body: { name: 'Família Dashboard', type: 'FAMILY' },
      expected: 201,
    });
    ws = family.id;
    const invitation = await call(`/workspaces/${ws}/invitations`, {
      method: 'POST',
      body: { email: emails[1] },
      expected: 201,
    });
    await call(`/invitations/${invitation.token}/accept`, {
      who: 1,
      method: 'POST',
      expected: 201,
    });
    const dashboard = (month = '2026-10', options = {}) =>
      call(`/dashboard?month=${month}`, options);
    async function reconcile(month = '2026-10') {
      const d = await dashboard(month);
      const view = await call(`/transactions/month-view?month=${month}`);
      const summary = await call(`/transactions/summary?month=${month}`);
      for (const key of ['income', 'expense']) {
        assert.equal(d.summary[key].planned, view.summary[key].expected);
        assert.equal(d.summary[key].actual, view.summary[key].realized);
        assert.deepEqual(view.summary[key], summary[key]);
      }
      assert.equal(
        sum(d.expensesByCategory.map((c) => c.amount)),
        d.summary.expense.planned,
      );
      assert.equal(
        sum(
          ['recurring', 'creditCards', 'other'].map(
            (k) => d.expenseComposition[k],
          ),
        ),
        d.summary.expense.planned,
      );
      assert.equal(d.expenseComposition.total, d.summary.expense.planned);
      assert.equal(
        new Money(d.summary.income.planned)
          .minus(d.summary.expense.planned)
          .toFixed(2),
        d.summary.result.planned,
      );
      assert.equal(
        new Money(d.summary.income.actual)
          .minus(d.summary.expense.actual)
          .toFixed(2),
        d.summary.result.actual,
      );
      assert.deepEqual(d.evolution.at(-1), { month, ...d.summary });
      return d;
    }
    await t.test('auth, membership, PERSONAL e mês inválido', async () => {
      await dashboard('2026-10', { who: null, expected: 401 });
      await dashboard('2026-10', { who: 2, expected: 403 });
      await dashboard('2026-10', {
        who: 1,
        workspace: arthur.workspaces[0].id,
        expected: 403,
      });
      await dashboard('2026-10', {
        workspace: maria.workspaces[0].id,
        expected: 403,
      });
      await dashboard('2026-10', { workspace: '', expected: 400 });
      for (const month of ['2026-13', '2026-1', 'abc', '0001-01'])
        await dashboard(month, { expected: 400 });
      await call('/dashboard', { expected: 400 });
      await call(
        '/dashboard?month=2026-10&workspaceId=' + arthur.workspaces[0].id,
        { expected: 400 },
      );
    });
    await t.test(
      'workspace vazio retorna seis meses e zeros sem NaN',
      async () => {
        const d = await reconcile();
        assert.equal(d.hasActivity, false);
        assert.equal(d.transactionCount, 0);
        assert.equal(d.summary.result.planned, '0.00');
        assert.equal(d.accounts.totalBalance, '0.00');
        for (const key of ['upcoming', 'creditCards', 'expensesByCategory'])
          assert.deepEqual(d[key], []);
        assert.deepEqual(
          d.evolution.map((r) => r.month),
          ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
        );
      },
    );
    const fixture = await dashboardScenario(call);
    await t.test(
      'cenário Arthur/Maria: previsto, realizado, pendentes e resultado exatos',
      async () => {
        const d = await reconcile();
        assert.deepEqual(d, await dashboard('2026-10', { who: 1 }));
        assert.deepEqual(d.summary, {
          income: { planned: '6000.00', actual: '5000.00', pending: '1000.00' },
          expense: { planned: '2650.00', actual: '1800.00', pending: '850.00' },
          result: { planned: '3350.00', actual: '3200.00', pending: '150.00' },
        });
        assert.equal(d.expenseComposition.recurring, '1750.00');
        assert.equal(d.expenseComposition.creditCards, '600.00');
        assert.equal(d.expenseComposition.other, '300.00');
        assert.equal(d.accounts.totalBalance, '3500.00');
        assert.equal(
          d.accounts.items.find((a) => a.id === fixture.account.id).balance,
          '3300.00',
        );
        assert.equal(d.upcoming.length, 3);
        assert.deepEqual(
          d.upcoming.map((i) => i.description),
          ['Supermercado', 'Energia', 'Freelance'],
        );
        assert.deepEqual(
          d.upcoming.map((i) => i.origin),
          ['CREDIT_CARD', 'RECURRING', 'SINGLE'],
        );
        const cards = await call('/credit-cards');
        for (const c of d.creditCards) {
          const { usagePercentage, ...original } = c;
          assert.deepEqual(
            original,
            cards.find((r) => r.id === c.id),
          );
          assert.equal(usagePercentage, '12.0');
        }
        assert.equal(d.creditCards[0].currentInvoice.total, '600.00');
        assert.equal(d.creditCards[0].currentInvoice.dueDate, '2026-10-10');
        assert.equal(
          d.expensesByCategory.find((c) => c.id === fixture.categories.home.id)
            .amount,
          '1750.00',
        );
      },
    );
    await t.test(
      'CANCELLED não altera indicadores, limites nem vencimentos',
      async () => {
        const before = await dashboard();
        const cancelled = await fixture.transaction(
          'Cancelada',
          'EXPENSE',
          '9999',
          fixture.categories.home.id,
        );
        await call(`/transactions/${cancelled.id}/cancel`, { method: 'POST' });
        assert.deepEqual(await reconcile(), before);
      },
    );
    await t.test(
      'pagar fatura realiza compras existentes e retira caixa uma única vez',
      async () => {
        const before = await dashboard();
        const invoice = before.creditCards[0].currentInvoice;
        await call(
          `/credit-cards/${fixture.card.id}/invoices/${invoice.id}/pay`,
          {
            method: 'POST',
            body: {
              accountId: fixture.account.id,
              paidAt: '2026-10-10T12:00:00-03:00',
            },
          },
        );
        const d = await reconcile();
        assert.equal(d.transactionCount, before.transactionCount);
        assert.equal(d.summary.expense.planned, '2650.00');
        assert.equal(d.summary.expense.actual, '2400.00');
        assert.equal(d.summary.expense.pending, '250.00');
        assert.equal(d.summary.result.actual, '2600.00');
        assert.equal(d.accounts.totalBalance, '2900.00');
        assert.equal(d.creditCards[0].usedLimit, '0.00');
        assert.equal(d.creditCards[0].availableLimit, '5000.00');
        assert.equal(d.creditCards[0].currentInvoice, null);
        assert.equal(
          d.upcoming.some((i) => i.description === 'Supermercado'),
          false,
        );
      },
    );
    await t.test(
      'parcelamentos comuns e retroativos de cartão usam somente parcelas materializadas',
      async () => {
        const common = await fixture.create('/installments', {
          description: 'Notebook',
          type: 'EXPENSE',
          totalAmount: '1000',
          installmentCount: 10,
          startingInstallment: 5,
          transactionDate: '2026-06-01',
          firstDueDate: '2026-10-12',
          accountId: fixture.account.id,
          categoryId: fixture.categories.home.id,
        });
        const retroCard = await fixture.create('/credit-cards', {
          name: 'Retroativo',
          creditLimit: '5000',
          closingDay: 25,
          dueDay: 10,
        });
        const card = await fixture.create(
          `/credit-cards/${retroCard.id}/installments`,
          {
            description: 'Curso',
            amountMode: 'INSTALLMENT',
            installmentAmount: '50',
            installmentCount: 10,
            startingInstallment: 5,
            firstInvoiceMonth: '2026-10',
            categoryId: fixture.categories.home.id,
          },
        );
        assert.equal(common.installments.length, 6);
        assert.equal(card.installments.length, 6);
        const d = await reconcile();
        assert.equal(d.summary.expense.planned, '2800.00');
        assert.equal(d.expenseComposition.other, '400.00');
        assert.equal(d.expenseComposition.creditCards, '650.00');
        assert.equal(
          d.creditCards.find((c) => c.id === retroCard.id).usedLimit,
          '300.00',
        );
        assert.equal(
          d.creditCards.find((c) => c.id === retroCard.id).currentInvoice.total,
          '50.00',
        );
        assert.ok(d.upcoming.some((r) => r.origin === 'INSTALLMENT'));
        assert.equal(
          (await dashboard('2026-09')).summary.expense.planned,
          '0.00',
        );
      },
    );
    await t.test(
      'Sem categoria, amount conhecido pendente e previsto ausente preservam regra existente',
      async () => {
        const uncategorized = await fixture.transaction(
          'Sem categoria',
          'EXPENSE',
          '25',
          fixture.categories.home.id,
        );
        await db.transaction.update({
          where: { id: uncategorized.id },
          data: { categoryId: null },
        });
        await fixture.create('/transactions', {
          description: 'Realizado conhecido',
          type: 'EXPENSE',
          expectedAmount: '100',
          amount: '90',
          transactionDate: '2026-10-01',
          dueDate: '2026-10-20',
          accountId: fixture.account.id,
          categoryId: fixture.categories.home.id,
        });
        await fixture.create('/transactions', {
          description: 'Sem previsto',
          type: 'EXPENSE',
          amount: '10',
          transactionDate: '2026-10-01',
          dueDate: '2026-10-21',
          accountId: fixture.account.id,
          categoryId: fixture.categories.home.id,
        });
        const d = await reconcile();
        assert.equal(
          d.expensesByCategory.find((c) => c.id === null).amount,
          '25.00',
        );
        assert.equal(d.summary.expense.planned, '2925.00');
        assert.equal(d.summary.expense.pending, '525.00');
      },
    );
    await t.test(
      'transferências afetam apenas caixa; contas inativas não entram no total',
      async () => {
        const before = await dashboard();
        await db.transfer.create({
          data: {
            workspaceId: ws,
            sourceAccountId: fixture.account.id,
            destinationAccountId: fixture.reserve.id,
            amount: '125.55',
            transferDate: new Date('2026-10-05'),
            createdBy: arthur.user.id,
          },
        });
        const d = await dashboard();
        assert.deepEqual(d.summary, before.summary);
        assert.equal(d.accounts.totalBalance, before.accounts.totalBalance);
        assert.equal(
          d.accounts.items.find((a) => a.id === fixture.reserve.id).balance,
          '325.55',
        );
        const inactive = await fixture.create('/accounts', {
          name: 'Inativa',
          type: 'CASH',
          initialBalance: '99999',
        });
        await call('/accounts/' + inactive.id, { method: 'DELETE' });
        assert.deepEqual((await dashboard()).accounts, d.accounts);
      },
    );
    await t.test(
      'evolução usa competência, inclui meses vazios e saldo não muda com filtro mensal',
      async () => {
        const historical = await fixture.create('/transactions', {
          description: 'Histórico',
          type: 'INCOME',
          expectedAmount: '200',
          transactionDate: '2026-01-01',
          dueDate: '2026-05-30',
          accountId: fixture.account.id,
          categoryId: fixture.categories.salary.id,
        });
        await call(`/transactions/${historical.id}/pay`, {
          method: 'POST',
          body: { amount: '190', paidAt: '2026-10-01T12:00:00-03:00' },
        });
        const d = await reconcile();
        assert.equal(d.evolution[0].income.planned, '200.00');
        assert.equal(d.evolution[0].income.actual, '190.00');
        assert.deepEqual((await dashboard('2026-09')).accounts, d.accounts);
        const empty = await dashboard('2025-12');
        assert.equal(empty.transactionCount, 0);
        assert.equal(empty.hasActivity, true);
        assert.equal(empty.summary.income.actual, '0.00');
        await reconcile('2026-05');
      },
    );
    await t.test(
      'exclusão de ocorrência conserva tombstone mesmo em leituras concorrentes',
      async () => {
        const energy = fixture.energy.occurrences.find(
          (r) => r.dueDate === '2026-10-15',
        );
        await call(`/transactions/${energy.id}/permanent`, {
          method: 'DELETE',
          body: { confirm: true, scope: 'THIS' },
        });
        const results = await Promise.all([
          dashboard(),
          dashboard(),
          dashboard(),
        ]);
        for (const d of results) {
          assert.equal(
            d.upcoming.some((r) => r.id === energy.id),
            false,
          );
          assert.equal(d.expenseComposition.recurring, '1500.00');
        }
        assert.equal(
          await db.transaction.count({ where: { id: energy.id } }),
          0,
        );
        await reconcile();
      },
    );
    await t.test(
      '10 próximos vencimentos ordenados, sem pagos/cancelados',
      async () => {
        for (let i = 0; i < 12; i++)
          await fixture.transaction(
            `Pendente ${i}`,
            'EXPENSE',
            '1',
            fixture.categories.home.id,
            String(16 + i).padStart(2, '0'),
          );
        const d = await dashboard();
        assert.equal(d.upcoming.length, 10);
        assert.deepEqual(
          d.upcoming.map((r) => r.dueDate),
          d.upcoming.map((r) => r.dueDate).sort(),
        );
        assert.ok(
          d.upcoming.every((r) => ['PENDING', 'OVERDUE'].includes(r.status)),
        );
        await reconcile();
      },
    );
    await t.test(
      'precisão decimal acima do limite de Number e outro tenant não contamina totais',
      async () => {
        const personal = arthur.workspaces[0].id;
        const account = await call('/accounts', {
          workspace: personal,
          method: 'POST',
          expected: 201,
          body: {
            name: 'Exatidão',
            type: 'CASH',
            initialBalance: '9007199254740993.01',
          },
        });
        await db.transaction.create({
          data: {
            workspaceId: personal,
            description: 'Exato',
            type: 'EXPENSE',
            expectedAmount: '9007199254740993.01',
            amount: '9007199254740993.02',
            status: 'PAID',
            paidAt: new Date('2026-10-05'),
            transactionDate: new Date('2026-10-05'),
            dueDate: new Date('2026-10-05'),
            competenceDate: new Date('2026-10-01'),
            accountId: account.id,
            createdBy: arthur.user.id,
          },
        });
        const d = await dashboard('2026-10', { workspace: personal });
        assert.equal(d.summary.expense.planned, '9007199254740993.01');
        assert.equal(d.summary.expense.actual, '9007199254740993.02');
        assert.equal(d.accounts.totalBalance, '-0.01');
        assert.equal(d.summary.result.planned, '-9007199254740993.01');
        assert.equal(d.expensesByCategory[0].percentage, '100.0');
        assert.notEqual(
          (await reconcile()).summary.expense.planned,
          d.summary.expense.planned,
        );
      },
    );
    await t.test(
      'revogação bloqueia próximo dashboard mesmo com JWT válido',
      async () => {
        const member = await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: ws, userId: maria.user.id },
          },
        });
        await call(`/workspaces/${ws}/members/${member.id}`, {
          method: 'DELETE',
        });
        await dashboard('2026-10', { who: 1, expected: 403 });
        await dashboard();
      },
    );
  } finally {
    await cleanupDashboard(db, ids);
    await app.close();
    await signer.close();
  }
});
