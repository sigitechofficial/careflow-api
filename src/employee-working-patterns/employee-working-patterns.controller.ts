import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeWorkingPatternsService } from './employee-working-patterns.service';
import { BulkReplaceWorkingPatternsDto } from './dto/bulk-replace-working-patterns.dto';
import { CreateWorkingPatternDto } from './dto/create-working-pattern.dto';
import { UpdateWorkingPatternDto } from './dto/update-working-pattern.dto';

@ApiTags('Employee Working Patterns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/working-patterns')
export class EmployeeWorkingPatternsController {
  constructor(private readonly service: EmployeeWorkingPatternsService) {}

  @Get()
  @Permissions('employees.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('employees.update')
  create(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Body() dto: CreateWorkingPatternDto) {
    return this.service.create(user.id, employeeId, dto);
  }

  @Put('bulk')
  @Permissions('employees.update')
  bulkReplace(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: BulkReplaceWorkingPatternsDto,
  ) {
    return this.service.bulkReplace(user.id, employeeId, dto);
  }

  @Patch(':patternId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('patternId') patternId: string,
    @Body() dto: UpdateWorkingPatternDto,
  ) {
    return this.service.update(user.id, employeeId, patternId, dto);
  }

  @Delete(':patternId')
  @Permissions('employees.update')
  remove(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Param('patternId') patternId: string) {
    return this.service.remove(user.id, employeeId, patternId);
  }
}

