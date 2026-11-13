import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { RecruitmentInboxService } from './recruitment-inbox.service';
import { CreateCandidateFromEmailDto } from './recruitment-inbox.dto';

/** Job applications received by email (mailboxes connected for Recruitment). */
@ApiTags('HR / Recruitment inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/recruitment-inbox')
export class RecruitmentInboxController {
  constructor(private readonly service: RecruitmentInboxService) {}

  @Get()
  @Permissions('hr.candidates.read')
  @ApiOperation({ summary: 'Emails in a tab: open (default), created, closed' })
  list(@Query('tab') tab?: string) {
    return this.service.list(tab);
  }

  @Get(':id')
  @Permissions('hr.candidates.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Get(':id/attachments/:index')
  @Permissions('hr.candidates.read')
  @ApiOperation({ summary: 'Download an attachment (private storage)' })
  async attachment(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number, @Res() res: Response) {
    const f = await this.service.attachmentFile(id, index);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(f.path);
  }

  @Post(':id/read')
  @Permissions('hr.candidates.update')
  @ApiOperation({ summary: 'Have Claude read the email and CV again' })
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.read(id);
  }

  @Post(':id/candidate')
  @Permissions('hr.candidates.create')
  @ApiOperation({ summary: 'Create the candidate from the checked form' })
  createCandidate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCandidateFromEmailDto) {
    return this.service.createCandidate(user, id, dto);
  }

  @Post(':id/dismiss')
  @Permissions('hr.candidates.update')
  dismiss(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.dismiss(user, id);
  }

  @Post(':id/reopen')
  @Permissions('hr.candidates.update')
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reopen(id);
  }
}
