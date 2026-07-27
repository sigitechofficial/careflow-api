import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LearningComplianceQueryDto } from './dto/learning.dto';
import { LearningComplianceService } from './learning-compliance.service';

@ApiTags('Learning — Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/compliance')
export class LearningComplianceController {
  constructor(private readonly service: LearningComplianceService) {}

  @Get('matrix')
  @Permissions('learning.compliance.read')
  @ApiOperation({ summary: 'Compliance matrix' })
  matrix(@Query() query: LearningComplianceQueryDto) {
    return this.service.matrix(query);
  }

  @Get('employees')
  @Permissions('learning.compliance.read')
  @ApiOperation({ summary: 'Employee compliance rows' })
  employees(@Query() query: LearningComplianceQueryDto) {
    return this.service.employees(query);
  }

  @Get('courses')
  @Permissions('learning.compliance.read')
  @ApiOperation({ summary: 'Course compliance rows' })
  courses(@Query() query: LearningComplianceQueryDto) {
    return this.service.courses(query);
  }

  @Get('export')
  @Permissions('learning.compliance.export')
  @ApiOperation({ summary: 'Export compliance matrix CSV' })
  export(
    @CurrentUser() user: RequestUser,
    @Query() query: LearningComplianceQueryDto,
    @Req() req: Request,
  ) {
    return this.service.exportCsv(user.id, query, getRequestAuditMeta(req));
  }
}
