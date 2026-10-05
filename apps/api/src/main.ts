import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.24.6:5173',
  ];

  app.enableCors({
    origin: allowedOrigins,
  });

  app.enableShutdownHooks();

  await app.listen(Number(process.env.API_PORT ?? 3000), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
