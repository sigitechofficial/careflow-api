import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LearningCertificateQueryDto, IssueManualCertificateDto, RevokeCertificateDto, VerifyCertificateDto } from './dto/learning.dto';
import { LearningCertificatesService } from './learning-certificates.service';

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
