import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { ServiceUserAssessmentsService } from './service-user-assessments.service';
import { CreateServiceUserAssessmentCompletionDto } from './dto/create-service-user-assessment-completion.dto';

@ApiTags('Service User Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/assessments')
export class ServiceUserAssessmentsController {
  constructor(private readonly service: ServiceUserAssessmentsService) {}

  @Get('catalogue')
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({ summary: 'List assessment tools and default pathway forms' })
  getCatalogue() {
    return this.service.getCatalogue();
  }

  @Get('completions/:completionId')
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({ summary: 'Get a completion detail' })
  getCompletion(@Param('serviceUserId') serviceUserId: string, @Param('completionId') completionId: string) {
    return this.service.getCompletion(serviceUserId, completionId);
  }

  @Get()
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({ summary: 'List assessments with latest completion' })
  list(@Param('serviceUserId') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get(':assessmentKey/completions')
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({ summary: 'List assessment completions' })
  listCompletions(
    @Param('serviceUserId') serviceUserId: string,
    @Param('assessmentKey') assessmentKey: string,
  ) {
    return this.service.listCompletions(serviceUserId, assessmentKey);
  }

  @Post(':assessmentKey/completions')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.assessments.create', 'service_users.update')
  @ApiOperation({ summary: 'Create a manual assessment completion' })
  createCompletion(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('assessmentKey') assessmentKey: string,
    @Body() dto: CreateServiceUserAssessmentCompletionDto,
    @Req() req: Request,
  ) {
    return this.service.createCompletion(
      user.id,
      serviceUserId,
      assessmentKey,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
