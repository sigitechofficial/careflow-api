import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUsersService } from './service-users.service';
import { ServiceUserQueryDto } from './dto/service-user-query.dto';
import { CreateServiceUserDto } from './dto/create-service-user.dto';
import { UpdateServiceUserDto } from './dto/update-service-user.dto';
import { UpdateServiceUserStatusDto } from './dto/update-service-user-status.dto';
import { PatchServiceUserFundingRefsDto } from './dto/patch-service-user-funding-refs.dto';
import { CreateServiceUserFundingProfileDto } from './dto/create-service-user-funding-profile.dto';
import { UpdateServiceUserFundingProfileDto } from './dto/update-service-user-funding-profile.dto';
import { CreateCustomRateCardDto } from './dto/create-custom-rate-card.dto';

@ApiTags('Service Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users')
export class ServiceUsersController {
  constructor(private readonly serviceUsersService: ServiceUsersService) {}

  @Get()
  @Permissions('service_users.read')
  @ApiOperation({ summary: 'List service users' })
  list(@Query() query: ServiceUserQueryDto) {
    return this.serviceUsersService.list(query);
  }

  @Get(':id/funding/lookups')
  @AnyPermission('service_users.funding.read', 'service_users.read')
  @ApiOperation({ summary: 'Care services and rate cards for the Funding tab' })
  fundingLookups(@Param('id') id: string) {
    return this.serviceUsersService.getFundingLookups(id);
  }

  @Get(':id/funding')
  @AnyPermission('service_users.funding.read', 'service_users.read')
  @ApiOperation({ summary: 'Funding profiles and reference fields for a service user' })
  funding(@Param('id') id: string) {
    return this.serviceUsersService.getFunding(id);
  }

  @Patch(':id/funding')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Update Social Services ref and/or NHS number (funding tab)' })
  patchFunding(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PatchServiceUserFundingRefsDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.patchFundingRefs(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/funding/profiles')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Add a funding profile' })
  createFundingProfile(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateServiceUserFundingProfileDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.createFundingProfile(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/profiles/:profileId')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Update a funding profile' })
  updateFundingProfile(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('profileId') profileId: string,
    @Body() dto: UpdateServiceUserFundingProfileDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.updateFundingProfile(user.id, id, profileId, dto, getRequestAuditMeta(req));
  }

  @Delete(':id/funding/profiles/:profileId')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Remove a funding profile' })
  deleteFundingProfile(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('profileId') profileId: string,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.deleteFundingProfile(user.id, id, profileId, getRequestAuditMeta(req));
  }

  @Post(':id/funding/rate-cards')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Create a custom rate card for this service user' })
  createCustomRateCard(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateCustomRateCardDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.createCustomRateCard(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('service_users.read')
  @ApiOperation({ summary: 'Service user detail (sensitive — audit logged)' })
  @ApiResponse({ status: 200 })
  get(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.serviceUsersService.getById(id, { actorUserId: user.id, ...m });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.create')
  @ApiOperation({ summary: 'Create service user' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateServiceUserDto, @Req() req: Request) {
    return this.serviceUsersService.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('service_users.update')
  @ApiOperation({ summary: 'Update service user' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceUserDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('service_users.delete')
  @ApiOperation({ summary: 'Soft-delete service user' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.serviceUsersService.softDelete(user.id, id, getRequestAuditMeta(req));
  }

  @Patch(':id/status')
  @Permissions('service_users.status.update')
  @ApiOperation({ summary: 'Update service user status' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceUserStatusDto,
    @Req() req: Request,
  ) {
    return this.serviceUsersService.updateStatus(user.id, id, dto, getRequestAuditMeta(req));
  }
}
