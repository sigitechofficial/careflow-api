import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { FeedbackService } from './feedback.service';
import {
  CreateFeedbackDto,
  DeleteFeedbackDto,
  FeedbackListQueryDto,
  FeedbackNoteDto,
  FeedbackTransitionDto,
  UpdateFeedbackDto,
} from './dto/feedback.dto';
import {
  PauseIncidentInvestigationDto,
  UpsertIncidentInvestigationDto,
} from '../incidents/dto/incident-review.dto';

@ApiTags('Complaints & Compliments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  @Permissions('complaints.read')
  @ApiOperation({ summary: 'Complaints and compliments in scope' })
  list(@CurrentUser() user: RequestUser, @Query() query: FeedbackListQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @Permissions('complaints.read')
  summary(@CurrentUser() user: RequestUser) {
    return this.service.summary(user);
  }

  @Get(':id')
  @Permissions('complaints.read')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user, id);
  }

  @Post()
  @Permissions('complaints.manage')
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFeedbackDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('complaints.manage')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeedbackDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/transition')
  @Permissions('complaints.manage')
  @ApiOperation({
    summary: 'Acknowledge, investigate, respond, close, reopen or share',
  })
  transition(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackTransitionDto,
    @Req() req: Request,
  ) {
    return this.service.transition(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/investigation')
  @Permissions('complaints.manage')
  @ApiOperation({ summary: 'Save the complaint investigation (same form as incidents)' })
  upsertInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertIncidentInvestigationDto,
    @Req() req: Request,
  ) {
    return this.service.upsertInvestigation(user, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id/investigators')
  @Permissions('complaints.manage')
  @ApiOperation({ summary: 'Staff who can lead the investigation' })
  investigators(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.eligibleInvestigators(user, id);
  }

  @Post(':id/investigation/pause')
  @Permissions('complaints.manage')
  pauseInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseIncidentInvestigationDto,
    @Req() req: Request,
  ) {
    return this.service.pauseInvestigation(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/investigation/resume')
  @Permissions('complaints.manage')
  resumeInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.resumeInvestigation(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/notes')
  @Permissions('complaints.manage')
  addNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackNoteDto,
  ) {
    return this.service.addNote(user, id, dto.note);
  }

  @Delete(':id')
  @Permissions('complaints.manage')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteFeedbackDto,
    @Req() req: Request,
  ) {
    return this.service.remove(user, id, dto.reason, getRequestAuditMeta(req));
  }
}
