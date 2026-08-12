import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Controller('instructions')
export class InstructionController {
  private readonly agentInstruction: string;

  constructor() {
    // Resolve relative to compiled output: dist/src/instruction/
    this.agentInstruction = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'instruction', 'agent_instruction.md'),
      'utf-8',
    );
  }

  /** Returns the current agent instruction content as plain text. */
  @Get('agent')
  getAgentInstruction(): string {
    return this.agentInstruction;
  }
}
