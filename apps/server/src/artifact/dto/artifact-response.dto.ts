import { Expose } from 'class-transformer';

export class ArtifactListItemDto {
  @Expose() kind: string;
  @Expose() title: string;
  @Expose() status: string;
  @Expose() statusChangedBy: string | null;
  @Expose() statusChangedByFirstName: string | null;
  @Expose() statusChangedByLastName: string | null;
  @Expose() statusChangedAt: string | null;
  @Expose() version: number;
  @Expose() lastEditedBy: string | null;
  @Expose() updatedAt: string;
}

export class ArtifactResponseDto {
  @Expose() kind: string;
  @Expose() title: string;
  @Expose() status: string;
  @Expose() statusChangedBy: string | null;
  @Expose() statusChangedByFirstName: string | null;
  @Expose() statusChangedByLastName: string | null;
  @Expose() statusChangedAt: string | null;
  @Expose() version: number;
  @Expose() yamlContent: string;
  @Expose() lastEditedBy: string | null;
  @Expose() createdAt: string;
  @Expose() updatedAt: string;
}
