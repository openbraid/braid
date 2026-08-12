import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SuggestNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text: string;
}
