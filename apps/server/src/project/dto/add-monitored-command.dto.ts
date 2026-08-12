import { IsString, IsNotEmpty } from 'class-validator';

export class AddMonitoredCommandDto {
  @IsString()
  @IsNotEmpty()
  command: string;
}
