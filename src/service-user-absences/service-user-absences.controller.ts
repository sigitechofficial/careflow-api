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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserAbsencesService } from './service-user-absences.service';
import { CreateServiceUserAbsenceDto } from './dto/create-service-user-absence.dto';
import { UpdateServiceUserAbsenceDto } from './dto/update-service-user-absence.dto';
import { ScheduleImpactPreviewQueryDto } from '../schedule-lifecycle-impact/dto/schedule-impact-preview-query.dto';

@ApiTags('Service User Absences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/absences')
export class ServiceUserAbsencesController {
  constructor(private readonly service: ServiceUserAbsencesService) {}

  @Get()
  @AnyPermission('service_users.absences.read', 'service_users.read')
  @ApiOperation({ summary: 'List absences for a service user' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get('schedule-impact-preview')
  @AnyPermission('service_users.absences.read', 'service_users.read')
  @ApiOperation({ summary: 'Preview how many scheduled visits would be cancelled for an absence date range' })
  previewScheduleImpact(
    @Param('id') serviceUserId: string,
    @Query() query: ScheduleImpactPreviewQueryDto,
  ) {
    return this.service.previewScheduleImpact(serviceUserId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.absences.create', 'service_users.update')
  @ApiOperation({ summary: 'Record an absence' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserAbsenceDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':absenceId')
  @AnyPermission('service_users.absences.update', 'service_users.update')
  @ApiOperation({ summary: 'Update an absence' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('absenceId') absenceId: string,
    @Body() dto: UpdateServiceUserAbsenceDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, absenceId, dto, getRequestAuditMeta(req));
  }

  @Delete(':absenceId')
  @AnyPermission('service_users.absences.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove an absence record' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('absenceId') absenceId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, absenceId, getRequestAuditMeta(req));
  }
}
