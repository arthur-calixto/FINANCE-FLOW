import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('Contas e categorias: CRUD, hierarquia e isolamento PostgreSQL', async (t) => {
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
      ids.map((id) => signer.token(id, `${id}@resources-test.invalid`)),
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
    let a, b, root, child, income, otherRoot;
    await t.test(
      'cria, lista e obtém contas; Decimal positivo, zero e negativo',
      async () => {
        a = await call('/accounts', {
          method: 'POST',
          body: {
            name: ' Nubank ',
            type: 'CHECKING',
            initialBalance: '-350.25',
            currency: 'BRL',
          },
          expected: 201,
        });
        b = await call('/accounts', {
          who: 1,
          method: 'POST',
          body: { name: 'Conta B', type: 'CASH', initialBalance: 0 },
          expected: 201,
        });
        assert.equal(a.name, 'Nubank');
        assert.equal(a.initialBalance, '-350.25');
        assert.equal(a.ownerMemberId, null);
        assert.deepEqual(
          (await call('/accounts')).map((r) => r.id),
          [a.id],
        );
        assert.equal((await call(`/accounts/${a.id}`)).id, a.id);
        const precise = await call(`/accounts/${a.id}`, {
          method: 'PATCH',
          body: {
            initialBalance: '9007199254740993.01',
            name: ' Conta principal ',
          },
        });
        assert.equal(precise.initialBalance, '9007199254740993.01');
        assert.equal(precise.name, 'Conta principal');
      },
    );
    await t.test(
      'rejeita payloads inválidos, moeda e owner cruzado',
      async () => {
        for (const extra of [
          { name: ' ' },
          { type: 'INVALID' },
          { currency: 'USD' },
          { initialBalance: 1.001 },
          { initialBalance: 'NaN' },
          { workspaceId: workspaces[1] },
        ])
          await call('/accounts', {
            method: 'POST',
            expected: 400,
            body: { name: 'Conta', type: 'CASH', ...extra },
          });
        const member = await db.workspaceMember.findFirst({
          where: { workspaceId: workspaces[1], userId: users[1] },
        });
        await call(`/accounts/${a.id}`, {
          method: 'PATCH',
          body: { ownerMemberId: member.id },
          expected: 400,
        });
        const own = await db.workspaceMember.findFirst({
          where: { workspaceId: workspaces[0], userId: users[0] },
        });
        assert.equal(
          (
            await call(`/accounts/${a.id}`, {
              method: 'PATCH',
              body: { ownerMemberId: own.id },
            })
          ).ownerMemberId,
          own.id,
        );
      },
    );
    await t.test(
      'UUID conhecido não permite leitura, alteração ou exclusão cruzada',
      async () => {
        for (const [method, body] of [
          ['GET', undefined],
          ['PATCH', { name: 'Ataque' }],
          ['DELETE', undefined],
        ])
          await call(`/accounts/${b.id}`, { method, body, expected: 404 });
        await call('/accounts', { ws: workspaces[1], expected: 403 });
        assert.equal(
          (await call(`/accounts/${b.id}`, { who: 1 })).name,
          'Conta B',
        );
      },
    );
    await t.test('exclusão lógica e reativação de conta', async () => {
      const before = await call(`/accounts/${a.id}`);
      await call(`/accounts/${a.id}`, {
        method: 'PATCH',
        body: {},
        expected: 400,
      });
      assert.equal(
        (await call(`/accounts/${a.id}`, { method: 'DELETE' })).isActive,
        false,
      );
      assert.equal((await call('/accounts')).length, 0);
      assert.equal((await call('/accounts?includeInactive=true')).length, 1);
      assert.equal(
        (
          await db.account.findFirst({
            where: { workspaceId: workspaces[0], id: a.id },
          })
        ).isActive,
        false,
      );
      assert.equal(
        (
          await call(`/accounts/${a.id}`, {
            method: 'PATCH',
            body: { isActive: true },
          })
        ).isActive,
        true,
      );
      assert.equal(
        (await call(`/accounts/${a.id}`)).initialBalance,
        before.initialBalance,
      );
    });
    await t.test(
      'cria categorias, subcategoria e aplica filtros de tenant',
      async () => {
        root = await call('/categories', {
          method: 'POST',
          body: { name: ' Alimentação ', type: 'EXPENSE' },
          expected: 201,
        });
        child = await call('/categories', {
          method: 'POST',
          body: { name: 'Mercado', type: 'EXPENSE', parentId: root.id },
          expected: 201,
        });
        income = await call('/categories', {
          method: 'POST',
          body: { name: 'Salário', type: 'INCOME' },
          expected: 201,
        });
        otherRoot = await call('/categories', {
          who: 1,
          method: 'POST',
          body: { name: 'Categoria B', type: 'EXPENSE' },
          expected: 201,
        });
        assert.equal(root.name, 'Alimentação');
        assert.equal(child.parentId, root.id);
        assert.equal((await call(`/categories/${child.id}`)).parentId, root.id);
        assert.equal((await call('/categories')).length, 3);
      },
    );
    await t.test(
      'pai de outro tenant/tipo, self-parent, ciclo e tipo de filhos bloqueados',
      async () => {
        for (const parentId of [otherRoot.id, income.id])
          await call('/categories', {
            method: 'POST',
            body: { name: 'Inválida', type: 'EXPENSE', parentId },
            expected: 400,
          });
        await call(`/categories/${root.id}`, {
          method: 'PATCH',
          body: { parentId: root.id },
          expected: 400,
        });
        await call(`/categories/${root.id}`, {
          method: 'PATCH',
          body: { parentId: child.id },
          expected: 400,
        });
        await call(`/categories/${root.id}`, {
          method: 'PATCH',
          body: { type: 'INCOME' },
          expected: 400,
        });
        await call(`/categories/${child.id}`, {
          method: 'PATCH',
          body: { parentId: income.id },
          expected: 400,
        });
        await call('/categories', {
          method: 'POST',
          body: { name: '  ', type: 'EXPENSE' },
          expected: 400,
        });
      },
    );
    await t.test(
      'atualiza, desativa somente pai e reativa categoria',
      async () => {
        assert.equal(
          (
            await call(`/categories/${child.id}`, {
              method: 'PATCH',
              body: { name: 'Supermercado' },
            })
          ).name,
          'Supermercado',
        );
        assert.equal(
          (await call(`/categories/${root.id}`, { method: 'DELETE' })).isActive,
          false,
        );
        assert.equal((await call(`/categories/${child.id}`)).isActive, true);
        assert.equal((await call('/categories')).length, 2);
        assert.equal(
          (await call('/categories?includeInactive=true')).length,
          3,
        );
        assert.equal(
          (
            await call(`/categories/${root.id}`, {
              method: 'PATCH',
              body: { isActive: true },
            })
          ).isActive,
          true,
        );
        for (const [method, body] of [
          ['GET', undefined],
          ['PATCH', { name: 'Ataque' }],
          ['DELETE', undefined],
        ])
          await call(`/categories/${otherRoot.id}`, {
            method,
            body,
            expected: 404,
          });
        await call('/categories', { ws: workspaces[1], expected: 403 });
      },
    );
    await t.test('alterações concorrentes não introduzem ciclo', async () => {
      const c = await call('/categories', {
        method: 'POST',
        body: { name: 'C', type: 'EXPENSE' },
        expected: 201,
      });
      const d = await call('/categories', {
        method: 'POST',
        body: { name: 'D', type: 'EXPENSE' },
        expected: 201,
      });
      const results = await Promise.all(
        [
          [c.id, d.id],
          [d.id, c.id],
        ].map(([id, parentId]) =>
          fetch(`${base}/categories/${id}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${tokens[0]}`,
              'X-Workspace-Id': workspaces[0],
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ parentId }),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    });
    await t.test('VIEWER consulta, mas não escreve', async () => {
      await db.workspaceMember.create({
        data: { workspaceId: workspaces[0], userId: users[1], role: 'VIEWER' },
      });
      await call('/accounts', { who: 1, ws: workspaces[0] });
      for (const resource of ['accounts', 'categories']) {
        await call(`/${resource}`, {
          who: 1,
          ws: workspaces[0],
          method: 'POST',
          body: {},
          expected: 403,
        });
        const id = resource === 'accounts' ? a.id : root.id;
        await call(`/${resource}/${id}`, {
          who: 1,
          ws: workspaces[0],
          method: 'PATCH',
          body: { name: 'Bloqueado' },
          expected: 403,
        });
        await call(`/${resource}/${id}`, {
          who: 1,
          ws: workspaces[0],
          method: 'DELETE',
          expected: 403,
        });
      }
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
