import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentsService } from './initial-assessments.service';
import { InitialAssessmentReviewQueueQueryDto } from './dto/initial-assessment-review-queue-query.dto';
import { InitialAssessmentListQueryDto } from './dto/initial-assessment-list-query.dto';
import { InitialAssessmentsListService } from './initial-assessments-list.service';

@ApiTags('Initial Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('initial-assessments')
export class InitialAssessmentsAdminController {
  constructor(
    private readonly service: InitialAssessmentsService,
    private readonly listService: InitialAssessmentsListService,
  ) {}

  @Get('list')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.initial_assessment.review')
  @ApiOperation({
    summary: 'All service users in the caller\'s branches with their latest Initial Assessment (read-only list)',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: InitialAssessmentListQueryDto,
    @Req() req: Request,
  ) {
    return this.listService.list(user, query, getRequestAuditMeta(req));
  }

  @Get('review-queue')
  @AnyPermission('service_users.initial_assessment.review', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'Manager queue — submissions awaiting review or with overdue actions' })
  reviewQueue(
    @CurrentUser() user: RequestUser,
    @Query() query: InitialAssessmentReviewQueueQueryDto,
    @Req() req: Request,
  ) {
    return this.service.reviewQueue(user.id, query, getRequestAuditMeta(req));
  }
}
