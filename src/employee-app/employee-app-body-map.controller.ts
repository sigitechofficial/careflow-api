import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppBodyMapWizardSubmitDto } from './dto/employee-app-body-map-wizard.dto';
import { EmployeeAppCreateBodyMapRecordDto } from './dto/employee-app-body-map-record.dto';

/**
 * Dedicated mobile body map API — admin-parity wizard (Type → Location → Observation → Cause → Action).
 * Records sync to schedule-jobs visit workspace via scheduledJobId on the clinical chart.
 */
@ApiTags('Employee App Body Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/visits/:jobId/body-map')
export class EmployeeAppBodyMapController {
  constructor(private readonly visitsService: EmployeeAppVisitsService) {}

  @Get('wizard')
  @ApiOperation({
    summary: 'Body map wizard bootstrap (mobile)',
    description:
      'Lookups, diagram assets, active records, wizard steps/fields (same as admin Add body map record), eligible MAR lines, and canRecord.',
  })
  wizard(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getBodyMapWizard(user.employeeId!, jobId);
  }

  @Post('wizard/records')
  @ApiOperation({
    summary: 'Save body map record from mobile wizard (admin parity)',
    description:
      'Submit after all wizard steps. Creates the same BodyMapRecord as admin POST /body-map/records and links to this visit for schedule-jobs workspace.',
  })
  submitWizard(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppBodyMapWizardSubmitDto,
  ) {
    return this.visitsService.submitBodyMapWizardRecord(user.employeeId!, jobId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Body map bootstrap (legacy — prefer GET wizard)' })
  bootstrap(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getBodyMap(user.employeeId!, jobId);
  }

  @Post('records')
  @ApiOperation({ summary: 'Create body map record (legacy flat DTO — prefer POST wizard/records)' })
  createRecord(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppCreateBodyMapRecordDto,
  ) {
    return this.visitsService.createBodyMapRecord(user.employeeId!, jobId, dto);
  }
}
