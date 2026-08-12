import { Module } from '@nestjs/common';
import { InstructionController } from './instruction.controller.js';

@Module({
  controllers: [InstructionController],
})
export class InstructionModule {}
