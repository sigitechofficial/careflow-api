import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { VisitPlanDateChangesService } from './visit-plan-date-changes.service';
import {
  VisitPlanAddExtraVisitsDto,
  VisitPlanCancelVisitsDto,
  VisitPlanDeleteExtraVisitDto,
  VisitPlanEditExtraVisitDto,
  VisitPlanCancelVisitsPreviewDto,
  VisitPlanDateChangesRangeQueryDto,
  VisitPlanExtraVisitsPreviewDto,
} from './dto/visit-plan-date-changes.dto';

@ApiTags('Service User Visit Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/visit-plans/:planId/date-changes')
export class VisitPlanDateChangesController {
  constructor(private readonly service: VisitPlanDateChangesService) {}

  @Get()
  @AnyPermission('service_users.visit_plan.read', 'service_users.read')
  @ApiOperation({ summary: 'Cancelled dates and extra visits recorded on a visit plan' })
  list(@Param('id') serviceUserId: string, @Param('planId') planId: string) {
    return this.service.listDateChanges(serviceUserId, planId);
  }

  @Get('cancellable-visits')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read')
  @ApiOperation({ summary: 'Upcoming visits of the plan that can still be cancelled' })
  cancellableVisits(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Query() query: VisitPlanDateChangesRangeQueryDto,
  ) {
    return this.service.listCancellableVisits(serviceUserId, planId, query);
  }

  @Post('cancel-preview')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Cancellation policy result for the selected visits (nothing is saved)' })
  cancelPreview(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: VisitPlanCancelVisitsPreviewDto,
  ) {
    return this.service.previewCancelVisits(serviceUserId, planId, dto);
  }

  @Post('cancel')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Cancel the selected visits on specific dates' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: VisitPlanCancelVisitsDto,
    @Req() req: Request,
  ) {
    return this.service.cancelVisits(user, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Post('extra-preview')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Check each date for an extra visit: free slot and no clash (nothing is saved)' })
  extraPreview(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: VisitPlanExtraVisitsPreviewDto,
  ) {
    return this.service.previewExtraVisits(serviceUserId, planId, dto);
  }

  @Post('extra')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Add extra visits on the chosen dates and create them on the rota' })
  addExtra(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: VisitPlanAddExtraVisitsDto,
    @Req() req: Request,
  ) {
    return this.service.addExtraVisits(user, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Patch('extra/:exceptionId')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Edit one extra visit before it starts (time, duration, carers, night type, reason)' })
  editExtra(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @Body() dto: VisitPlanEditExtraVisitDto,
    @Req() req: Request,
  ) {
    return this.service.editExtraVisit(user, serviceUserId, planId, exceptionId, dto, getRequestAuditMeta(req));
  }

  @Delete('extra/:exceptionId')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Delete one extra visit before it starts and take it off the rota' })
  deleteExtra(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @Body() dto: VisitPlanDeleteExtraVisitDto,
    @Req() req: Request,
  ) {
    return this.service.deleteExtraVisit(user, serviceUserId, planId, exceptionId, dto, getRequestAuditMeta(req));
  }
}
