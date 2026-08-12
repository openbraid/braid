import { Expose } from 'class-transformer';

export class ContributorResponseDto {
  @Expose() userId: string;
  @Expose() email: string;
  @Expose() firstName: string | null;
  @Expose() lastName: string | null;
  @Expose() picture: string | null;
  @Expose() role: string;
  @Expose() addedAt: string;
}
