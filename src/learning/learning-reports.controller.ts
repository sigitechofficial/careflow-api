import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LearningReportQueryDto } from './dto/learning.dto';
import { LearningReportsService } from './learning-reports.service';

@ApiTags('Learning — Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/reports')
export class LearningReportsController {
  constructor(private readonly service: LearningReportsService) {}

  @Get('assignments')
  @Permissions('learning.reports.read')
  assignments(@Query() query: LearningReportQueryDto) {
    return this.service.assignments(query);
  }

  @Get('completions')
  @Permissions('learning.reports.read')
  completions(@Query() query: LearningReportQueryDto) {
    return this.service.completions(query);
  }

  @Get('compliance')
  @Permissions('learning.reports.read')
  compliance(@Query() query: LearningReportQueryDto) {
    return this.service.compliance(query);
  }

  @Get('assignments/export')
  @Permissions('learning.reports.export')
  exportAssignments(
    @CurrentUser() user: RequestUser,
    @Query() query: LearningReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.exportAssignmentsCsv(user.id, query, getRequestAuditMeta(req));
  }
}
