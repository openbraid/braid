import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const SLOW_QUERY_MS = 200;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // @ts-expect-error — Prisma event types are loosely typed
    this.$on('query', (e: { query: string; duration: number }) => {
      if (e.duration > SLOW_QUERY_MS) {
        this.logger.warn(`Slow query ${e.duration}ms: ${e.query.slice(0, 200)}`);
      }
    });

    // @ts-expect-error — Prisma event types are loosely typed
    this.$on('error', (e: { message: string }) => {
      this.logger.error(`Query error: ${e.message}`);
    });

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
