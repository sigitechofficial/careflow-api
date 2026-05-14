import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { DataAccessType } from '@prisma/client';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MedicationLookupsService } from './medication-lookups.service';

@ApiTags('Medication Lookups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('medication-lookups')
export class MedicationLookupsController {
  constructor(
    private readonly service: MedicationLookupsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Get()
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'All medication lookup tables' })
  @ApiResponse({ status: 200 })
  async all(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const meta = getRequestAuditMeta(req);
    await this.auditLogs.logDataAccess({
      userId: user.id,
      module: AuditModule.MEDICATION,
      recordType: 'MedicationLookup',
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: { path: 'bundle' },
    });
    const data = await this.service.bundle();
    return { data, message: 'Medication lookups loaded' };
  }

  @Get('types')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication types' })
  types() {
    return this.service.types();
  }

  @Get('routes')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Routes of administration' })
  routes() {
    return this.service.routes();
  }

  @Get('categories')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication categories' })
  categories() {
    return this.service.categories();
  }

  @Get('frequencies')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  frequencies() {
    return this.service.frequencies();
  }

  @Get('rounds')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  rounds() {
    return this.service.rounds();
  }

  @Get('not-given-reasons')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  notGivenReasons() {
    return this.service.notGivenReasons();
  }
}
