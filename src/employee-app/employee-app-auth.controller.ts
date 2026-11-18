import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { EmployeeAppLoginDto, EmployeeAppRefreshDto } from './dto/employee-app-auth.dto';
import { EmployeeAppLogoutDto } from './dto/employee-app-device-token.dto';
import { AuthService } from '../auth/auth.service';
import { ForgotPasswordDto } from '../auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';

/**
 * Carer / employee mobile app auth — kept separate from web `/auth/*`.
 */
@ApiTags('Employee App Auth')
@Controller('employee-app/auth')
export class EmployeeAppAuthController {
  constructor(
    private readonly authService: EmployeeAppAuthService,
    private readonly passwords: AuthService,
  ) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Employee (carer) app login with email and password' })
  login(@Body() dto: EmployeeAppLoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh employee app access token' })
  refresh(@Body() dto: EmployeeAppRefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto, req);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({
    summary: 'Care app: email a link to choose a new password',
    description:
      'Always answers 200 with the same message, whether or not the email has app access. The link (60 minutes, ' +
      'single use) opens the set-password page; when the person also has an office login it sets one password for both.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.passwords.forgotAppPassword(dto, req);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Care app: choose a new password with the token from the emailed link',
    description: 'Same as POST /auth/reset-password: any set-password token works on either route.',
  })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwords.resetPassword(dto, req);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
  @ApiOperation({ summary: 'Logout employee app session' })
  logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Body() dto?: EmployeeAppLogoutDto,
  ) {
    return this.authService.logout(user, req, dto?.token);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
  @ApiOperation({ summary: 'Current employee app session profile' })
  me(@CurrentUser() user: RequestUser) {
    return this.authService.me(user);
  }
}
