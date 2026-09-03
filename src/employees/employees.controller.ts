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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeesService } from './employees.service';
import { EmployeePortalAccountsService } from './employee-portal-accounts.service';
import { EmployeeVisitsService } from './employee-visits.service';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { EmployeeDocumentsRegistryQueryDto } from './dto/employee-documents-registry-query.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import {
  SetEmployeePortalPasswordDto,
  UpsertEmployeePortalAccountDto,
} from './dto/employee-portal-account.dto';
import { EmployeeVisitsQueryDto } from './dto/employee-visits-query.dto';
import { ScheduleImpactPreviewQueryDto } from '../schedule-lifecycle-impact/dto/schedule-impact-preview-query.dto';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly portalAccountsService: EmployeePortalAccountsService,
    private readonly employeeVisitsService: EmployeeVisitsService,
  ) {}

  @Get()
  @Permissions('employees.read')
  async list(@CurrentUser() user: RequestUser, @Query() query: EmployeeQueryDto) {
    return this.employeesService.list(query, user);
  }

  @Get('list-facets')
  @Permissions('employees.read')
  listFilterFacets(@CurrentUser() user: RequestUser, @Query() query: EmployeeQueryDto) {
    return this.employeesService.listFilterFacets(query, user);
  }

  @Get('chart-summary')
  @Permissions('employees.read')
  chartSummary(@CurrentUser() user: RequestUser, @Query() query: EmployeeQueryDto) {
    return this.employeesService.chartSummary(query, user);
  }

  @Get('documents-registry')
  @Permissions('employees.documents.read')
  documentsRegistry(@Query() query: EmployeeDocumentsRegistryQueryDto) {
    return this.employeesService.listDocumentsRegistry(query);
  }

  @Get('skills-overview')
  @Permissions('employees.read')
  skillsOverview() {
    return this.employeesService.skillsOverview();
  }

  @Get('non-core-activities-registry')
  @Permissions('employees.read')
  nonCoreActivitiesRegistry() {
    return this.employeesService.nonCoreActivitiesRegistry();
  }

  @Get(':id/schedule-impact-preview')
  @Permissions('employees.read')
  previewScheduleImpact(@Param('id') id: string, @Query() query: ScheduleImpactPreviewQueryDto) {
    return this.employeesService.previewScheduleImpact(id, query);
  }

  @Get(':id/visits')
  @AnyPermission('employees.read', 'employees.update', 'schedule_timelines.read')
  @ApiOperation({
    summary: 'Employee Visits tab — monthly allocated visits with delivery assessment',
  })
  visits(@Param('id') id: string, @Query() query: EmployeeVisitsQueryDto) {
    return this.employeeVisitsService.getVisitsForMonth(id, query.month);
  }

  @Get(':id/portal-account')
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Employee app portal account status' })
  getPortalAccount(@Param('id') id: string) {
    return this.portalAccountsService.getAdminStatus(id);
  }

  @Put(':id/portal-account')
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Enable/disable employee app access and set login email' })
  upsertPortalAccount(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpsertEmployeePortalAccountDto,
  ) {
    return this.portalAccountsService.upsertAdmin(user.id, id, dto);
  }

  @Post(':id/portal-account/set-password')
  @HttpCode(HttpStatus.OK)
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Set or reset employee app password (admin)' })
  setPortalPassword(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetEmployeePortalPasswordDto,
  ) {
    return this.portalAccountsService.setPassword(user.id, id, dto.password);
  }

  @Get(':id')
  @Permissions('employees.read')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.employeesService.getById(id, { actorUserId: user.id, ...m }, user);
  }

  @Post()
  @Permissions('employees.create')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateEmployeeDto, @Req() req: Request) {
    return this.employeesService.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: Request,
  ) {
    return this.employeesService.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('employees.delete')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.employeesService.softDelete(user.id, id, getRequestAuditMeta(req));
  }

  @Patch(':id/status')
  @Permissions('employees.status.update')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeStatusDto,
    @Req() req: Request,
  ) {
    return this.employeesService.updateStatus(user.id, id, dto, getRequestAuditMeta(req));
  }
}
