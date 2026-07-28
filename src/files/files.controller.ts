import {
  Controller,
  Get,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { existsSync, statSync } from 'fs';
import { extname, join, normalize, sep } from 'path';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/octet-stream',
};

function uploadRoot(): string {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads');
}

function resolveSafeUploadPath(relativePath: string): string | null {
  const root = uploadRoot();
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(relativePath)
      .replace(/^[/\\]+/, '')
      .replace(/\0/g, '');
  } catch {
    return null;
  }
  if (!cleaned || cleaned.split(/[/\\]/).includes('..')) {
    return null;
  }
  const absolute = normalize(join(root, cleaned));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    return null;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return null;
  }
  return absolute;
}

/**
 * Public media stream for stored `/uploads/...` files.
 * Prefer `/files/uploads/...` over bare `/uploads` on hosts where Apache/cPanel
 * intercepts that path before Nest (logos then break on live after upload).
 */
@ApiTags('Files')
@Controller('files')
export class FilesController {
  @Public()
  @Get(['uploads', 'uploads/*path'])
  @ApiOperation({ summary: 'Stream an uploaded file (logos, photos, documents)' })
  stream(@Req() req: Request, @Res() res: Response): void {
    const marker = '/files/uploads/';
    const pathOnly = (req.path || '').split('?')[0] ?? '';
    const idx = pathOnly.indexOf(marker);
    const relative = idx >= 0 ? pathOnly.slice(idx + marker.length) : '';
    const absolute = resolveSafeUploadPath(relative);
    if (!absolute) {
      res.status(404).json({ success: false, message: 'File not found' });
      return;
    }

    const mime = MIME_BY_EXT[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(absolute);
  }
}
