import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private instance?: PrismaClient;
  get client(): PrismaClient {
    if (!this.instance) {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('DATABASE_URL não configurada');
      this.instance = new PrismaClient({
        adapter: new PrismaPg({ connectionString }),
      });
    }
    return this.instance;
  }
  async onModuleDestroy() {
    await this.instance?.$disconnect();
  }
}
