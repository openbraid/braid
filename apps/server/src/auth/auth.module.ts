import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { UserModule } from '../user/user.module.js';

@Module({
  // UserModule: the guard provisions accounts on first request in token mode.
  imports: [UserModule],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  // Exported so CollaborationModule can authenticate WebSocket upgrades with
  // exactly the same rules as the HTTP guard.
  exports: [AuthService],
})
export class AuthModule {}
