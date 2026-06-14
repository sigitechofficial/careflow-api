import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CreateCarePlanAssessmentLinkDto } from './dto/create-care-plan-assessment-link.dto';
import { ServiceUserAssessmentsService } from './service-user-assessments.service';

@ApiTags('Service User Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/care-plans/:carePlanFormId/assessment-links')
export class ServiceUserCarePlanAssessmentLinksController {
  constructor(private readonly service: ServiceUserAssessmentsService) {}

  @Get()
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({ summary: 'List assessment completions linked to a care plan form' })
  listLinks(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePlanFormId') carePlanFormId: string,
  ) {
    return this.service.listCarePlanAssessmentLinks(serviceUserId, carePlanFormId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.assessments.link', 'service_users.update')
  @ApiOperation({ summary: 'Link an assessment completion to a care plan form' })
  createLink(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePlanFormId') carePlanFormId: string,
    @Body() dto: CreateCarePlanAssessmentLinkDto,
    @Req() req: Request,
  ) {
    return this.service.linkCompletionToCarePlan(
      user.id,
      serviceUserId,
      carePlanFormId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AnyPermission('service_users.assessments.link', 'service_users.update')
  @ApiOperation({ summary: 'Unlink an assessment completion from a care plan form' })
  async removeLink(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    await this.service.unlinkCompletionFromCarePlan(
      user.id,
      serviceUserId,
      linkId,
      getRequestAuditMeta(req),
    );
  }
}
