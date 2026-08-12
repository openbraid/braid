import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-codes.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // AppException or any HttpException with { code, message }
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'code' in exceptionResponse
      ) {
        const { code, message } = exceptionResponse as {
          code: string;
          message: string;
        };

        if (status >= 500) {
          this.logger.error(`${request.method} ${request.url} ${status} — [${code}] ${message}`, exception.stack);
        }

        response.status(status).json({ code, message });
        return;
      }

      // class-validator ValidationPipe errors
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const raw = exceptionResponse as { message: string | string[] };
        const message = Array.isArray(raw.message)
          ? raw.message.join('; ')
          : raw.message;
        response
          .status(status)
          .json({ code: ErrorCode.VALIDATION_ERROR, message });
        return;
      }

      // Plain string response
      response.status(status).json({
        code: ErrorCode.INTERNAL_ERROR,
        message:
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : 'An error occurred',
      });
      return;
    }

    // Unhandled / unknown errors
    this.logger.error(
      `${request.method} ${request.url} 500 — Unhandled exception`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
  }
}
