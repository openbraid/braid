import { Expose, Type } from 'class-transformer';

export class RepoResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() remoteUrl: string;
}

export class WorkspaceRepoResponseDto extends RepoResponseDto {
  @Expose() sourceBranch: string;
}

export class ProjectResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() createdBy: string;
  @Expose() createdAt: string;
  @Expose() updatedAt: string;

  @Expose()
  @Type(() => RepoResponseDto)
  repos: RepoResponseDto[];
}
