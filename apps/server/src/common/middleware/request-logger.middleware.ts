import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const { method, originalUrl } = req;
    const reqId = (req.headers['x-request-id'] as string) || randomUUID().slice(0, 8);

    // Attach to request so downstream code can include it in logs
    (req as unknown as Record<string, unknown>).reqId = reqId;

    this.logger.log(`→ ${method} ${originalUrl} [${reqId}]`);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;

      const message = `← ${method} ${originalUrl} ${statusCode} ${duration}ms [${reqId}]`;

      if (statusCode >= 500) {
        this.logger.error(message);
      } else if (statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
