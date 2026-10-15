import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IncidentCandourService } from './incident-candour.service';
import {
  CandourAttemptDto,
  CandourDecisionDto,
  CandourResultsDto,
  CandourToldDto,
  CandourUnableDto,
  CandourWrittenDto,
} from './dto/incident-candour.dto';

/** Duty of Candour (Regulation 20) — one record per affected service user. */
@ApiTags('Incidents — Duty of Candour')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('incidents/:id/candour/:serviceUserId')
export class IncidentCandourController {
  constructor(private readonly service: IncidentCandourService) {}

  @Post('decision')
  @Permissions('incidents.review')
  @ApiOperation({ summary: 'Decide whether Duty of Candour applies (with the health professional consulted)' })
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourDecisionDto,
    @Req() req: Request,
  ) {
    return this.service.decide(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('told')
  @AnyPermission('incidents.review', 'incidents.close')
  @ApiOperation({ summary: 'Record telling the person in person (facts, enquiries, apology, support)' })
  told(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourToldDto,
    @Req() req: Request,
  ) {
    return this.service.recordTold(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('written')
  @AnyPermission('incidents.review', 'incidents.close')
  @ApiOperation({ summary: 'Record the written follow-up (with a copy of the letter)' })
  written(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourWrittenDto,
    @Req() req: Request,
  ) {
    return this.service.recordWritten(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('results')
  @AnyPermission('incidents.review', 'incidents.close')
  @ApiOperation({ summary: 'Record the results shared (or why there are no further enquiries)' })
  results(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourResultsDto,
    @Req() req: Request,
  ) {
    return this.service.recordResults(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('unable')
  @AnyPermission('incidents.review', 'incidents.close')
  @ApiOperation({ summary: 'Record that the person could not be told (Regulation 20(5))' })
  unable(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourUnableDto,
    @Req() req: Request,
  ) {
    return this.service.recordUnable(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('attempts')
  @AnyPermission('incidents.review', 'incidents.close')
  @ApiOperation({ summary: 'Add a contact attempt' })
  attempt(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CandourAttemptDto,
    @Req() req: Request,
  ) {
    return this.service.addAttempt(user, id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
