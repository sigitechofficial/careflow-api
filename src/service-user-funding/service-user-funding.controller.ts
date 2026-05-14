import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserFundingService } from './service-user-funding.service';
import { ServiceUserFundingQueryDto } from './dto/service-user-funding-query.dto';
import { CreateServiceUserFundingDto } from './dto/create-service-user-funding.dto';
import { UpdateServiceUserFundingDto } from './dto/update-service-user-funding.dto';
import { UpdateServiceUserFundingStatusDto } from './dto/update-service-user-funding-status.dto';
import { ApproveServiceUserFundingDto } from './dto/approve-service-user-funding.dto';
import { EndServiceUserFundingDto } from './dto/end-service-user-funding.dto';

@ApiTags('Service User Funding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users')
export class ServiceUserFundingController {
  constructor(private readonly funding: ServiceUserFundingService) {}

  @Get(':id/funding')
  @AnyPermission('service_users.funding.read', 'service_users.read')
  @ApiOperation({ summary: 'List funding arrangements for a service user' })
  @ApiResponse({ status: 200 })
  list(@Param('id') serviceUserId: string, @Query() query: ServiceUserFundingQueryDto) {
    return this.funding.findAllForServiceUser(serviceUserId, query);
  }

  @Get(':id/funding/:fundingId')
  @AnyPermission('service_users.funding.read', 'service_users.read')
  @ApiOperation({ summary: 'Get one funding record' })
  getOne(@Param('id') serviceUserId: string, @Param('fundingId') fundingId: string) {
    return this.funding.findOneForServiceUser(serviceUserId, fundingId);
  }

  @Post(':id/funding')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.funding.create')
  @ApiOperation({ summary: 'Create funding arrangement' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserFundingDto,
    @Req() req: Request,
  ) {
    return this.funding.createForServiceUser(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/:fundingId')
  @Permissions('service_users.funding.update')
  @ApiOperation({ summary: 'Update funding arrangement' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Body() dto: UpdateServiceUserFundingDto,
    @Req() req: Request,
  ) {
    return this.funding.updateForServiceUser(user.id, serviceUserId, fundingId, dto, getRequestAuditMeta(req));
  }

  @Delete(':id/funding/:fundingId')
  @Permissions('service_users.funding.delete')
  @ApiOperation({ summary: 'Soft-delete funding arrangement' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Req() req: Request,
  ) {
    return this.funding.softDeleteForServiceUser(user.id, serviceUserId, fundingId, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/:fundingId/status')
  @Permissions('service_users.funding.status.update')
  @ApiOperation({ summary: 'Update funding status' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Body() dto: UpdateServiceUserFundingStatusDto,
    @Req() req: Request,
  ) {
    return this.funding.updateStatus(user.id, serviceUserId, fundingId, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/:fundingId/set-primary')
  @Permissions('service_users.funding.set_primary')
  @ApiOperation({ summary: 'Set as primary funding (unsets other primaries)' })
  setPrimary(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Req() req: Request,
  ) {
    return this.funding.setPrimary(user.id, serviceUserId, fundingId, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/:fundingId/approve')
  @Permissions('service_users.funding.approve')
  @ApiOperation({ summary: 'Approve funding (sets approvedAt / approvedBy; status APPROVED or ACTIVE)' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Body() dto: ApproveServiceUserFundingDto,
    @Req() req: Request,
  ) {
    return this.funding.approveFunding(user.id, serviceUserId, fundingId, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/funding/:fundingId/end')
  @Permissions('service_users.funding.update')
  @ApiOperation({ summary: 'End funding (status ENDED, end date, clears primary pointer if needed)' })
  end(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('fundingId') fundingId: string,
    @Body() dto: EndServiceUserFundingDto,
    @Req() req: Request,
  ) {
    return this.funding.endFunding(user.id, serviceUserId, fundingId, dto, getRequestAuditMeta(req));
  }
}
