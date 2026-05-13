import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserAddressesService } from './service-user-addresses.service';
import { UpdateServiceUserAddressDto } from './dto/update-service-user-address.dto';

@ApiTags('Service User Address')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/address')
export class ServiceUserAddressesController {
  constructor(private readonly service: ServiceUserAddressesService) {}

  @Get()
  @Permissions('service_users.address.read')
  @ApiOperation({ summary: 'Get address for service user' })
  @ApiResponse({ status: 200 })
  get(@Param('id') serviceUserId: string) {
    return this.service.get(serviceUserId);
  }

  @Patch()
  @Permissions('service_users.address.update')
  @ApiOperation({ summary: 'Create or update address' })
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpdateServiceUserAddressDto,
    @Req() req: Request,
  ) {
    return this.service.upsert(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
