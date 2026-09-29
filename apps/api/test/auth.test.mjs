import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'jose';
import { NestFactory } from '@nestjs/core';
import { JwtVerifier } from '../dist/auth/jwt-verifier.js';
import { AppModule } from '../dist/app.module.js';
import { signingServer } from './helpers/jwt.mjs';
test('JWT valida assinatura, expiração, issuer, audience e identidade', async (t) => {
  const signer = await signingServer();
  process.env.SUPABASE_URL = signer.origin;
  const verifier = new JwtVerifier();
  const id = randomUUID();
  try {
    await t.test('token válido', async () => {
      assert.equal(
        (await verifier.verify(await signer.token(id, 'test@example.com')))
          .authUserId,
        id,
      );
    });
    const other = await generateKeyPair('ES256');
    for (const [name, options] of [
      ['assinatura incorreta', { key: other.privateKey }],
      ['expirado', { expiration: '0s' }],
      ['outro issuer', { issuer: 'https://other.example/auth/v1' }],
      ['audience incorreta', { audience: 'anon' }],
      ['role service_role', { claims: { role: 'service_role' } }],
      ['usuário anônimo', { claims: { is_anonymous: true } }],
      ['email ausente', { claims: { email: undefined } }],
    ])
      await t.test(name, async () => {
        await assert.rejects(
          verifier.verify(await signer.token(id, 'test@example.com', options)),
          (e) => e.getStatus() === 401,
        );
      });
    await t.test('token malformado', async () => {
      await assert.rejects(
        verifier.verify('invalid'),
        (e) => e.getStatus() === 401,
      );
    });
  } finally {
    await signer.close();
  }
});
test('endpoints protegidos rejeitam ausência de JWT e JWT inválido', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const path of [
      '/me',
      '/workspaces',
      '/accounts',
      '/categories',
      '/transactions',
      '/credit-cards',
      `/installment-groups/${randomUUID()}`,
      '/transactions/summary?month=2026-10',
      `/workspaces/${randomUUID()}`,
    ]) {
      assert.equal((await fetch(base + path)).status, 401);
      assert.equal(
        (
          await fetch(base + path, {
            headers: { Authorization: 'Bearer invalid' },
          })
        ).status,
        401,
      );
    }
  } finally {
    await app.close();
  }
});
