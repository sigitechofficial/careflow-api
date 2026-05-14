import type { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';

export type NotificationNewSocketPayload = {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  module: NotificationModule;
  severity: NotificationSeverity;
  recordType: string | null;
  recordId: string | null;
  metadata: unknown;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  playSound: boolean;
};
