import { Module, forwardRef } from '@nestjs/common';
import { ArtifactController } from './artifact.controller.js';
import { ArtifactService } from './artifact.service.js';
import { ProjectModule } from '../project/project.module.js';
import { UserModule } from '../user/user.module.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { ActivityModule } from '../activity/activity.module.js';

@Module({
  imports: [ProjectModule, UserModule, forwardRef(() => CollaborationModule), ActivityModule],
  controllers: [ArtifactController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactModule {}
