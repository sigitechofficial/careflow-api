import type { ReferralRules } from './referral-rules.util';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ReferralMailboxService } from './referral-mailbox.service';
import { ReferralAutomationService } from './referral-automation.service';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CoverageRowDto {
  @IsUUID()
  locationId!: string;

  @IsArray()
  @IsString({ each: true })
  localAuthorities!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  replyManagerName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  replyManagerTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  replyPhone?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateReferralSettingsDto {
  @IsOptional() @IsBoolean() autoCreateEnquiry?: boolean;
  @IsOptional() @IsBoolean() autoReply?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) autoReplyDecisions?: string[];
  @IsOptional() @IsInt() minNoticeDays?: number;
  @IsOptional() @IsBoolean() answerPriceQuestions?: boolean;
  @IsOptional() @IsIn(['SAME_CARER', 'ANY_CARER_EACH_DAY']) availabilityMode?: 'SAME_CARER' | 'ANY_CARER_EACH_DAY';
  @IsOptional() @IsInt() travelBufferMinutes?: number;
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) copyRepliesTo?: string[];
  @IsOptional() @IsBoolean() autoQuote?: boolean;
  @IsOptional() @IsInt() quoteValidDays?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unplacedLocationId?: string | null;
  /** Checked and cleaned by normaliseRules before it is saved. */
  @IsOptional() @IsObject() rules?: ReferralRules;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StandardRateDto) standardRates?: StandardRateDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CoverageRowDto) coverage?: CoverageRowDto[];
}

class SendReplyDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(20000) text?: string;
  @IsOptional() @IsString() @MaxLength(100000) html?: string;
}

class StandardRateDto {
  @IsOptional() @IsUUID() locationId!: string | null;
  @IsOptional() @IsNumber() hourlyRate!: number | null;
  @IsOptional() @IsObject() rates?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

class CreateEnquiryFromReferralDto {
  @IsUUID()
  locationId!: string;
}

class UpdateReferralLabelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  labelName!: string;
}

class ImapMailboxDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string | null;
  @IsEmail() emailAddress!: string;
  @IsOptional() @IsString() @MaxLength(200) folder?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(255) imapHost!: string;
  @IsInt() @Min(1) @Max(65535) imapPort!: number;
  @IsBoolean() imapSecure!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(255) smtpHost!: string;
  @IsInt() @Min(1) @Max(65535) smtpPort!: number;
  @IsBoolean() smtpSecure!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(255) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) password!: string;
  @IsOptional() @IsString() @MaxLength(200) sentFolder?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() defaultLocationId?: string | null;
}

class ImapUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) imapHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) imapPort?: number;
  @IsOptional() @IsBoolean() imapSecure?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsBoolean() smtpSecure?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sentFolder?: string | null;
}

class RelayDto {
  @IsString() @IsNotEmpty() @MaxLength(255) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsBoolean() secure!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(255) username!: string;
  @IsOptional() @IsString() @MaxLength(1000) password?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() fromAddress?: string | null;
}

class WebhookMailboxDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string | null;
  @IsEmail() emailAddress!: string;
  @IsOptional() @IsString() @MaxLength(1000) apiKey?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() defaultLocationId?: string | null;
}

class UpdateMailboxDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string | null;
  @IsOptional() @IsIn(['REFERRALS', 'RECRUITMENT']) purpose?: 'REFERRALS' | 'RECRUITMENT';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) labelName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() defaultLocationId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => ImapUpdateDto) imap?: ImapUpdateDto;
  @IsOptional() @IsIn(['MAILBOX', 'SMTP_RELAY']) sendVia?: 'MAILBOX' | 'SMTP_RELAY';
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => RelayDto) relay?: RelayDto | null;
  @IsOptional() @IsString() @MaxLength(1000) apiKey?: string | null;
}

