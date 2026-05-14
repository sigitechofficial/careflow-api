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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MedicationPacksService } from './medication-packs.service';
import { CreateMedicationPackDto } from './dto/create-medication-pack.dto';
import { UpdateMedicationPackDto } from './dto/update-medication-pack.dto';
import { CreateMedicationPackItemDto } from './dto/create-medication-pack-item.dto';
import { UpdateMedicationPackItemDto } from './dto/update-medication-pack-item.dto';

@ApiTags('Medication Packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-packs')
export class MedicationPacksController {
  constructor(private readonly service: MedicationPacksService) {}

  @Get()
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication packs' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get(':packId')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get medication pack' })
  getOne(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.getOne(serviceUserId, packId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.create', 'service_users.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':packId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: UpdateMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Delete(':packId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, packId, getRequestAuditMeta(req));
  }

  @Post(':packId/items')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.update', 'service_users.update')
  addItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: CreateMedicationPackItemDto,
    @Req() req: Request,
  ) {
    return this.service.addItem(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Patch(':packId/items/:itemId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMedicationPackItemDto,
    @Req() req: Request,
  ) {
    return this.service.updateItem(user.id, serviceUserId, packId, itemId, dto, getRequestAuditMeta(req));
  }

  @Delete(':packId/items/:itemId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  removeItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    return this.service.removeItem(user.id, serviceUserId, packId, itemId, getRequestAuditMeta(req));
  }
}
