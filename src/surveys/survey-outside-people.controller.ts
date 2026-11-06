import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyOutsidePeopleService } from './survey-outside-people.service';
import { OutsideContactDto, OutsideListDto, OutsideOptOutDto, OutsideSourceDto, SendOutsideDto } from './dto/survey-outside-people.dto';

const ids = (raw?: string) => (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));

/** Outside people (families, professionals, commissioners) and their contact lists: surveys.manage. */
@ApiTags('Survey outside people')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-outside-people')
export class SurveyOutsidePeopleController {
  constructor(private readonly outside: SurveyOutsidePeopleService) {}

  @Get('contacts')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Outside people in my branches (and organisation-wide)' })
  list(@CurrentUser() u: RequestUser, @Query('search') search?: string, @Query('kind') kind?: string, @Query('listId') listId?: string) {
    return this.outside.listContacts(u, { search, kind, listId });
  }

  @Post('contacts')
  @Permissions('surveys.manage')
  create(@CurrentUser() u: RequestUser, @Body() dto: OutsideContactDto, @Req() req: Request) {
    return this.outside.createContact(u, dto, getRequestAuditMeta(req));
  }

  @Put('contacts/:id')
  @Permissions('surveys.manage')
  update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OutsideContactDto, @Req() req: Request) {
    return this.outside.updateContact(u, id, dto, getRequestAuditMeta(req));
  }

  @Delete('contacts/:id')
  @Permissions('surveys.manage')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.outside.removeContact(u, id, getRequestAuditMeta(req));
  }

  @Put('contacts/:id/opt-out')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'How this person does not want to be contacted about surveys (audited)' })
  optOut(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OutsideOptOutDto, @Req() req: Request) {
    return this.outside.setContactOptOut(u, id, dto.channels, getRequestAuditMeta(req));
  }

  @Get('sources')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Funders (commissioners) or pathway professionals CareFlow already holds' })
  sources(@CurrentUser() u: RequestUser, @Query('type') type: string, @Query('search') search?: string) {
    return this.outside.listSources(u, type === 'PATHWAY_PROFESSIONAL' ? 'PATHWAY_PROFESSIONAL' : 'FUNDER', search);
  }

  @Post('sources')
  @Permissions('surveys.manage')
  addSource(@CurrentUser() u: RequestUser, @Body() dto: OutsideSourceDto, @Req() req: Request) {
    return this.outside.addFromSource(u, dto.type, dto.sourceId, getRequestAuditMeta(req));
  }

  @Get('families')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'People involved of these people we support, with whether they agreed to be contacted' })
  families(@CurrentUser() u: RequestUser, @Query('serviceUserIds') serviceUserIds?: string) {
    return this.outside.familiesOf(u, ids(serviceUserIds));
  }

  @Get('lists')
  @Permissions('surveys.manage')
  lists(@CurrentUser() u: RequestUser) {
    return this.outside.listLists(u);
  }

  @Post('lists')
  @Permissions('surveys.manage')
  createList(@CurrentUser() u: RequestUser, @Body() dto: OutsideListDto, @Req() req: Request) {
    return this.outside.saveList(u, null, dto, getRequestAuditMeta(req));
  }

  @Put('lists/:id')
  @Permissions('surveys.manage')
  updateList(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OutsideListDto, @Req() req: Request) {
    return this.outside.saveList(u, id, dto, getRequestAuditMeta(req));
  }

  @Delete('lists/:id')
  @Permissions('surveys.manage')
  removeList(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.outside.removeList(u, id, getRequestAuditMeta(req));
  }
}

/** Sending a named public survey to outside people, each with their own link. */
@ApiTags('Survey outside people')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/send-outside')
export class SurveySendOutsideController {
  constructor(private readonly outside: SurveyOutsidePeopleService) {}

  @Post('check')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Before sending: who can be sent it, who is held back, opted out or has no details' })
  check(@CurrentUser() u: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SendOutsideDto) {
    return this.outside.checkSendOutside(u, surveyId, dto);
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Send to outside people (own links); audited as counts' })
  send(@CurrentUser() u: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SendOutsideDto, @Req() req: Request) {
    return this.outside.sendOutside(u, surveyId, dto, getRequestAuditMeta(req), req.headers.origin);
  }
}
