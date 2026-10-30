import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../../common/utils/request-audit-meta.util';
import { QuotationsService } from './quotations.service';
import {
  CreateFollowUpDto,
  QuoteDraftDto,
  QuoteNoteDto,
  ConfirmFundingDto,
  CreateServiceUserFromQuoteDto,
  ReconcileLegacyQuoteDto,
  RecordResponseDto,
  SendQuoteDto,
  UpdateFollowUpDto,
} from './dto/quotation.dto';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Quotations on an enquiry. Only ids in URLs; every route checks the enquiry's branch scope. */
@ApiTags('CRM / Enquiry quotations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('crm/enquiries/:enquiryId')
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get('quotations')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({
    summary:
      'Quotations on the enquiry, summary card data and legacy quote flag',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
  ) {
    return this.service.list(user, enquiryId);
  }

  @Post('quotations')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Create a quotation (V1 draft). Does not change the enquiry stage.',
  })
  create(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Body() dto: QuoteDraftDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, enquiryId, dto, getRequestAuditMeta(req));
  }

  @Post('quotations/pricing-preview')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Price unsaved quotation content at its hourly rate (nothing saved)',
  })
  pricingPreview(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Body() dto: QuoteDraftDto,
  ) {
    return this.service.pricingPreview(user, enquiryId, dto);
  }

  @Post('legacy-quote/reconcile')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Review a legacy "Quote sent" enquiry that has no quotation record',
  })
  reconcileLegacy(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Body() dto: ReconcileLegacyQuoteDto,
    @Req() req: Request,
  ) {
    return this.service.reconcileLegacy(
      user,
      enquiryId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/current')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Make this the enquiry’s current quotation' })
  makeCurrent(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
  ) {
    return this.service.makeCurrent(user, enquiryId, quotationId);
  }

  @Get('quotations/:quotationId/versions/:versionId')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({
    summary:
      'A quotation version with pricing, communications, responses and follow-ups',
  })
  getVersion(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
  ) {
    return this.service.getVersion(user, enquiryId, quotationId, versionId);
  }

  @Patch('quotations/:quotationId/versions/:versionId')
  @Permissions('crm.manage')
  @ApiOperation({
    summary: 'Save a draft version (issued versions cannot be edited)',
  })
  update(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: QuoteDraftDto,
    @Req() req: Request,
  ) {
    return this.service.update(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/submit')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Price, freeze and submit a draft for approval' })
  submit(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Req() req: Request,
  ) {
    return this.service.submitForApproval(
      user,
      enquiryId,
      quotationId,
      versionId,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/approve')
  @Permissions('crm.manage')
  @ApiOperation({
    summary: 'Approve a version (a draft is priced and frozen first)',
  })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: QuoteNoteDto,
    @Req() req: Request,
  ) {
    return this.service.approve(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto.note,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/reject-approval')
  @Permissions('crm.manage')
  @ApiOperation({
    summary: 'Send a version waiting for approval back to draft',
  })
  rejectApproval(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: QuoteNoteDto,
    @Req() req: Request,
  ) {
    return this.service.rejectApproval(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto.note,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/cancel')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Cancel a version' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: QuoteNoteDto,
    @Req() req: Request,
  ) {
    return this.service.cancel(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto.note,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/revise')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Create a new draft version from an issued one (the source is kept)',
  })
  revise(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Req() req: Request,
  ) {
    return this.service.revise(
      user,
      enquiryId,
      quotationId,
      versionId,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/send')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Email the version, or record a send done outside CareFlow (idempotent)',
  })
  send(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: SendQuoteDto,
    @Req() req: Request,
  ) {
    return this.service.send(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/communications/:communicationId/retry')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Retry a failed quotation email' })
  retry(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('communicationId', uuid) communicationId: string,
    @Req() req: Request,
  ) {
    return this.service.retrySend(
      user,
      enquiryId,
      quotationId,
      communicationId,
      getRequestAuditMeta(req),
    );
  }

  @Get('quotations/:quotationId/versions/:versionId/preview')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({
    summary: 'Client-facing preview of an issued version (no internal notes)',
  })
  preview(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
  ) {
    return this.service.preview(user, enquiryId, quotationId, versionId);
  }

  @Get('quotations/:quotationId/versions/:versionId/pdf')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Client-facing PDF of an issued version' })
  async pdf(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.pdf(
      user,
      enquiryId,
      quotationId,
      versionId,
    );
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  @Get('quotations/:quotationId/versions/:versionId/compare')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({
    summary: 'Differences between this version and another (?with=versionId)',
  })
  compare(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Query('with', uuid) otherVersionId: string,
  ) {
    return this.service.compare(
      user,
      enquiryId,
      quotationId,
      versionId,
      otherVersionId,
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/responses')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Record the client response to a version' })
  recordResponse(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: RecordResponseDto,
    @Req() req: Request,
  ) {
    return this.service.recordResponse(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/agreement')
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Record that the signed agreement was received (not a digital signature)',
  })
  agreement(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: QuoteNoteDto,
    @Req() req: Request,
  ) {
    return this.service.recordAgreement(
      user,
      enquiryId,
      quotationId,
      versionId,
      dto.note,
      getRequestAuditMeta(req),
    );
  }

  @Post(
    'quotations/:quotationId/versions/:versionId/fundings/:fundingId/confirm',
  )
  @Permissions('crm.manage')
  @ApiOperation({
    summary:
      'Record that a funder approved its share of an accepted quote (price unchanged)',
  })
  confirmFunding(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('fundingId', uuid) fundingId: string,
    @Body() dto: ConfirmFundingDto,
    @Req() req: Request,
  ) {
    return this.service.confirmFunding(
      user,
      enquiryId,
      quotationId,
      versionId,
      fundingId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/service-user')
  @Permissions('crm.manage', 'service_users.create')
  @ApiOperation({
    summary:
      'After acceptance: make the person an active service user (and, if asked, the draft care package)',
  })
  createServiceUser(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Body() dto: CreateServiceUserFromQuoteDto,
    @Req() req: Request,
  ) {
    return this.service.createServiceUserFromQuote(
      user,
      enquiryId,
      quotationId,
      versionId,
      { createCarePackage: dto.createCarePackage !== false },
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/versions/:versionId/care-package')
  @Permissions('crm.manage')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({
    summary:
      'Create a DRAFT care package from the accepted version (idempotent)',
  })
  convert(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('versionId', uuid) versionId: string,
    @Req() req: Request,
  ) {
    return this.service.convertToCarePackage(
      user,
      enquiryId,
      quotationId,
      versionId,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/follow-ups')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Schedule a follow-up on a quotation' })
  createFollowUp(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Body() dto: CreateFollowUpDto,
    @Req() req: Request,
  ) {
    return this.service.createFollowUp(
      user,
      enquiryId,
      quotationId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Patch('quotations/:quotationId/follow-ups/:followUpId')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Complete, reschedule or cancel a follow-up' })
  updateFollowUp(
    @CurrentUser() user: RequestUser,
    @Param('enquiryId', uuid) enquiryId: string,
    @Param('quotationId', uuid) quotationId: string,
    @Param('followUpId', uuid) followUpId: string,
    @Body() dto: UpdateFollowUpDto,
    @Req() req: Request,
  ) {
    return this.service.updateFollowUp(
      user,
      enquiryId,
      quotationId,
      followUpId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
