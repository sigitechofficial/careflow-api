import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CqcEvidencePackService } from './cqc-evidence-pack.service';
import { EvidencePackQueryDto } from './dto/cqc-evidence-pack.dto';

/** CQC evidence pack for an inspector (PDF, or a ZIP with the files and policies): cqc_evidence.export. */
@ApiTags('CQC evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cqc-evidence-pack')
export class CqcEvidencePackController {
  constructor(private readonly packs: CqcEvidencePackService) {}

  @Get()
  @Permissions('cqc_evidence.export')
  @ApiOperation({
    summary:
      'Evidence pack for every statement, one key question or one statement: evidence, published policies, mock inspection scores and open actions',
  })
  async download(
    @CurrentUser() user: RequestUser,
    @Query() query: EvidencePackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.packs.download(
      user,
      query,
      getRequestAuditMeta(req),
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }
}
