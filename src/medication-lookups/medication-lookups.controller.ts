import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationLookupsService } from './medication-lookups.service';
import {
  LookupItemDto,
  MedicationLookupsBundleResponseDto,
} from './dto/medication-lookups-response.dto';

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
  @ApiOkResponse({ type: MedicationLookupsBundleResponseDto })
  @ApiMedicationStandardResponses()
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
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  types() {
    return this.service.types();
  }

  @Get('routes')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Routes of administration' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  routes() {
    return this.service.routes();
  }

  @Get('categories')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication categories' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  categories() {
    return this.service.categories();
  }

  @Get('frequencies')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication frequencies' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  frequencies() {
    return this.service.frequencies();
  }

  @Get('rounds')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication administration rounds (time slots)' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  rounds() {
    return this.service.rounds();
  }

  @Get('not-given-reasons')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Not-given reason lookup values' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  notGivenReasons() {
    return this.service.notGivenReasons();
  }

  @Get('status-codes')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'MAR status codes with colors and rules' })
  @ApiOkResponse({ type: [LookupItemDto] })
  @ApiMedicationStandardResponses()
  statusCodes() {
    return this.service.statusCodes();
  }
}
