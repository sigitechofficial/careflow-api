import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAbsencesService } from './employee-absences.service';
import {
  CreateEmployeeAbsenceDto,
  ListEmployeeAbsencesQueryDto,
  UpdateEmployeeAbsenceDto,
} from './dto/employee-absence.dto';

@ApiTags('Employee Absences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-absences')
export class EmployeeAbsencesController {
  constructor(private readonly service: EmployeeAbsencesService) {}

  @Get()
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary: 'UKVI-aware absence tracker — durations, evidence, SMS triggers and risk ratings',
  })
  list(@Query() query: ListEmployeeAbsencesQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @AnyPermission('employees.update', 'employees.create')
  @ApiOperation({ summary: 'Record a new absence' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateEmployeeAbsenceDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @AnyPermission('employees.update')
  @ApiOperation({ summary: 'Update an absence record' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeAbsenceDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  @AnyPermission('employees.update')
  @ApiOperation({ summary: 'Soft-delete an absence record' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
