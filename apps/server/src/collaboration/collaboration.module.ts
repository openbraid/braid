import { Module } from '@nestjs/common';
import { HocuspocusService } from './hocuspocus.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UserModule } from '../user/user.module.js';
import { ProjectModule } from '../project/project.module.js';

@Module({
  imports: [AuthModule, PrismaModule, UserModule, ProjectModule],
  providers: [HocuspocusService],
  exports: [HocuspocusService],
})
export class CollaborationModule {}
