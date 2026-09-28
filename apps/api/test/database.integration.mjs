import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('bootstrap e autorização reais no PostgreSQL local', async (t) => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Teste restrito ao banco local',
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false });
  const authIds = [randomUUID(), randomUUID(), randomUUID()];
  const emails = authIds.map((id) => `${id}@auth-test.invalid`);
  const db = app.get(PrismaService).client;
  let legacyId;
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const tokens = await Promise.all(
      authIds.map((id, i) => signer.token(id, emails[i])),
    );
    const request = (path, token = tokens[0], workspace) =>
      fetch(base + path, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
        },
      });
    let first;
    await t.test(
      'bootstrap concorrente cria exatamente User + Pessoal + OWNER',
      async () => {
        const responses = await Promise.all(
          Array.from({ length: 6 }, () => request('/me')),
        );
        for (const response of responses) assert.equal(response.status, 200);
        const bodies = await Promise.all(responses.map((r) => r.json()));
        first = bodies[0];
        assert.equal(new Set(bodies.map((b) => b.user.id)).size, 1);
        assert.notEqual(first.user.id, authIds[0]);
        assert.deepEqual(Object.keys(first.user).sort(), [
          'email',
          'id',
          'name',
        ]);
        assert.equal(first.user.email, emails[0]);
        assert.equal(first.workspaces.length, 1);
        assert.equal(first.workspaces[0].name, 'Pessoal');
        assert.equal(first.workspaces[0].type, 'PERSONAL');
        assert.equal(first.workspaces[0].role, 'OWNER');
        assert.equal(
          await db.user.count({ where: { authUserId: authIds[0] } }),
          1,
        );
        assert.equal(
          await db.workspace.count({ where: { ownerId: first.user.id } }),
          1,
        );
        assert.equal(
          await db.workspaceMember.count({
            where: { userId: first.user.id, role: 'OWNER' },
          }),
          1,
        );
      },
    );
    await t.test(
      'segundo login preserva o workspace e sincroniza metadata',
      async () => {
        const token = await signer.token(authIds[0], emails[0], {
          claims: { user_metadata: { name: 'Novo nome' } },
        });
        const me = await (await request('/me', token)).json();
        assert.equal(me.user.name, 'Novo nome');
        assert.equal(me.workspaces[0].id, first.workspaces[0].id);
      },
    );
    await t.test(
      'membership e header validados; /me não vaza outro tenant',
      async () => {
        const second = await (await request('/me', tokens[1])).json();
        const id = first.workspaces[0].id;
        assert.notEqual(second.user.id, first.user.id);
        assert.equal(second.workspaces.length, 1);
        assert.notEqual(second.workspaces[0].id, id);
        assert.equal(
          (await request(`/workspaces/${id}`, tokens[0], id)).status,
          200,
        );
        assert.equal(
          (await request(`/workspaces/${id}`, tokens[1], id)).status,
          403,
        );
        assert.equal(
          (await request(`/workspaces/${id}`, tokens[0])).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/workspaces/${id}`,
              tokens[0],
              second.workspaces[0].id,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request(`/workspaces/${id}`, tokens[0], 'invalid')).status,
          400,
        );
        const absent = randomUUID();
        assert.equal(
          (await request(`/workspaces/${absent}`, tokens[0], absent)).status,
          403,
        );
        assert.deepEqual(
          await (await request('/workspaces', tokens[1])).json(),
          second.workspaces,
        );
      },
    );
    await t.test(
      'email existente não vincula identidade externa e transação reverte',
      async () => {
        const legacy = await db.user.create({
          data: { email: emails[2], name: 'Legado' },
        });
        legacyId = legacy.id;
        assert.equal((await request('/me', tokens[2])).status, 409);
        assert.equal(
          await db.user.count({ where: { authUserId: authIds[2] } }),
          0,
        );
        assert.equal(
          await db.workspace.count({ where: { ownerId: legacyId } }),
          0,
        );
      },
    );
  } finally {
    await db.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: {
          OR: [
            { authUserId: { in: authIds } },
            ...(legacyId ? [{ id: legacyId }] : []),
          ],
        },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      await tx.workspaceMember.deleteMany({ where: { userId: { in: ids } } });
      await tx.workspace.deleteMany({ where: { ownerId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    await app.close();
    await signer.close();
  }
});
