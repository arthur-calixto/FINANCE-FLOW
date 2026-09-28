import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { healthResponseSchema } from '@finance-flow/validation';

test('GET /health responde 200 e contrato esperado sem banco', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: 'ok' });
    assert.equal(healthResponseSchema.safeParse(body).success, true);
    assert.equal((await fetch(`${await app.getUrl()}/`)).status, 404);
  } finally {
    await app.close();
  }
});
