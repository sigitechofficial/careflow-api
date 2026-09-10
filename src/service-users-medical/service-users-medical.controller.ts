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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreateMedicalHistoryEventDto,
  CreateReasonableAdjustmentDto,
  CreateServiceUserMedicalConditionDto,
  UpdateMedicalHistoryEventDto,
  UpdateReasonableAdjustmentDto,
  UpdateServiceUserMedicalConditionDto,
  UpdateUsualParameterDto,
  UpsertMonitoringConfigDto,
  UpsertUsualParameterDto,
} from './dto/medical.dto';
import { MedicalConditionsService } from './medical-conditions.service';
import { MedicalHistoryService } from './medical-history.service';
import { MedicalSafetySummaryService } from './medical-safety-summary.service';
import { MonitoringConfigService } from './monitoring-config.service';
import { ReasonableAdjustmentsService } from './reasonable-adjustments.service';
import { UsualParametersService } from './usual-parameters.service';

@ApiTags('Medical Condition Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('lookups/medical-condition-catalog')
export class MedicalConditionCatalogController {
  constructor(private readonly conditions: MedicalConditionsService) {}

  @Get()
  @AnyPermission(
    'service_users.medical_conditions.read',
    'service_users.medical_conditions.create',
    'lookups.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'List medical condition catalogue' })
  list(
    @Query('includeInactive') includeInactive?: string,
    @Query('search') search?: string,
  ) {
    return this.conditions.listCatalog({
      includeInactive: includeInactive === 'true' || includeInactive === '1',
      search,
    });
  }
}

@ApiTags('Service User Medical Conditions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medical-conditions')
export class ServiceUserMedicalConditionsController {
  constructor(private readonly conditions: MedicalConditionsService) {}

  @Get()
  @Permissions('service_users.medical_conditions.read')
  @ApiOperation({ summary: 'List medical conditions for a service user' })
  list(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.conditions.list(user, serviceUserId);
  }

  @Get('care-plan-recommendations')
  @AnyPermission(
    'service_users.medical_conditions.read',
    'service_users.read',
  )
  @ApiOperation({
    summary:
      'Care plan recommendations from active medical conditions (works without an Initial Assessment)',
  })
  listCarePlanRecommendations(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
  ) {
    return this.conditions.listCarePlanRecommendations(user, serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.medical_conditions.create')
  @ApiOperation({ summary: 'Record a medical condition' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserMedicalConditionDto,
    @Req() req: Request,
  ) {
    return this.conditions.create(user, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':conditionRecordId')
  @Permissions('service_users.medical_conditions.update')
  @ApiOperation({ summary: 'Update a service user medical condition' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('conditionRecordId') conditionRecordId: string,
    @Body() dto: UpdateServiceUserMedicalConditionDto,
    @Req() req: Request,
  ) {
    return this.conditions.update(
      user,
      serviceUserId,
      conditionRecordId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':conditionRecordId')
  @Permissions('service_users.medical_conditions.delete')
  @ApiOperation({ summary: 'Discontinue a service user medical condition' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('conditionRecordId') conditionRecordId: string,
    @Req() req: Request,
  ) {
    return this.conditions.discontinue(
      user,
      serviceUserId,
      conditionRecordId,
      getRequestAuditMeta(req),
    );
  }
}

@ApiTags('Service User Reasonable Adjustments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/reasonable-adjustments')
export class ServiceUserReasonableAdjustmentsController {
  constructor(private readonly adjustments: ReasonableAdjustmentsService) {}

  @Get()
  @Permissions('service_users.medical_adjustments.read')
  @ApiOperation({ summary: 'List reasonable adjustments' })
  list(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.adjustments.list(user, serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.medical_adjustments.create')
  @ApiOperation({ summary: 'Create a reasonable adjustment' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateReasonableAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustments.create(user, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':adjustmentId')
  @Permissions('service_users.medical_adjustments.update')
  @ApiOperation({ summary: 'Update a reasonable adjustment' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body() dto: UpdateReasonableAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.adjustments.update(
      user,
      serviceUserId,
      adjustmentId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':adjustmentId')
  @Permissions('service_users.medical_adjustments.delete')
  @ApiOperation({ summary: 'Deactivate a reasonable adjustment' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('adjustmentId') adjustmentId: string,
    @Req() req: Request,
  ) {
    return this.adjustments.deactivate(
      user,
      serviceUserId,
      adjustmentId,
      getRequestAuditMeta(req),
    );
  }
}

@ApiTags('Service User Medical History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medical-history')
export class ServiceUserMedicalHistoryController {
  constructor(private readonly history: MedicalHistoryService) {}

  @Get()
  @Permissions('service_users.medical_history.read')
  @ApiOperation({ summary: 'List medical history events (newest first)' })
  list(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.history.list(user, serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.medical_history.create')
  @ApiOperation({ summary: 'Create a medical history event' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicalHistoryEventDto,
    @Req() req: Request,
  ) {
    return this.history.create(user, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':eventId')
  @Permissions('service_users.medical_history.update')
  @ApiOperation({ summary: 'Update a medical history event' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateMedicalHistoryEventDto,
    @Req() req: Request,
  ) {
    return this.history.update(user, serviceUserId, eventId, dto, getRequestAuditMeta(req));
  }

  @Delete(':eventId')
  @Permissions('service_users.medical_history.delete')
  @ApiOperation({ summary: 'Deactivate a medical history event' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ) {
    return this.history.deactivate(user, serviceUserId, eventId, getRequestAuditMeta(req));
  }
}

@ApiTags('Service User Monitoring Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/monitoring-config')
export class ServiceUserMonitoringConfigController {
  constructor(private readonly monitoring: MonitoringConfigService) {}

  @Get()
  @Permissions('service_users.medical_monitoring.read')
  @ApiOperation({ summary: 'List monitoring configuration' })
  list(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.monitoring.list(user, serviceUserId);
  }

  @Post()
  @Permissions('service_users.medical_monitoring.update')
  @ApiOperation({ summary: 'Upsert monitoring configuration (known keys only)' })
  upsert(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpsertMonitoringConfigDto,
    @Req() req: Request,
  ) {
    return this.monitoring.upsert(user, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete(':configKey')
  @Permissions('service_users.medical_monitoring.update')
  @ApiOperation({ summary: 'Deactivate monitoring configuration key' })
  deactivate(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('configKey') configKey: string,
    @Req() req: Request,
  ) {
    return this.monitoring.deactivate(
      user,
      serviceUserId,
      configKey,
      getRequestAuditMeta(req),
    );
  }
}

@ApiTags('Service User Usual Parameters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/usual-parameters')
export class ServiceUserUsualParametersController {
  constructor(private readonly usual: UsualParametersService) {}

  @Get()
  @Permissions('service_users.medical_usual_parameters.read')
  @ApiOperation({ summary: 'List usual/baseline observation parameters' })
  list(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.usual.list(user, serviceUserId);
  }

  @Post()
  @Permissions('service_users.medical_usual_parameters.update')
  @ApiOperation({ summary: 'Upsert a usual parameter for an observation type' })
  upsert(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpsertUsualParameterDto,
    @Req() req: Request,
  ) {
    return this.usual.upsert(user, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':usualParameterId')
  @Permissions('service_users.medical_usual_parameters.update')
  @ApiOperation({ summary: 'Update a usual parameter by id' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('usualParameterId') usualParameterId: string,
    @Body() dto: UpdateUsualParameterDto,
    @Req() req: Request,
  ) {
    return this.usual.update(
      user,
      serviceUserId,
      usualParameterId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':usualParameterId')
  @Permissions('service_users.medical_usual_parameters.update')
  @ApiOperation({ summary: 'Deactivate a usual parameter' })
  deactivate(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('usualParameterId') usualParameterId: string,
    @Req() req: Request,
  ) {
    return this.usual.update(
      user,
      serviceUserId,
      usualParameterId,
      { enabled: false },
      getRequestAuditMeta(req),
    );
  }
}

@ApiTags('Service User Medical Safety Summary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medical-safety-summary')
export class ServiceUserMedicalSafetySummaryController {
  constructor(private readonly summary: MedicalSafetySummaryService) {}

  @Get()
  @AnyPermission(
    'service_users.read',
    'service_users.medical_conditions.read',
    'service_users.medical_adjustments.read',
    'service_users.medical_history.read',
    'service_users.medical_monitoring.read',
    'service_users.medical_usual_parameters.read',
  )
  @ApiOperation({
    summary:
      'Compose medical/safety read model from existing SoTs (no writes; respects per-source permissions)',
  })
  get(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string) {
    return this.summary.getSummary(user, serviceUserId);
  }
}
