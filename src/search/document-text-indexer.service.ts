import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { safeUploadPath } from '../common/utils/upload-path.util';
import { readDocumentText } from './document-text';

const BATCH = 10;
const EVERY_MS = 60_000;

/**
 * Reads the text inside uploaded documents (service user documents, staff documents) so "Find anything" can
 * find them by what they say. Runs in the web API: every minute it reads up to BATCH documents not read yet
 * (new uploads, and older files until all are done). A file that cannot be read is marked as tried, so it is
 * not tried again. Turned off with DOCUMENT_TEXT_INDEXER=off.
 */
@Injectable()
export class DocumentTextIndexer implements OnApplicationShutdown {
  private readonly logger = new Logger(DocumentTextIndexer.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Called by the web server once it is listening (not by command-line jobs). */
  start() {
    if (process.env.DOCUMENT_TEXT_INDEXER === 'off' || process.env.NODE_ENV === 'test' || this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), EVERY_MS);
    this.timer.unref?.();
    setTimeout(() => void this.runOnce(), 15_000).unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One batch of each kind. Returns how many documents were read. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return (await this.serviceUserDocuments()) + (await this.employeeDocuments());
    } catch (e) {
      this.logger.warn(`Document text not read: ${e instanceof Error ? e.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async read(fileUrl: string | null, fileName: string | null, mimeType: string | null): Promise<string | null> {
    const abs = safeUploadPath(fileUrl);
    if (!abs || !fileName) return null;
    try {
      return await readDocumentText(abs, fileName, mimeType);
    } catch {
      return null; // missing or damaged file: tried, nothing to search
    }
  }

  private async serviceUserDocuments(): Promise<number> {
    const rows = await this.prisma.serviceUserDocumentRecord.findMany({
      where: { searchTextAt: null, deletedAt: null, fileUrl: { not: null } },
      select: { id: true, fileUrl: true, fileName: true, mimeType: true },
      orderBy: { uploadedAt: 'desc' },
      take: BATCH,
    });
    for (const r of rows) {
      const text = await this.read(r.fileUrl, r.fileName, r.mimeType);
      await this.prisma.serviceUserDocumentRecord.updateMany({ where: { id: r.id, searchTextAt: null }, data: { searchText: text || null, searchTextAt: new Date() } });
    }
    return rows.length;
  }

  private async employeeDocuments(): Promise<number> {
    const rows = await this.prisma.employeeDocument.findMany({
      where: { searchTextAt: null, deletedAt: null },
      select: { id: true, fileUrl: true, fileName: true, mimeType: true },
      orderBy: { createdAt: 'desc' },
      take: BATCH,
    });
    for (const r of rows) {
      const text = await this.read(r.fileUrl, r.fileName, r.mimeType);
      await this.prisma.employeeDocument.updateMany({ where: { id: r.id, searchTextAt: null }, data: { searchText: text || null, searchTextAt: new Date() } });
    }
    return rows.length;
  }
}
