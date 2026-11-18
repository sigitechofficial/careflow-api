import { existsSync } from 'fs';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiExcludeController,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { Permissions } from '../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LearningFilesService } from './learning-files.service';
import {
  learningFileMaxBytes,
  verifyLearningFileSignature,
} from './learning-file.util';

@ApiTags('Learning — Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/files')
export class LearningFilesController {
  constructor(private readonly files: LearningFilesService) {}

  @Post()
  @Permissions('learning.courses.manage')
  @ApiOperation({
    summary: 'Upload a lesson file (PDF, Word .docx, JPG or PNG)',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: learningFileMaxBytes(), files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.files.upload(file, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }
}

/**
 * Serves lesson files. No bearer token: <img src> and a new PDF tab cannot send headers,
 * so access is a short-lived HMAC-signed link that only the authenticated course APIs hand out.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('learning/files')
export class LearningFileDownloadController {
  constructor(private readonly files: LearningFilesService) {}

  @Get(':fileId')
  async download(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    if (!verifyLearningFileSignature(fileId, exp, sig)) {
      // Same answer as a missing file, so ids cannot be probed.
      throw new NotFoundException('File link expired or invalid');
    }
    const file = await this.files.resolveForDownload(fileId);
    if (!existsSync(file.absolute))
      throw new NotFoundException('File link expired or invalid');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader(
      'Content-Disposition',
      `${file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.originalName)}"`,
    );
    return res.sendFile(file.absolute);
  }
}
