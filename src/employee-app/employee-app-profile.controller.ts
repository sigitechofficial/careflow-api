import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppProfileService } from './employee-app-profile.service';

/**
 * Carer "My profile" — read-only, scoped to JWT employeeId.
 */
@ApiTags('Employee App Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/me')
export class EmployeeAppProfileController {
  constructor(private readonly profileService: EmployeeAppProfileService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'My full profile (read-only)',
    description:
      'Personal details, employment, current-period earnings, leave this year, HR documents, compliance checklist, training, certifications, skills, reviews and working pattern.',
  })
  myProfile(@CurrentUser() user: RequestUser) {
    return this.profileService.getMyProfile(user.employeeId!);
  }

  @Get('incidents')
  @ApiOperation({
    summary: 'Incidents I reported (read-only status)',
    description: 'Reference, category, severity, status and who it was about. No review or investigation detail.',
  })
  myIncidents(@CurrentUser() user: RequestUser) {
    return this.profileService.getMyIncidents(user.employeeId!);
  }

  @Get('documents/:documentId/download')
  @ApiOperation({ summary: 'Download one of my HR documents' })
  async downloadDocument(
    @CurrentUser() user: RequestUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.profileService.getMyDocumentFile(
      user.employeeId!,
      documentId,
      getRequestAuditMeta(req),
    );
    res.setHeader('Content-Type', file.mimeType);
    return res.download(file.path, file.name);
  }

  @Get('compliance-documents/:documentId/download')
  @ApiOperation({ summary: 'Download one of my compliance evidence files' })
  async downloadComplianceDocument(
    @CurrentUser() user: RequestUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.profileService.getMyComplianceDocumentFile(
      user.employeeId!,
      documentId,
      getRequestAuditMeta(req),
    );
    res.setHeader('Content-Type', file.mimeType);
    return res.download(file.path, file.name);
  }
}
