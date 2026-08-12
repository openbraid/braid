import { IsString, IsNotEmpty, IsArray, ValidateNested, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRepoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  remoteUrl: string;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRepoDto)
  repos: CreateRepoDto[];
}
