import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyAccessService } from './survey-access.service';
import { CopyRecipientLinksDto, CreateShareLinkDto, RecordSurveyExportDto, SetSharedLinkDto, SharedLinkLimitDto, SharedLinkSettingsDto, SurveySectionChangeDto, SurveySectionPlaceDto, SurveyAccessPeopleQueryDto, UpdateSurveyAccessDto } from './dto/survey-access.dto';
import { SurveyShareLinksService } from './survey-share-links.service';
import { SurveyRecipientLinksService } from './survey-recipient-links.service';
import { SurveySectionsService } from './survey-sections.service';

/** Who may see a survey's individual responses and its results, and its reporting threshold. */
@ApiTags('Survey access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/access')
export class SurveyAccessController {
  constructor(private readonly access: SurveyAccessService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Who can see this survey’s answers and results' })
  get(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.access.get(user, surveyId);
  }

  @Get('people')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Office users who can be named' })
  people(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Query() q: SurveyAccessPeopleQueryDto) {
    return this.access.people(user, surveyId, q.search);
  }

  @Post('exports')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Note that the results were downloaded (audited; the download waits for this)' })
  recordExport(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: RecordSurveyExportDto, @Req() req: Request) {
    return this.access.recordExport(user, surveyId, dto, getRequestAuditMeta(req));
  }

  @Put()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change who can see this survey’s answers and results (admins and the survey’s maker only)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: UpdateSurveyAccessDto,
    @Req() req: Request,
  ) {
    return this.access.update(user, surveyId, dto, getRequestAuditMeta(req));
  }
}

/** Shared links: the main link and one link per branch (public surveys, and staff / service-user surveys with the shared link on). */
@ApiTags('Survey links')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/share-links')
export class SurveyShareLinksController {
  constructor(private readonly links: SurveyShareLinksService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'The main link and the branch links' })
  list(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.links.list(user, surveyId);
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Make a link for one branch (its answers carry the branch)' })
  create(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: CreateShareLinkDto, @Req() req: Request) {
    return this.links.create(user, surveyId, dto.locationId, getRequestAuditMeta(req));
  }

  @Put('enabled')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Staff and service-user surveys: turn the shared link on (always a new link) or off' })
  setEnabled(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SetSharedLinkDto, @Req() req: Request) {
    return this.links.setSharedLink(user, surveyId, dto.enabled, getRequestAuditMeta(req));
  }

  @Put('settings')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Shared link settings: one answer per device' })
  settings(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SharedLinkSettingsDto, @Req() req: Request) {
    return this.links.updateSettings(user, surveyId, { oncePerDevice: dto.oncePerDevice }, getRequestAuditMeta(req));
  }

  @Put('limit')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Raise the answers-per-10-minutes limit for a planned sitting, or put the standard one back (audited)' })
  limit(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SharedLinkLimitDto, @Req() req: Request) {
    return this.links.setLinkLimit(user, surveyId, { limit: dto.limit ?? null, until: dto.until ?? null }, getRequestAuditMeta(req));
  }

  @Post('paper-copy')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Note that a paper copy was printed (audited)' })
  paperCopy(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Req() req: Request) {
    return this.links.paperCopyPrinted(user, surveyId, getRequestAuditMeta(req));
  }

  @Post('main/renew')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'A new main shared link; the old one stops working' })
  renewMain(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Req() req: Request) {
    return this.links.renewMain(user, surveyId, getRequestAuditMeta(req));
  }

  @Delete(':linkId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Turn a branch link off (?replace=true makes a new one for the branch)' })
  turnOff(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Query('replace') replace: string | undefined,
    @Req() req: Request,
  ) {
    return this.links.turnOff(user, surveyId, linkId, { replace: replace === 'true' }, getRequestAuditMeta(req));
  }
}

/** Named staff and service-user surveys: people's own links (copy, mail merge, a new link for one person). */
@ApiTags('Survey links')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/recipient-links')
export class SurveyRecipientLinksController {
  constructor(private readonly links: SurveyRecipientLinksService) {}

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: "Copy people's own links (one, all, or for a mail merge); audited" })
  copy(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: CopyRecipientLinksDto, @Req() req: Request) {
    return this.links.copyLinks(user, surveyId, dto, getRequestAuditMeta(req));
  }

  @Get('history')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Who copied people’s links or made a new one, and when (never the links)' })
  history(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.links.history(user, surveyId);
  }

  @Post(':recipientId/renew')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'A new link for one person; their old link stops working' })
  renew(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Req() req: Request,
  ) {
    return this.links.renewLink(user, surveyId, recipientId, getRequestAuditMeta(req));
  }
}

/** The section manager: rename, introduction, move as a block, remove (questions kept), put together. */
@ApiTags('Survey sections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/sections')
export class SurveySectionsController {
  constructor(private readonly sections: SurveySectionsService) {}

  @Post('change')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Rename a section, set its introduction, or move it up / down as a block' })
  change(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SurveySectionChangeDto, @Req() req: Request) {
    const meta = getRequestAuditMeta(req);
    if (dto.move) return this.sections.move(user, surveyId, dto.title, dto.move, meta);
    if (dto.rename !== undefined) return this.sections.rename(user, surveyId, dto.title, dto.rename, meta);
    if (dto.introduction !== undefined) return this.sections.setIntroduction(user, surveyId, dto.title, dto.introduction, meta);
    throw new BadRequestException('Say what to change: rename, introduction or move.');
  }

  @Post('remove')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remove a section; its questions stay, without a heading' })
  remove(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SurveySectionChangeDto, @Req() req: Request) {
    return this.sections.remove(user, surveyId, dto.title, getRequestAuditMeta(req));
  }

  @Post('place')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Move one question into a section (or out of every section), at the end of it' })
  place(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SurveySectionPlaceDto, @Req() req: Request) {
    return this.sections.place(user, surveyId, dto.questionId, dto.title ?? null, getRequestAuditMeta(req));
  }

  @Post('gather')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Put a split section back together where it first appears' })
  gather(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SurveySectionChangeDto, @Req() req: Request) {
    return this.sections.gather(user, surveyId, dto.title, getRequestAuditMeta(req));
  }
}
