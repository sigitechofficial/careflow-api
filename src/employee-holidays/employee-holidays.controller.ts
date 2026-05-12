import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeHolidaysService } from './employee-holidays.service';
import { CreateEmployeeHolidayDto } from './dto/create-employee-holiday.dto';
import { UpdateEmployeeHolidayDto } from './dto/update-employee-holiday.dto';

@ApiTags('Employee Holidays')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/holidays')
export class EmployeeHolidaysController {
  constructor(private readonly service: EmployeeHolidaysService) {}

  @Get()
  @Permissions('employees.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('employees.update')
  create(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Body() dto: CreateEmployeeHolidayDto) {
    return this.service.create(user.id, employeeId, dto);
  }

  @Patch(':holidayId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('holidayId') holidayId: string,
    @Body() dto: UpdateEmployeeHolidayDto,
  ) {
    return this.service.update(user.id, employeeId, holidayId, dto);
  }

  @Delete(':holidayId')
  @Permissions('employees.update')
  remove(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Param('holidayId') holidayId: string) {
    return this.service.remove(user.id, employeeId, holidayId);
  }
}

