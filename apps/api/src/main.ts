import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3000), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
