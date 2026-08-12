import { Expose, Type } from 'class-transformer';
import { WorkspaceRepoResponseDto } from '../../project/dto/project-response.dto.js';

export class WorkspaceResponseDto {
  @Expose() id: string;
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() sanitizedName: string;
  @Expose() branchName: string;
  @Expose() sourceBranch: string;
  @Expose() createdBy: string;
  @Expose() ownerName: string;
  @Expose() ownerEmail: string | null;
  @Expose() createdAt: string;
  @Expose() updatedAt: string;
  @Expose() lifecycleStatus: string;
  @Expose() lifecycleStatusChangedByFirstName: string | null;
  @Expose() lifecycleStatusChangedByLastName: string | null;
  @Expose() lifecycleStatusChangedAt: string | null;

  @Expose()
  @Type(() => WorkspaceRepoResponseDto)
  repos: WorkspaceRepoResponseDto[];
}
