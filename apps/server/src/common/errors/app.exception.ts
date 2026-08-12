import { HttpException } from '@nestjs/common';
import type { ErrorCode } from './error-codes.js';

export class AppException extends HttpException {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, status: number = 400) {
    super({ code, message }, status);
    this.code = code;
  }
}
