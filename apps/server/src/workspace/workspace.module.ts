import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { ProjectModule } from '../project/project.module.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [ProjectModule, UserModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
