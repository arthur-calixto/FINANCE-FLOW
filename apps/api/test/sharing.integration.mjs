import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/prisma.service.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';

test('compartilhamento FAMILY real, segurança e concorrência', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const app = await NestFactory.create(AppModule, { logger: false });
  const db = app.get(PrismaService).client;
  const ids = Array.from({ length: 7 }, () => randomUUID());
  const emails = ids.map((id) => `${id}@sharing-test.invalid`);
  const tokens = await Promise.all(
    ids.map((id, i) => signer.token(id, emails[i])),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const req = (path, who = 0, ws, method = 'GET', body) =>
      fetch(base + path, {
        method,
        headers: {
          ...(who !== null ? { Authorization: `Bearer ${tokens[who]}` } : {}),
          ...(ws ? { 'X-Workspace-Id': ws } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const json = async (response, status = 200) => {
      const r = await response;
      const body = await r.json();
      assert.equal(r.status, status, JSON.stringify(body));
      return body;
    };
    const arthur = await json(req('/me'));
    const maria = await json(req('/me', 1));
    let family, invitation, member, transaction;
    const invite = (email, who = 0, ws = family.id) =>
      req(`/workspaces/${ws}/invitations`, who, ws, 'POST', { email });
    await t.test(
      'FAMILY atômico, validação, autenticação e OWNER',
      async () => {
        assert.equal(
          (
            await req('/workspaces', null, undefined, 'POST', {
              name: 'Família',
              type: 'FAMILY',
            })
          ).status,
          401,
        );
        for (const body of [
          { name: '', type: 'FAMILY' },
          { name: 'Pessoal', type: 'PERSONAL' },
          { name: 'Nome', type: 'FAMILY', ownerId: maria.user.id },
        ])
          assert.equal(
            (await req('/workspaces', 0, undefined, 'POST', body)).status,
            400,
          );
        family = await json(
          req('/workspaces', 0, undefined, 'POST', {
            name: 'Família Calixto',
            type: 'FAMILY',
          }),
          201,
        );
        assert.equal(family.role, 'OWNER');
        const owner = await db.workspaceMember.findMany({
          where: { workspaceId: family.id },
        });
        assert.equal(owner.length, 1);
        assert.equal(owner[0].userId, arthur.user.id);
        assert.equal(owner[0].role, 'OWNER');
        assert.equal(
          (
            await req(
              `/workspaces/${family.id}/members/${owner[0].id}`,
              0,
              family.id,
              'DELETE',
            )
          ).status,
          403,
        );
        const renamed = await json(
          req(`/workspaces/${family.id}`, 0, family.id, 'PATCH', {
            name: 'Família compartilhada',
          }),
        );
        assert.equal(renamed.name, 'Família compartilhada');
      },
    );
    await t.test(
      'PERSONAL privado nos dois sentidos e não compartilhável',
      async () => {
        assert.equal(
          (await req('/accounts', 1, arthur.workspaces[0].id)).status,
          403,
        );
        assert.equal(
          (await req('/accounts', 0, maria.workspaces[0].id)).status,
          403,
        );
        assert.equal(
          (await invite(emails[1], 0, arthur.workspaces[0].id)).status,
          403,
        );
      },
    );
    await t.test(
      'convite concorrente normalizado, hash e sem acesso antes do aceite',
      async () => {
        assert.equal((await invite(emails[0])).status, 409);
        assert.equal(
          (
            await req(
              `/workspaces/${family.id}/invitations`,
              0,
              family.id,
              'POST',
              { email: emails[1], role: 'OWNER' },
            )
          ).status,
          400,
        );
        const responses = await Promise.all(
          Array.from({ length: 4 }, () =>
            json(invite(` ${emails[1].toUpperCase()} `), 201),
          ),
        );
        assert.equal(new Set(responses.map((r) => r.invitation.id)).size, 1);
        assert.equal(responses.filter((r) => r.token).length, 1);
        invitation = responses.find((r) => r.token);
        const row = await db.workspaceInvitation.findUnique({
          where: { id: invitation.invitation.id },
        });
        assert.equal(row.email, emails[1]);
        assert.equal(row.role, 'MEMBER');
        assert.equal(
          row.tokenHash,
          createHash('sha256').update(invitation.token).digest('hex'),
        );
        assert.ok(
          Math.abs(row.expiresAt - row.createdAt - 7 * 86400000) < 5000,
        );
        const list = await json(
          req(`/workspaces/${family.id}/invitations`, 0, family.id),
        );
        assert.equal(JSON.stringify(list).includes(row.tokenHash), false);
        assert.equal(JSON.stringify(list).includes(invitation.token), false);
        const preview = await json(
          req(`/invitations/${invitation.token}`, null),
        );
        assert.equal(preview.workspaceName, 'Família compartilhada');
        assert.equal('email' in preview, false);
        assert.equal((await req('/transactions', 1, family.id)).status, 403);
        assert.equal(
          (
            await req(
              `/invitations/${invitation.token}/accept`,
              null,
              undefined,
              'POST',
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      'e-mail errado; aceite concorrente e idempotente',
      async () => {
        const wrong = await json(
          req(`/invitations/${invitation.token}/accept`, 2, undefined, 'POST'),
          403,
        );
        assert.equal(
          wrong.message,
          'Este convite foi enviado para outro endereço de e-mail.',
        );
        assert.equal(
          (
            await req(
              `/invitations/${invitation.token}/decline`,
              2,
              undefined,
              'POST',
            )
          ).status,
          403,
        );
        await Promise.all(
          Array.from({ length: 4 }, () =>
            json(
              req(
                `/invitations/${invitation.token}/accept`,
                1,
                undefined,
                'POST',
              ),
              201,
            ),
          ),
        );
        const memberships = await db.workspaceMember.findMany({
          where: { workspaceId: family.id, userId: maria.user.id },
        });
        assert.equal(memberships.length, 1);
        member = memberships[0];
        assert.equal(member.role, 'MEMBER');
        assert.equal(
          (
            await db.workspaceInvitation.findUnique({
              where: { id: invitation.invitation.id },
            })
          ).status,
          'ACCEPTED',
        );
        assert.equal((await invite(emails[1])).status, 409);
        assert.ok(
          (await json(req('/me', 1))).workspaces.some(
            (w) => w.id === family.id,
          ),
        );
      },
    );
    await t.test(
      'MEMBER financeiro completo, autoria e dados compartilhados',
      async () => {
        const account = await json(
          req('/accounts', 1, family.id, 'POST', {
            name: 'Conta familiar',
            type: 'CHECKING',
            ownerMemberId: member.id,
          }),
          201,
        );
        const category = await json(
          req('/categories', 1, family.id, 'POST', {
            name: 'Supermercado',
            type: 'EXPENSE',
          }),
          201,
        );
        transaction = await json(
          req('/transactions', 1, family.id, 'POST', {
            description: 'Mercado',
            type: 'EXPENSE',
            expectedAmount: '350.00',
            transactionDate: '2026-10-05',
            dueDate: '2026-10-05',
            accountId: account.id,
            categoryId: category.id,
            ownerMemberId: member.id,
          }),
          201,
        );
        const card = await json(
          req('/credit-cards', 1, family.id, 'POST', {
            name: 'Familiar',
            creditLimit: '5000',
            closingDay: 25,
            dueDay: 10,
          }),
          201,
        );
        await db.creditCard.update({
          where: { id: card.id },
          data: { ownerMemberId: member.id },
        });
        const shared = await json(
          req(`/transactions/${transaction.id}`, 0, family.id),
        );
        assert.equal(shared.description, 'Mercado');
        assert.equal(Number(shared.expectedAmount), 350);
        for (const path of [
          '/accounts',
          '/categories',
          '/credit-cards',
          '/recurrences',
        ])
          assert.deepEqual(
            await json(req(path, 0, family.id)),
            await json(req(path, 1, family.id)),
          );
        assert.equal(
          (await db.transaction.findUnique({ where: { id: transaction.id } }))
            .createdBy,
          maria.user.id,
        );
      },
    );
    await t.test(
      'MEMBER não administra; UUIDs conhecidos não atravessam tenants',
      async () => {
        assert.equal(
          (await req(`/workspaces/${family.id}/members`, 1, family.id)).status,
          200,
        );
        assert.equal((await invite(emails[3], 1)).status, 403);
        assert.equal(
          (await req(`/workspaces/${family.id}/invitations`, 1, family.id))
            .status,
          403,
        );
        assert.equal(
          (
            await req(`/workspaces/${family.id}`, 1, family.id, 'PATCH', {
              name: 'Tentativa',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await req(
              `/workspaces/${family.id}/members/${member.id}`,
              1,
              family.id,
              'DELETE',
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await req(
              `/workspaces/${family.id}/members/${member.id}`,
              2,
              family.id,
              'DELETE',
            )
          ).status,
          403,
        );
        const other = await json(
          req('/workspaces', 2, undefined, 'POST', {
            name: 'Outro',
            type: 'FAMILY',
          }),
          201,
        );
        assert.equal(
          (
            await req(
              `/workspaces/${other.id}/invitations/${invitation.invitation.id}`,
              2,
              other.id,
              'DELETE',
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(
              `/workspaces/${other.id}/members/${member.id}`,
              2,
              other.id,
              'DELETE',
            )
          ).status,
          404,
        );
        assert.equal(
          (await req(`/workspaces/${family.id}/members`, 0, other.id)).status,
          400,
        );
      },
    );
    await t.test(
      'cancelamento, recusa, expiração e cadastro posterior',
      async () => {
        for (const [who, outcome] of [
          [3, 'cancel'],
          [4, 'decline'],
          [5, 'expire'],
          [6, 'new'],
        ]) {
          assert.equal(
            await db.user.count({ where: { authUserId: ids[who] } }),
            0,
          );
          const result = await json(invite(emails[who]), 201);
          if (outcome === 'cancel')
            await json(
              req(
                `/workspaces/${family.id}/invitations/${result.invitation.id}`,
                0,
                family.id,
                'DELETE',
              ),
            );
          if (outcome === 'expire')
            await db.workspaceInvitation.update({
              where: { id: result.invitation.id },
              data: { expiresAt: new Date(Date.now() - 1000) },
            });
          if (outcome === 'decline')
            await json(
              req(
                `/invitations/${result.token}/decline`,
                who,
                undefined,
                'POST',
              ),
              201,
            );
          assert.equal(
            (
              await req(
                `/invitations/${result.token}/accept`,
                who,
                undefined,
                'POST',
              )
            ).status,
            outcome === 'new' ? 201 : 403,
          );
          const stored = await db.workspaceInvitation.findUnique({
            where: { id: result.invitation.id },
          });
          assert.equal(
            stored.status,
            {
              cancel: 'CANCELLED',
              decline: 'DECLINED',
              expire: 'EXPIRED',
              new: 'ACCEPTED',
            }[outcome],
          );
          if (outcome === 'expire')
            assert.equal((await json(invite(emails[who]), 201)).reused, false);
        }
      },
    );
    await t.test(
      'remoção preserva dados e revoga JWT; token usado não readmite',
      async () => {
        await json(
          req(
            `/workspaces/${family.id}/members/${member.id}`,
            0,
            family.id,
            'DELETE',
          ),
        );
        assert.equal(
          await db.workspaceMember.count({ where: { id: member.id } }),
          0,
        );
        const stored = await db.transaction.findUnique({
          where: { id: transaction.id },
        });
        assert.equal(stored.createdBy, maria.user.id);
        assert.equal(stored.ownerMemberId, null);
        assert.equal(Number(stored.expectedAmount), 350);
        assert.equal(
          await db.account.count({
            where: { workspaceId: family.id, ownerMemberId: { not: null } },
          }),
          0,
        );
        assert.equal(
          await db.creditCard.count({
            where: { workspaceId: family.id, ownerMemberId: { not: null } },
          }),
          0,
        );
        for (const path of [
          '/transactions',
          `/transactions/${transaction.id}`,
          '/accounts',
          '/credit-cards',
          '/recurrences',
        ])
          assert.equal((await req(path, 1, family.id)).status, 403);
        assert.equal(
          (
            await req(
              `/invitations/${invitation.token}/accept`,
              1,
              undefined,
              'POST',
            )
          ).status,
          403,
        );
        const remaining = await json(req('/me', 1));
        assert.equal(remaining.workspaces.length, 1);
        assert.equal(remaining.workspaces[0].id, maria.workspaces[0].id);
        assert.equal(
          (await req(`/transactions/${transaction.id}`, 0, family.id)).status,
          200,
        );
      },
    );
    await t.test(
      'remoção concorrente com operação financeira mantém integridade',
      async () => {
        const lateUser = await db.user.findUnique({
          where: { authUserId: ids[6] },
        });
        const lateMember = await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: family.id, userId: lateUser.id },
          },
        });
        const retained = await db.transaction.findUnique({
          where: { id: transaction.id },
        });
        const [write, removal] = await Promise.all([
          req('/transactions', 6, family.id, 'POST', {
            description: 'Operação em andamento',
            type: 'EXPENSE',
            expectedAmount: '10',
            transactionDate: '2026-10-05',
            dueDate: '2026-10-05',
            accountId: retained.accountId,
            categoryId: retained.categoryId,
          }),
          req(
            `/workspaces/${family.id}/members/${lateMember.id}`,
            0,
            family.id,
            'DELETE',
          ),
        ]);
        assert.ok([201, 403].includes(write.status));
        assert.equal(removal.status, 200);
        assert.equal((await req('/transactions', 6, family.id)).status, 403);
        assert.equal(
          await db.workspaceMember.count({ where: { id: lateMember.id } }),
          0,
        );
      },
    );
    await t.test(
      'constraints PostgreSQL: hash, role, e-mail, aceite, pending',
      async () => {
        const pending = await json(
          invite('constraints@sharing-test.invalid'),
          201,
        );
        const row = await db.workspaceInvitation.findUnique({
          where: { id: pending.invitation.id },
        });
        const { id: ignored, ...data } = row;
        void ignored;
        await assert.rejects(
          db.workspaceInvitation.create({
            data: { ...data, tokenHash: 'a'.repeat(64) },
          }),
        );
        for (const patch of [
          { role: 'OWNER' },
          { email: 'UPPER@example.com' },
          { tokenHash: 'plaintext' },
          { status: 'ACCEPTED' },
        ])
          await assert.rejects(
            db.workspaceInvitation.update({
              where: { id: row.id },
              data: patch,
            }),
          );
      },
    );
  } finally {
    const users = await db.user.findMany({
      where: { authUserId: { in: ids } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const workspaces = await db.workspace.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    });
    const workspaceId = { in: workspaces.map((w) => w.id) };
    await db.workspaceInvitation.deleteMany({ where: { workspaceId } });
    await db.transaction.deleteMany({ where: { workspaceId } });
    await db.creditCard.deleteMany({ where: { workspaceId } });
    await db.category.deleteMany({ where: { workspaceId } });
    await db.account.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await signer.close();
  }
});
