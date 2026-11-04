import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { EmployeeAppClientDetailService } from './employee-app-client-detail.service';
import { EmployeeAppAlertsService } from './employee-app-alerts.service';

class EmployeeAppClientsQueryDto {
  @ApiPropertyOptional({ example: 'Mary' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

class EmployeeAppClientDateQueryDto {
  @ApiPropertyOptional({ example: '2026-07-16' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

class AcknowledgeCarePlanDto {
  @ApiProperty({ description: 'The published version the carer has read (must be the current one).' })
  @IsUUID()
  publishedVersionId!: string;
}

@ApiTags('Employee App Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app')
export class EmployeeAppClientsController {
  constructor(
    private readonly clientsService: EmployeeAppClientsService,
    private readonly clientDetailService: EmployeeAppClientDetailService,
    private readonly alertsService: EmployeeAppAlertsService,
  ) {}

  @Get('clients')
  @ApiOperation({ summary: 'Clients on the carer round' })
  @ApiQuery({ name: 'search', required: false })
  clients(@CurrentUser() user: RequestUser, @Query() query: EmployeeAppClientsQueryDto) {
    return this.clientsService.getClients(user.employeeId!, { search: query.search });
  }

  @Get('clients/:clientId')
  @ApiOperation({ summary: 'Client profile overview' })
  profile(
    @CurrentUser() user: RequestUser,
    @Param('clientId') clientId: string,
    @Query() query: EmployeeAppClientDateQueryDto,
  ) {
    return this.clientDetailService.getProfile(user.employeeId!, clientId, query.date);
  }

  @Get('clients/:clientId/alerts')
  @ApiOperation({ summary: 'Service-user safety alerts (prioritised feed for visit details)' })
  alerts(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.alertsService.getAlerts(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/documents')
  @ApiOperation({ summary: 'Client documents (offline-ready list)' })
  documents(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getDocuments(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/medications')
  @ApiOperation({ summary: 'Client medications + recent administration history' })
  medications(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getMedications(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/assessments')
  @ApiOperation({ summary: 'Assessments & continuity of care' })
  assessments(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getAssessments(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/history-trends')
  @ApiOperation({ summary: 'History & trends charts (BP, fluid, weight, mood)' })
  historyTrends(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getHistoryTrends(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/consent-capacity')
  @ApiOperation({ summary: 'Consent & mental capacity (LPA + decision-specific)' })
  consentCapacity(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getConsentCapacity(user.employeeId!, clientId);
  }

  @Get('clients/:clientId/care-plan')
  @ApiOperation({ summary: 'Published care plans for a client (list)' })
  carePlan(@CurrentUser() user: RequestUser, @Param('clientId') clientId: string) {
    return this.clientDetailService.getCarePlan(user.employeeId!, clientId);
  }

  @Post('clients/:clientId/care-plan/:instanceId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge the current published version of a care plan (idempotent)' })
  acknowledgeCarePlan(
    @CurrentUser() user: RequestUser,
    @Param('clientId') clientId: string,
    @Param('instanceId') instanceId: string,
    @Body() dto: AcknowledgeCarePlanDto,
  ) {
    return this.clientDetailService.acknowledgeCarePlan(
      user.employeeId!,
      user.id,
      clientId,
      instanceId,
      dto.publishedVersionId,
    );
  }

  @Get('clients/:clientId/care-plan/:instanceId')
  @ApiOperation({ summary: 'Latest published version of one care plan' })
  carePlanDetail(
    @CurrentUser() user: RequestUser,
    @Param('clientId') clientId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.clientDetailService.getCarePlanDetail(user.employeeId!, clientId, instanceId);
  }
}
