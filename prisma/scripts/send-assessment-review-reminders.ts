/**
 * Send CQC-schedule assessment review reminders (in-app notifications + audit).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/send-assessment-review-reminders.ts --dry-run
 *   npx ts-node --transpile-only prisma/scripts/send-assessment-review-reminders.ts
 *   npx ts-node --transpile-only prisma/scripts/send-assessment-review-reminders.ts --service-user-id=<uuid>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ServiceUserAssessmentsService } from '../../src/service-user-assessments/service-user-assessments.service';
import { PrismaClient } from '@prisma/client';

function parseArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return arg?.split('=')[1]?.trim() || undefined;
}

async function resolveSystemUserId(prisma: PrismaClient): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { deletedAt: null, isActive: true, email: { contains: '@', mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('No active user found to attribute reminder audit');
  return admin.id;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const serviceUserId = parseArg('--service-user-id');

  const prisma = new PrismaClient();
  const triggeredByUserId = await resolveSystemUserId(prisma);
  await prisma.$disconnect();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const service = app.get(ServiceUserAssessmentsService);
    const result = await service.sendReviewReminders({
      triggeredByUserId,
      serviceUserId,
      dryRun,
    });
    console.log('[send-assessment-review-reminders]', JSON.stringify(result.data, null, 2));
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error('[send-assessment-review-reminders] failed', err);
  process.exitCode = 1;
});
