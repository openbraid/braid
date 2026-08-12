import { IsString, Matches } from 'class-validator';

export class UpdateLifecycleStatusDto {
  @IsString()
  @Matches(/^(in_progress|blocked|on_hold|completed)$/, {
    message: 'lifecycleStatus must be in_progress, blocked, on_hold, or completed',
  })
  lifecycleStatus: string;
}
