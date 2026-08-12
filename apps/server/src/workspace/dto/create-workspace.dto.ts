import { IsString, IsNotEmpty, IsUUID, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class WorkspaceRepoInput {
  @IsUUID()
  repoId: string;

  @IsOptional()
  @IsString()
  sourceBranch?: string;
}

export class CreateWorkspaceDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  branchName: string;

  @IsString()
  @IsNotEmpty()
  sourceBranch: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkspaceRepoInput)
  repos?: WorkspaceRepoInput[];
}
