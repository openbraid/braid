import { Controller, Get, Post, Body } from '@nestjs/common';
import { UserService } from './user.service.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  /** Called by the Electron app after first login to provision the user */
  @Post('me')
  async provisionMe(
    @CurrentUser() authUser: AuthUser,
    @Body() body: { provider: string; email: string; firstName?: string; lastName?: string; picture?: string },
  ) {
    return this.userService.findOrCreate(
      { ...authUser, email: body.email, firstName: body.firstName, lastName: body.lastName, picture: body.picture },
      body.provider,
    );
  }

  /** Get current authenticated user profile */
  @Get('me')
  async getMe(@CurrentUser() authUser: AuthUser) {
    return this.userService.findBySubjectId(authUser.subjectId);
  }
}
