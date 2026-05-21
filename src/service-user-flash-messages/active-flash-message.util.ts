import { FlashMessageStatus } from '@prisma/client';

/** Current, non-expired flash message (matches `getCurrent` criteria + `displayUntil`). */
export function activeServiceUserFlashMessageWhere(now = new Date()) {
  return {
    deletedAt: null,
    isActive: true,
    isCurrent: true,
    status: FlashMessageStatus.ACTIVE,
    displayUntil: { gte: now },
  };
}
