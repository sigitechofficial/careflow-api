import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevicePushPlatform } from '@prisma/client';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type TokenMessage } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { fcmReport, type FcmSendReport } from './fcm-send-report';

export type FcmPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class FcmPushService {
  private readonly logger = new Logger(FcmPushService.name);
  private ready = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.ready = this.initAdmin();
  }

  isReady(): boolean {
    return this.ready;
  }

  private initAdmin(): boolean {
    if (getApps().length > 0) return true;
    const configured =
      this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH')?.trim() ||
      './serviceAccount.json';
    const path = resolve(process.cwd(), configured);
    if (!existsSync(path)) {
      this.logger.warn(`FCM skipped — service account not found at ${path}`);
      return false;
    }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
      initializeApp({ credential: cert(raw) });
      this.logger.log('Firebase Admin initialised for FCM');
      return true;
    } catch (err) {
      this.logger.warn(`FCM init failed: ${String(err)}`);
      return false;
    }
  }

  async upsertToken(input: {
    employeeId: string;
    token: string;
    platform: DevicePushPlatform;
  }) {
    const token = input.token.trim();
    if (!token) return { token };
    const row = await this.prisma.employeeDeviceToken.upsert({
      where: { token },
      create: {
        employeeId: input.employeeId,
        token,
        platform: input.platform,
      },
      update: {
        employeeId: input.employeeId,
        platform: input.platform,
      },
    });
    return { id: row.id, token: row.token, platform: row.platform };
  }

  /**
   * True only when this employee has FCM tokens and every token is unregistered/invalid.
   * No tokens or Firebase not ready → false (not a signal to treat the session as gone).
   */
  async areEmployeePushTokensDead(employeeId: string): Promise<boolean> {
    const rows = await this.prisma.employeeDeviceToken.findMany({
      where: { employeeId },
      select: { token: true },
    });
    if (!rows.length || !this.ready) return false;

    const stale: string[] = [];
    let live = 0;
    for (const row of rows) {
      try {
        await getMessaging().send({ token: row.token, data: { k: '1' } }, true);
        live += 1;
      } catch (err) {
        const code = (err as { code?: string } | undefined)?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) {
          stale.push(row.token);
        } else {
          return false;
        }
      }
    }
    if (stale.length) {
      await this.prisma.employeeDeviceToken.deleteMany({
        where: { token: { in: stale } },
      });
    }
    return live === 0 && stale.length === rows.length;
  }

  async deleteToken(employeeId: string, token: string) {
    const trimmed = token.trim();
    if (!trimmed) return { deleted: 0 };
    const result = await this.prisma.employeeDeviceToken.deleteMany({
      where: { employeeId, token: trimmed },
    });
    return { deleted: result.count };
  }

  async sendToEmployees(
    employeeIds: string[],
    payload: FcmPushPayload,
  ): Promise<FcmSendReport> {
    const unique = [...new Set(employeeIds.filter(Boolean))];
    if (!unique.length) {
      return fcmReport({ ready: this.ready, reason: 'NO_EMPLOYEE' });
    }

    const rows = await this.prisma.employeeDeviceToken.findMany({
      where: { employeeId: { in: unique } },
      select: { id: true, token: true },
    });
    if (!rows.length) {
      return fcmReport({
        ready: this.ready,
        skipped: unique.length,
        reason: 'NO_DEVICE_TOKEN',
      });
    }
    if (!this.ready) {
      this.logger.warn('FCM not ready — skip send');
      return fcmReport({
        ready: false,
        tokens: rows.length,
        skipped: unique.length,
        reason: 'FIREBASE_NOT_READY',
      });
    }

    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.data ?? {})) {
      if (value != null && value !== '') data[key] = String(value);
    }

    const messages: TokenMessage[] = rows.map((row) => ({
      token: row.token,
      notification: { title: payload.title, body: payload.body },
      data,
      android: {
        priority: 'high',
        notification: { channelId: 'careflow_push' },
      },
    }));

    try {
      const result = await getMessaging().sendEach(messages);
      const stale: string[] = [];
      result.responses.forEach((res, i) => {
        if (res.success) return;
        const code = (res.error as { code?: string } | undefined)?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) {
          stale.push(rows[i].token);
        } else if (res.error) {
          this.logger.warn(`FCM send failed: ${res.error.message}`);
        }
      });
      if (stale.length) {
        await this.prisma.employeeDeviceToken.deleteMany({
          where: { token: { in: stale } },
        });
      }
      const sent = result.successCount;
      const skipped = result.failureCount;
      return fcmReport({
        ready: true,
        tokens: rows.length,
        sent,
        skipped,
        reason: sent > 0 ? 'SENT' : 'SEND_FAILED',
        error: sent > 0 ? undefined : 'Firebase returned no successful deliveries',
      });
    } catch (err) {
      this.logger.warn(`FCM sendEach failed: ${String(err)}`);
      return fcmReport({
        ready: true,
        tokens: rows.length,
        skipped: rows.length,
        reason: 'SEND_FAILED',
        error: String(err),
      });
    }
  }
}
