import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeesService } from './employees.service';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { ScheduleImpactPreviewQueryDto } from '../schedule-lifecycle-impact/dto/schedule-impact-preview-query.dto';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @Permissions('employees.read')
  async list(@Query() query: EmployeeQueryDto) {
    return this.employeesService.list(query);
  }

  @Get('list-facets')
  @Permissions('employees.read')
  listFilterFacets(@Query() query: EmployeeQueryDto) {
    return this.employeesService.listFilterFacets(query);
  }

  @Get('chart-summary')
  @Permissions('employees.read')
  chartSummary(@Query() query: EmployeeQueryDto) {
    return this.employeesService.chartSummary(query);
  }

  @Get('documents-registry')
  @Permissions('employees.documents.read')
  documentsRegistry() {
    return this.employeesService.listDocumentsRegistry();
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

  @Get(':id')
  @Permissions('employees.read')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.employeesService.getById(id, { actorUserId: user.id, ...m });
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
