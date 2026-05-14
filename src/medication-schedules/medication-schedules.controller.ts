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
import { MedicationSchedulesService } from './medication-schedules.service';
import { CreateMedicationScheduleDto } from './dto/create-medication-schedule.dto';
import { UpdateMedicationScheduleDto } from './dto/update-medication-schedule.dto';

@ApiTags('Medication Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medications/:medicationId/schedules')
export class MedicationSchedulesController {
  constructor(private readonly service: MedicationSchedulesService) {}

  @Get()
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List schedules for a regular medication' })
  list(@Param('id') serviceUserId: string, @Param('medicationId') medicationId: string) {
    return this.service.list(serviceUserId, medicationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.update', 'service_users.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Body() dto: CreateMedicationScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, medicationId, dto, getRequestAuditMeta(req));
  }

  @Patch(':scheduleId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateMedicationScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, medicationId, scheduleId, dto, getRequestAuditMeta(req));
  }

  @Delete(':scheduleId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Param('scheduleId') scheduleId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, medicationId, scheduleId, getRequestAuditMeta(req));
  }
}
