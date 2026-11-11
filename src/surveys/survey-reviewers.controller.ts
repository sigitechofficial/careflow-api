import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AllowIndependentReviewer, SURVEY_REVIEW_PERMISSION } from '../common/auth/independent-reviewer';
import { RecordSurveyResponseDto } from './dto/record-survey-response.dto';
import { MAX_REVIEW_SAMPLE, SurveyReviewersService } from './survey-reviewers.service';

export class GrantSurveyReviewerDto {
  @ApiProperty({ description: 'The reviewer account (its only role is Independent reviewer, no branch)' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ type: [String], description: 'The sample: people the reviewer may record for (none on anonymous surveys)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_SAMPLE)
  @IsUUID('all', { each: true })
  personIds?: string[];

  @ApiProperty()
  @IsISO8601()
  validFrom!: string;

  @ApiProperty()
  @IsISO8601()
  validTo!: string;
}

export class CheckSurveyReviewerDto {
  @IsString() @MaxLength(100) firstName!: string;
  @IsString() @MaxLength(100) lastName!: string;
  @IsString() @MaxLength(254) email!: string;
}

export class AskSurveyStaffDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateSurveyReviewerAccountDto {
  /** Needed when they are already connected to us: why they are still independent enough. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  declaration?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ description: 'They are emailed a link here to choose their own password' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

/** Survey managers: every independent reviewer across all surveys, with what they recorded. */
@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-reviewers')
export class SurveyReviewersOverviewController {
  constructor(private readonly reviewers: SurveyReviewersService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'All independent reviewers: their access on each survey and the answers they recorded' })
  overview(@CurrentUser() user: RequestUser) {
    return this.reviewers.overview(user);
  }
}

/** Survey managers: who may record answers on a survey as an independent reviewer. */
@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/reviewers')
export class SurveyReviewerGrantsController {
  constructor(private readonly reviewers: SurveyReviewersService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Independent reviewers on this survey, and the reviewer accounts that can be given access' })
  list(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.reviewers.list(user, surveyId);
  }

  @Get('survey-staff')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Staff whose role can record survey responses (they collect answers as the office, not as independent reviewers)' })
  surveyStaff(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.reviewers.surveyStaff(user, surveyId);
  }

  @Post('survey-staff/ask')
  @HttpCode(200)
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Ask staff who can record survey responses to collect answers for this survey (sends them a notice)' })
  askStaff(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: AskSurveyStaffDto,
    @Req() req: Request,
  ) {
    return this.reviewers.askStaffToCollect(user, surveyId, dto.userIds, dto.note, getRequestAuditMeta(req));
  }

  @Get('known-people')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Add a reviewer: people already in CareFlow to choose from (outside contacts, family contacts, former staff)' })
  knownPeople(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Query('search') search?: string) {
    return this.reviewers.knownPeople(user, surveyId, search ?? '');
  }

  @Post('accounts/check')
  @HttpCode(200)
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Before adding a reviewer: how they are already connected to us (former staff, a person we support or their family, an outside contact)' })
  checkAccount(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: CheckSurveyReviewerDto) {
    return this.reviewers.checkAccount(user, surveyId, dto);
  }

  @Post('accounts')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary: 'Add a reviewer: an account with only the Independent reviewer role; they are emailed a link to choose their own password (audited)',
  })
  createAccount(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: CreateSurveyReviewerAccountDto,
    @Req() req: Request,
  ) {
    return this.reviewers.createAccount(user, surveyId, dto, getRequestAuditMeta(req));
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Let a reviewer account record answers on this survey, for a sample, in a window (audited)' })
  grant(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: GrantSurveyReviewerDto, @Req() req: Request) {
    return this.reviewers.grant(user, surveyId, dto, getRequestAuditMeta(req));
  }

  @Delete(':grantId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'End a reviewer’s access (audited)' })
  revoke(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Req() req: Request,
  ) {
    return this.reviewers.revoke(user, surveyId, grantId, getRequestAuditMeta(req));
  }
}

/**
 * The independent reviewer: their surveys, the questions, their sample, and recording answers. The
 * only routes (with their account) a reviewer account may call.
 */
@ApiTags('Survey reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AllowIndependentReviewer()
@Controller('survey-reviews')
export class SurveyReviewsController {
  constructor(private readonly reviewers: SurveyReviewersService) {}

  // Reviewer accounts only (the service refuses anyone else); an empty list while no grant is live.
  @Get()
  @ApiOperation({ summary: 'Surveys you may record answers on now' })
  mine(@CurrentUser() user: RequestUser) {
    return this.reviewers.mine(user);
  }

  @Get(':surveyId')
  @Permissions(SURVEY_REVIEW_PERMISSION)
  @ApiOperation({ summary: 'The questions to ask' })
  form(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.reviewers.form(user, surveyId);
  }

  @Get(':surveyId/people')
  @Permissions(SURVEY_REVIEW_PERMISSION)
  @ApiOperation({ summary: 'Your sample (names only)' })
  people(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Query('search') search?: string) {
    return this.reviewers.people(user, surveyId, search);
  }

  @Post(':surveyId/responses')
  @Permissions(SURVEY_REVIEW_PERMISSION)
  @ApiOperation({ summary: 'Record one person’s answers (or an anonymous answer)' })
  record(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: RecordSurveyResponseDto,
    @Req() req: Request,
  ) {
    return this.reviewers.record(user, surveyId, dto, getRequestAuditMeta(req));
  }
}
