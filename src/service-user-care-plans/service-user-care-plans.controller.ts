import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { ServiceUserCarePlansService } from './service-user-care-plans.service';
import { CarePlanComposeService } from './care-plan-compose.service';
import { PublishCarePlanDto, SaveCarePlanDraftDto } from './dto/save-care-plan-draft.dto';

@ApiTags('Service User Care Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/care-plans')
export class ServiceUserCarePlansController {
  constructor(
    private readonly service: ServiceUserCarePlansService,
    private readonly composeService: CarePlanComposeService,
  ) {}

  @Get()
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'List care plan instances for a service user' })
  list(@Param('serviceUserId') serviceUserId: string) {
    return this.service.listInstances(serviceUserId);
  }

  @Get(':carePathwayFormId/versions/:versionId')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Get a published care plan version' })
  getVersion(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.getVersion(serviceUserId, carePathwayFormId, versionId);
  }

  @Get(':carePathwayFormId/versions')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'List published care plan versions' })
  listVersions(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service.listVersions(serviceUserId, carePathwayFormId);
  }

  @Get(':carePathwayFormId/compose')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Compose care plan draft values from sources of truth' })
  compose(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.composeService.compose(serviceUserId, carePathwayFormId);
  }

  @Get(':carePathwayFormId')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Get care plan instance with draft and latest publish' })
  get(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service.getInstance(serviceUserId, carePathwayFormId);
  }

  @Post(':carePathwayFormId/instance')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Create care plan instance if missing' })
  ensureInstance(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service
      .getOrCreateInstance(user.id, serviceUserId, carePathwayFormId)
      .then(() => this.service.getInstance(serviceUserId, carePathwayFormId));
  }

  @Patch(':carePathwayFormId/draft')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Save care plan draft' })
  saveDraft(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: SaveCarePlanDraftDto,
    @Req() req: Request,
  ) {
    return this.service.saveDraft(
      user.id,
      serviceUserId,
      carePathwayFormId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':carePathwayFormId/publish')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Publish care plan draft as new version' })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: PublishCarePlanDto,
    @Req() req: Request,
  ) {
    return this.service.publish(
      user.id,
      serviceUserId,
      carePathwayFormId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
