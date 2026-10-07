import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import {
  type BodyMapVideoFileKind,
  resolveBodyMapVideoAbsolutePath,
  verifyBodyMapVideoSignature,
} from './body-map-video.util';

/**
 * Serves body map videos / thumbnails from private storage.
 *
 * No bearer token: `<video src>` cannot send headers, so access is a short-lived
 * HMAC-signed link that only the authenticated record APIs hand out.
 * Express `sendFile` handles Range requests (seeking).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('body-map/videos')
export class BodyMapVideoFileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':videoId/:kind')
  async file(
    @Param('videoId', ParseUUIDPipe) videoId: string,
    @Param('kind') kind: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    if (kind !== 'video' && kind !== 'thumbnail') throw new NotFoundException();
    const fileKind = kind as BodyMapVideoFileKind;
    if (!verifyBodyMapVideoSignature(videoId, fileKind, exp, sig)) {
      // Same answer as a missing file — do not reveal which ids exist.
      throw new NotFoundException('Video link expired or invalid');
    }
    const video = await this.prisma.bodyMapVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { storagePath: true, thumbnailPath: true, mimeType: true, originalName: true },
    });
    const stored = fileKind === 'video' ? video?.storagePath : video?.thumbnailPath;
    const absolutePath = stored ? resolveBodyMapVideoAbsolutePath(stored) : null;
    if (!video || !absolutePath || !existsSync(absolutePath)) {
      throw new NotFoundException('Video link expired or invalid');
    }
    res.setHeader(
      'Content-Type',
      fileKind === 'video' ? video.mimeType : stored!.endsWith('.png') ? 'image/png' : 'image/jpeg',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(absolutePath);
  }
}
