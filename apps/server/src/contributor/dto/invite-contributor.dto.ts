import { IsEmail } from 'class-validator';

export class InviteContributorDto {
  @IsEmail()
  email: string;
}
