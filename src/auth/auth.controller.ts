import { Body, Controller, ForbiddenException, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { TemporaryInspectorLoginDto } from './dto/temporary-inspector-login.dto';
import { ServiceUserPortalLoginDto } from './dto/service-user-portal-login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Public()
  @Post('login/temporary-inspector')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  temporaryInspectorLogin(@Body() dto: TemporaryInspectorLoginDto, @Req() req: Request) {
    return this.authService.temporaryInspectorLogin(dto, req);
  }

  @Public()
  @Post('service-user/login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  serviceUserPortalLogin(@Body() dto: ServiceUserPortalLoginDto, @Req() req: Request) {
    return this.authService.serviceUserPortalLogin(dto, req);
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto, req);
  }

  @Post('forgot-password')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, req);
  }

  @Post('reset-password')
  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, req);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    if (user.accountKind === 'temporary_inspector' || user.accountKind === 'service_user' || user.accountKind === 'employee') {
      throw new ForbiddenException('Password change is not available for this account type');
    }
    return this.authService.changePassword(user.id, dto, req);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.authService.logout(user, req);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return { data: user };
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto, @Req() req: Request) {
    if (user.accountKind === 'temporary_inspector' || user.accountKind === 'service_user' || user.accountKind === 'employee') {
      throw new ForbiddenException('Profile update is not available for this account type');
    }
    return this.authService.updateProfile(user.id, dto, req);
  }

  @Get('me/login-history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  myLoginHistory(@CurrentUser() user: RequestUser) {
    if (user.accountKind === 'service_user' || user.accountKind === 'employee') {
      throw new ForbiddenException('Login history is not available for this account type');
    }
    return this.authService.getMyLoginHistory(user.id);
  }
}
