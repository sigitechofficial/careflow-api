import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateHrProfileDto } from './dto/create-hr-profile.dto';
import { HrEmployeeListQueryDto } from './dto/hr-employee-list-query.dto';
import { UpdateHrProfileDto } from './dto/update-hr-profile.dto';
import { HrProfileService } from './hr-profile.service';

@ApiTags('HR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employees')
export class HrEmployeesController {
  constructor(private readonly hrProfileService: HrProfileService) {}

  @Get()
  @Permissions('hr.read')
  list(@Query() query: HrEmployeeListQueryDto) {
    return this.hrProfileService.list(query);
  }

  @Get('summary')
  @Permissions('hr.read')
  summary() {
    return this.hrProfileService.summary();
  }

  @Post(':employeeId/hr-profile')
  @Permissions('hr.profile.create')
  createProfile(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateHrProfileDto,
    @Req() req: Request,
  ) {
    return this.hrProfileService.createProfile(
      user.id,
      employeeId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get(':employeeId/hr-profile')
  @Permissions('hr.read')
  getProfile(@Param('employeeId') employeeId: string) {
    return this.hrProfileService.getProfile(employeeId);
  }

  @Patch(':employeeId/hr-profile')
  @Permissions('hr.profile.update')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpdateHrProfileDto,
    @Req() req: Request,
  ) {
    return this.hrProfileService.updateProfile(
      user.id,
      employeeId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
