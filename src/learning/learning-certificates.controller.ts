import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LearningCertificateQueryDto, IssueManualCertificateDto, RevokeCertificateDto, VerifyCertificateDto } from './dto/learning.dto';
import { LearningCertificatesService } from './learning-certificates.service';
import { verifyCertificatePdfSignature } from './learning-file.util';

@ApiTags('Learning — Certificates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/certificates')
export class LearningCertificatesController {
  constructor(private readonly service: LearningCertificatesService) {}

  @Get()
  @Permissions('learning.certificates.read')
  @ApiOperation({ summary: 'List certificates' })
  list(@Query() query: LearningCertificateQueryDto) {
    return this.service.list(query);
  }

  @Post('issue')
  @Permissions('learning.certificates.manage')
  @ApiOperation({ summary: 'Manually issue a certificate to an employee for a course' })
  issue(
    @CurrentUser() user: RequestUser,
    @Body() dto: IssueManualCertificateDto,
    @Req() req: Request,
  ) {
    return this.service.issueManual(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('verify')
  @Permissions('learning.certificates.read')
  @ApiOperation({ summary: 'Verify certificate by code' })
  verify(@Body() dto: VerifyCertificateDto) {
    return this.service.verify(dto);
  }

  @Get(':id')
  @Permissions('learning.certificates.read')
  @ApiOperation({ summary: 'Get certificate' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get(':id/pdf-link')
  @Permissions('learning.certificates.read')
  @ApiOperation({ summary: 'Short-lived link to the certificate PDF' })
  pdfLink(@Param('id') id: string) {
    return this.service.pdfLink(id);
  }

  @Post(':id/revoke')
  @Permissions('learning.certificates.manage')
  @ApiOperation({ summary: 'Revoke certificate' })
  revoke(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RevokeCertificateDto,
    @Req() req: Request,
  ) {
    return this.service.revoke(id, user.id, dto, getRequestAuditMeta(req));
  }
}

/**
 * Serves certificate PDFs. No bearer token (a PDF tab / the phone browser cannot send one):
 * access is a short-lived signed link handed out by the authenticated pdf-link APIs.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('learning/certificate-pdf')
export class LearningCertificatePdfController {
  constructor(private readonly service: LearningCertificatesService) {}

  @Get(':id')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    if (!verifyCertificatePdfSignature(id, exp, sig)) {
      throw new NotFoundException('Certificate link expired or invalid');
    }
    const file = await this.service.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.send(file.buffer);
  }
}
