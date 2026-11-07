import { Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PolicyAcknowledgementsService } from '../policies/policy-acknowledgements.service';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';

/**
 * Carer "Policies to read" — policies the signed-in employee must read and acknowledge within
 * 14 days of a new version. Scoped to the JWT employeeId.
 */
@ApiTags('Employee App Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/policies')
export class EmployeeAppPoliciesController {
  constructor(private readonly acknowledgements: PolicyAcknowledgementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Policies I must read and acknowledge',
    description: 'Status (PENDING, VIEWED, ACKNOWLEDGED), due date and overdue flag per policy, plus counts.',
  })
  list(@CurrentUser() user: RequestUser) {
    return this.acknowledgements.listForEmployee(user.employeeId!);
  }

  @Get(':documentId')
  @ApiOperation({
    summary: 'Read a policy (current published version) and record that I opened it',
    description:
      'Returns contentHtml for policies written in CareFlow. For uploaded documents contentHtml is null and `file` describes the document to download from `file.downloadPath`.',
  })
  detail(@CurrentUser() user: RequestUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.acknowledgements.getForEmployee(user.employeeId!, documentId, user.id);
  }

  @Get(':documentId/document')
  @ApiOperation({ summary: 'Download the uploaded document of the current published version' })
  async document(
    @CurrentUser() user: RequestUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ) {
    const file = await this.acknowledgements.getDocumentFileForEmployee(user.employeeId!, documentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', file.contentDisposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(file.absolutePath);
  }

  @Post(':documentId/acknowledge')
  @ApiOperation({ summary: 'Confirm I have read and understood the current version of the policy' })
  acknowledge(
    @CurrentUser() user: RequestUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ) {
    return this.acknowledgements.acknowledgeForEmployee(
      user.employeeId!,
      documentId,
      getRequestAuditMeta(req),
      user.id,
    );
  }
}
