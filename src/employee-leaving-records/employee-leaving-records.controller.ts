import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeLeavingRecordsService } from './employee-leaving-records.service';
import { CreateEmployeeLeavingRecordDto } from './dto/create-employee-leaving-record.dto';
import { UpdateEmployeeLeavingRecordDto } from './dto/update-employee-leaving-record.dto';

@ApiTags('Employee Leaving Records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/leaving-records')
export class EmployeeLeavingRecordsController {
  constructor(private readonly service: EmployeeLeavingRecordsService) {}

  @Get()
  @Permissions('employees.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('employees.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: CreateEmployeeLeavingRecordDto,
  ) {
    return this.service.create(user.id, employeeId, dto);
  }

  @Patch(':recordId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateEmployeeLeavingRecordDto,
  ) {
    return this.service.update(user.id, employeeId, recordId, dto);
  }

  @Delete(':recordId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.service.remove(user.id, employeeId, recordId);
  }
}

