import { Module } from '@nestjs/common';
import { ContributorController } from './contributor.controller.js';
import { ContributorService } from './contributor.service.js';
import { ProjectModule } from '../project/project.module.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [ProjectModule, UserModule],
  controllers: [ContributorController],
  providers: [ContributorService],
})
export class ContributorModule {}
