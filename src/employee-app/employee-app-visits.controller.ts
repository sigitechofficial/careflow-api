import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SaveVisitJobTasksDto } from '../scheduled-jobs-housekeeping/dto/save-visit-job-tasks.dto';
import { CreateServiceUserObservationDto } from '../service-user-observations/dto/create-service-user-observation.dto';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppVisitCheckInDto } from './dto/employee-app-visit-check-in.dto';
import { EmployeeAppVisitCompleteDto } from './dto/employee-app-visit-complete.dto';

@ApiTags('Employee App Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/visits')
export class EmployeeAppVisitsController {
  constructor(private readonly visitsService: EmployeeAppVisitsService) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Visit workspace shell + overview tab' })
  workspace(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getWorkspace(user.employeeId!, jobId);
  }

  @Post(':jobId/check-in')
  @ApiOperation({ summary: 'Check in to visit (GPS + identity confirmation)' })
  checkIn(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppVisitCheckInDto,
  ) {
    return this.visitsService.checkIn(user.employeeId!, jobId, dto);
  }

  @Get(':jobId/tasks')
  @ApiOperation({ summary: 'Visit tasks tab (required + optional)' })
  tasks(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getTasks(user.employeeId!, jobId);
  }

  @Patch(':jobId/tasks')
  @ApiOperation({ summary: 'Save visit task completions' })
  saveTasks(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: SaveVisitJobTasksDto,
  ) {
    return this.visitsService.saveTasks(user.employeeId!, jobId, dto);
  }

  @Get(':jobId/medication')
  @ApiOperation({ summary: 'Visit MAR tab (scheduled + PRN medicines)' })
  medication(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getMedication(user.employeeId!, jobId);
  }

  @Get(':jobId/observations')
  @ApiOperation({ summary: 'Visit observations tab' })
  observations(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getObservations(user.employeeId!, jobId);
  }

  @Post(':jobId/observations')
  @ApiOperation({ summary: 'Record an observation during this visit' })
  createObservation(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: CreateServiceUserObservationDto,
  ) {
    return this.visitsService.createObservation(user.employeeId!, jobId, dto);
  }

  @Get(':jobId/log')
  @ApiOperation({ summary: 'Visit log tab (timeline + handover note)' })
  log(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getLog(user.employeeId!, jobId);
  }

  @Get(':jobId/body-map')
  @ApiOperation({ summary: 'Body map handover for visit workspace' })
  bodyMap(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getBodyMap(user.employeeId!, jobId);
  }

  @Post(':jobId/complete')
  @ApiOperation({ summary: 'Complete / check out of visit' })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppVisitCompleteDto,
    @Req() req: Request,
  ) {
    void getRequestAuditMeta(req);
    return this.visitsService.complete(user.employeeId!, jobId, dto);
  }
}
