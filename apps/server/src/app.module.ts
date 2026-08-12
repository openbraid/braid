import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UserModule } from './user/user.module.js';
import { ProjectModule } from './project/project.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';
import { ContributorModule } from './contributor/contributor.module.js';
import { ArtifactModule } from './artifact/artifact.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { InstructionModule } from './instruction/instruction.module.js';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UserModule,
    ProjectModule,
    WorkspaceModule,
    ContributorModule,
    ArtifactModule,
    CollaborationModule,
    ActivityModule,
    InstructionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
