import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { StaffAccessService } from './staff-access.service';
import { SendOfficeUserInviteDto, SetSignInAccessDto, SetStaffPasswordDto } from './dto/set-sign-in-access.dto';
import { careAppLinks } from './care-app-links';

@ApiTags('Staff sign-in access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/sign-in-access')
export class StaffAccessController {
  constructor(private readonly access: StaffAccessService) {}

  @Get()
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Office login and Care app access for this staff member, with suggestions from their RBAC level' })
  async get(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.access.getStatus(actor, id) };
  }

  @Put()
  @Permissions('employees.update')
  @ApiOperation({
    summary: 'Switch the office login and/or Care app on or off',
    description:
      'Switching on emails a welcome with a set-password link (website, app, or both). Switching off signs them out everywhere. Office logins also need users.create.',
  })
  async set(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSignInAccessDto, @Req() req: Request) {
    const r = await this.access.setAccess(actor, id, dto, getRequestAuditMeta(req));
    return { message: r.message, data: { emailed: r.emailed, status: r.status } };
  }

  @Post('send-link')
  @HttpCode(HttpStatus.OK)
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Email the set-password link again (or a reset link once they have a password)' })
  async resend(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const r = await this.access.resendLink(actor, id, getRequestAuditMeta(req));
    return { message: r.message, data: { emailed: r.emailed, status: r.status } };
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Set their password now (office and Care app, one password). Nothing is emailed; they are signed out everywhere.' })
  async setPassword(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStaffPasswordDto, @Req() req: Request) {
    const r = await this.access.setPasswordByOffice(actor, id, dto.password, getRequestAuditMeta(req));
    return { message: r.message, data: { emailed: r.emailed, status: r.status } };
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Sign them out of the website and the Care app on every device' })
  async signOut(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const r = await this.access.signOutEverywhere(actor, id, getRequestAuditMeta(req));
    return { message: r.message, data: { emailed: r.emailed, status: r.status } };
  }
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class OfficeUserInvitesController {
  constructor(private readonly access: StaffAccessService) {}

  @Post(':id/send-invite')
  @HttpCode(HttpStatus.OK)
  @Permissions('users.create')
  @ApiOperation({ summary: 'Email a new office user the welcome with a link to choose their password' })
  async invite(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendOfficeUserInviteDto,
    @Req() req: Request,
  ) {
    const r = await this.access.inviteOfficeUser(actor, id, getRequestAuditMeta(req), Boolean(dto?.passwordGiven));
    return { message: r.message, data: { emailed: r.emailed } };
  }
}

/** For the /get-app page: where to get the Care app (store IDs from configuration). */
@ApiTags('Care app')
@Controller('care-app')
export class CareAppLinksController {
  @Public()
  @Get('links')
  @ApiOperation({ summary: 'Care app store links and deep link (CARE_APP_IOS_APP_ID, CARE_APP_ANDROID_PACKAGE, CARE_APP_URL_SCHEME)' })
  links() {
    return { data: careAppLinks() };
  }
}