/** The referrals mailbox and the emails read from it (staff signed in to CareFlow). */
@ApiTags('CRM / Referral inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('referral-mailbox')
export class ReferralMailboxController {
  constructor(
    private readonly service: ReferralMailboxService,
    private readonly automation: ReferralAutomationService,
  ) {}

  @Get('settings')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Referral automation settings and branch coverage' })
  settings() {
    return this.automation.settings();
  }

  @Post('settings')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Update referral automation settings and branch coverage' })
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateReferralSettingsDto) {
    return this.automation.updateSettings(user.id, dto);
  }

  @Post('emails/:id/reply')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Send the (edited) reply in the referral thread' })
  sendReply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendReplyDto) {
    return this.automation.sendReply(id, user.id, dto);
  }

  @Post('emails/:id/recheck')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Run the checks and draft the reply again' })
  async recheck(@Param('id', ParseUUIDPipe) id: string) {
    await this.automation.process(id);
    return this.service.get(id);
  }

  @Get()
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Connected referrals mailbox and setup state' })
  status() {
    return this.service.status();
  }

  @Post('google/connect')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Start connecting a Gmail mailbox (returns the Google sign-in address)' })
  connect(@CurrentUser() user: RequestUser) {
    return this.service.startGmailConnect(user.id);
  }

  @Post('microsoft/connect')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Start connecting a Microsoft 365 / Outlook mailbox (returns the Microsoft sign-in address)' })
  connectMicrosoft(@CurrentUser() user: RequestUser) {
    return this.service.startMicrosoftConnect(user.id);
  }

  @Post('mailboxes/imap')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Add an IMAP/SMTP mailbox (cPanel, GoDaddy Workspace, Zoho...); the connection is tested first' })
  addImap(@CurrentUser() user: RequestUser, @Body() dto: ImapMailboxDto) {
    return this.service.addImap(user.id, dto);
  }

  @Post('mailboxes/webhook')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Add a mailbox an email service posts to (Brevo inbound parsing, raw email); returns its address once' })
  addWebhook(@CurrentUser() user: RequestUser, @Body() dto: WebhookMailboxDto) {
    return this.service.addWebhook(user.id, dto);
  }

  @Post('mailboxes/:id')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Change a mailbox: name, folder, branch, IMAP settings, how replies are sent' })
  updateMailbox(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMailboxDto) {
    return this.service.updateMailbox(id, dto);
  }

  @Post('mailboxes/:id/test')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Sign in to the mailbox (and its relay) without reading anything' })
  testMailbox(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.testMailbox(id);
  }

  @Post('mailboxes/:id/check')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Check one mailbox for new emails now' })
  checkMailbox(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.checkNow(id);
  }

  @Post('mailboxes/:id/webhook-address')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Make a new webhook address (the old one stops working)' })
  newWebhookAddress(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.newWebhookAddress(id);
  }

  @Post('mailboxes/:id/off')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Turn a mailbox off (settings kept; emails already saved stay)' })
  turnOff(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.disconnect(id);
  }

  @Post('mailboxes/:id/on')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Turn a mailbox back on (its connection is checked first)' })
  turnOn(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.turnOn(id);
  }

  @Delete('mailboxes/:id')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Remove a mailbox: its sign-in, password and keys are wiped (emails already saved stay)' })
  removeMailbox(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Delete()
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Turn every referrals mailbox off' })
  disconnect() {
    return this.service.disconnect();
  }

  @Post('label')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Change which mailbox label is read' })
  label(@Body() dto: UpdateReferralLabelDto) {
    return this.service.updateLabel(dto.labelName);
  }

  @Post('check')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Check the mailbox for new referral emails now' })
  check() {
    return this.service.checkNow();
  }

  @Post('test-email')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Development only: place a made-up test referral in the mailbox (a copy goes to the reply-copy addresses)' })
  testEmail(@Query('scenario') scenario?: string, @Query('mailboxId') mailboxId?: string) {
    return this.service.insertTestReferral(Number(scenario) || 0, mailboxId || undefined);
  }

  @Get('test-emails')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Development only: the made-up test referrals that can be added' })
  testScenarios() {
    return this.service.testScenarios();
  }

  @Get('emails')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Referral emails (status: open, or a status name)' })
  list(@Query('status') status?: string, @Query('enquiryId') enquiryId?: string) {
    return this.service.list(status, enquiryId);
  }

  @Get('emails/:id')
  @AnyPermission('crm.read', 'crm.manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Get('emails/:id/attachments/:index')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Download an attachment (private storage)' })
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    const f = await this.service.attachmentFile(id, index);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(f.path);
  }

  @Get('emails/:id/attachments/:index/text')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'The text of a Word attachment, for reading on screen' })
  attachmentText(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    return this.service.attachmentText(id, index);
  }

  @Post('emails/:id/read')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Have Claude read the email again' })
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.readEmail(id);
  }

  @Post('emails/:id/enquiry')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Create an enquiry / referral from the email' })
  createEnquiry(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEnquiryFromReferralDto,
    @Req() req: Request,
  ) {
    return this.service.createEnquiry(user, id, dto.locationId, getRequestAuditMeta(req));
  }

  @Post('emails/:id/dismiss')
  @Permissions('crm.manage')
  dismiss(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.dismiss(user, id);
  }
}

/**
 * Google sends the browser here after sign-in. No CareFlow login header arrives with it, so it is checked
 * against the one-use state CareFlow issued when the signed-in manager started connecting.
 */
@ApiTags('CRM / Referral inbox')
@Controller('referral-mailbox/google')
export class ReferralMailboxCallbackController {
  constructor(private readonly service: ReferralMailboxService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(await this.service.finishGmailConnect(code, state, error));
  }
}

/** Microsoft sends the browser here after sign-in (checked against the one-use state, as for Google). */
@ApiTags('CRM / Referral inbox')
@Controller('referral-mailbox/microsoft')
export class ReferralMailboxMicrosoftCallbackController {
  constructor(private readonly service: ReferralMailboxService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(await this.service.finishMicrosoftConnect(code, state, error));
  }
}

/**
 * An email service (Brevo inbound parsing, or anything that posts the raw email) delivers referral emails here.
 * No CareFlow login: the secret in the address is the key, and it is only ever stored as a hash.
 */
@ApiTags('CRM / Referral inbox')
@Controller('referral-mailbox/inbound')
export class ReferralMailboxInboundController {
  constructor(private readonly service: ReferralMailboxService) {}

  @Post(':mailboxId/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive emails posted by an email service (Brevo inbound JSON, message/rfc822, or {"raw": ...})' })
  receive(@Param('mailboxId', ParseUUIDPipe) mailboxId: string, @Param('token') token: string, @Req() req: Request) {
    return this.service.ingestInbound(mailboxId, token, req.body as unknown, String(req.headers['content-type'] ?? ''));
  }
}
