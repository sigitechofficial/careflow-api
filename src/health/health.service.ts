import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** `SELECT 1` against the database, bounded so a hung connection fails the probe instead of blocking it. */
  async isDatabaseReachable(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(
        `Readiness database check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
