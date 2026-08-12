import { Module } from '@nestjs/common';
import { EventService } from './event.service.js';

@Module({
  providers: [EventService],
  exports: [EventService],
})
export class ActivityModule {}
