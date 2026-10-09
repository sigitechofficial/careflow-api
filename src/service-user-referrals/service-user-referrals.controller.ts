import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserReferralsService } from './service-user-referrals.service';
import {
  CreateQuotationDto,
  CreateReferralDto,
  QuotationStatusDto,
  ReferralFollowUpDto,
  ReferralNoteDto,
  ReferralStatusDto,
  ReviseQuotationDto,
  UpdateQuotationDto,
  UpdateReferralDto,
} from './dto/referral.dto';

@ApiTags('Service User Referrals & Quotations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id')
export class ServiceUserReferralsController {
  constructor(private readonly service: ServiceUserReferralsService) {}

  // ------------------------------------------------------------- referrals

  @Get('referrals')
  @Permissions('service_users.read')
  listReferrals(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listReferrals(user, id);
  }

  @Get('referral-history')
  @Permissions('service_users.read')
  @ApiOperation({
    summary: 'Referral and quotation history for the service user',
  })
  history(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.history(user, id);
  }

  @Get('referrals/:referralId')
  @Permissions('service_users.read')
  getReferral(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referralId', ParseUUIDPipe) referralId: string,
  ) {
    return this.service.getReferral(user, id, referralId);
  }

  @Post('referrals')
  @AnyPermission('service_users.update', 'service_users.create')
  createReferral(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReferralDto,
    @Req() req: Request,
  ) {
    return this.service.createReferral(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch('referrals/:referralId')
  @Permissions('service_users.update')
  updateReferral(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @Body() dto: UpdateReferralDto,
    @Req() req: Request,
  ) {
    return this.service.updateReferral(
      user,
      id,
      referralId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('referrals/:referralId/status')
  @Permissions('service_users.update')
  changeReferralStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @Body() dto: ReferralStatusDto,
    @Req() req: Request,
  ) {
    return this.service.changeReferralStatus(
      user,
      id,
      referralId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('referrals/:referralId/follow-ups')
  @Permissions('service_users.update')
  addFollowUp(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @Body() dto: ReferralFollowUpDto,
  ) {
    return this.service.addFollowUp(user, id, referralId, dto);
  }

  @Post('referrals/:referralId/notes')
  @Permissions('service_users.update')
  addNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referralId', ParseUUIDPipe) referralId: string,
    @Body() dto: ReferralNoteDto,
  ) {
    return this.service.addReferralNote(user, id, referralId, dto.note);
  }

  // ------------------------------------------------------------ quotations

  @Get('quotations')
  @Permissions('service_users.read')
  listQuotations(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listQuotations(user, id);
  }

  @Get('quotations/:quotationId')
  @Permissions('service_users.read')
  getQuotation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
  ) {
    return this.service.getQuotation(user, id, quotationId);
  }

  @Post('quotations')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  createQuotation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuotationDto,
    @Req() req: Request,
  ) {
    return this.service.createQuotation(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Patch('quotations/:quotationId')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  updateQuotation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: UpdateQuotationDto,
    @Req() req: Request,
  ) {
    return this.service.updateQuotation(
      user,
      id,
      quotationId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/status')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({ summary: 'Send, accept, decline or withdraw a quotation' })
  changeQuotationStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: QuotationStatusDto,
    @Req() req: Request,
  ) {
    return this.service.changeQuotationStatus(
      user,
      id,
      quotationId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('quotations/:quotationId/revise')
  @AnyPermission('service_users.funding.update', 'service_users.update')
  @ApiOperation({
    summary: 'Create a new draft revision (the original is kept)',
  })
  reviseQuotation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: ReviseQuotationDto,
    @Req() req: Request,
  ) {
    return this.service.reviseQuotation(
      user,
      id,
      quotationId,
      dto.note,
      getRequestAuditMeta(req),
    );
  }
}
