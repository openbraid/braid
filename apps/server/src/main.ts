import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { HocuspocusService } from './collaboration/hocuspocus.service.js';

// Mirrors the fallback in prisma.config.ts, which covers the CLI. Plain
// Postgres has no pooled/direct split, so DIRECT_URL is only meaningful on
// hosted providers; defaulting it here means self-hosters set one connection
// string instead of two. Must run before PrismaClient is constructed.
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // ─── Hocuspocus WebSocket upgrade handling ──────────────────────────
  // Route /collaboration/{workspaceId}/{kind} upgrades to Hocuspocus
  const hocuspocusService = app.get(HocuspocusService);
  const httpServer = app.getHttpServer();

  await app.listen(process.env.PORT ?? 3003);

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (url.startsWith('/collaboration/')) {
      hocuspocusService.handleUpgrade(request, socket, head);
    }
  });
}
bootstrap();
