import { IsString, IsNotEmpty, IsOptional, IsInt, MaxLength, Matches } from 'class-validator';

export class SaveArtifactDto {
  @IsString()
  @IsNotEmpty()
  yamlContent: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @IsString()
  yjsState?: string; // base64-encoded Tiptap-normalized Y.Doc state from client
}

export class UpdateStatusDto {
  @IsString()
  @Matches(/^(draft|in_review|approved|update_required|outdated)$/, { message: 'status must be draft, in_review, approved, update_required, or outdated' })
  status: string;
}
