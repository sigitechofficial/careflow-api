import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
/** Login-history events that show someone actually used the system. */
const ACTIVITY_EVENTS = ['login_success', 'refresh_token_used'];
/** No sign-in for this long counts as a dormant account (access review). */
const DORMANT_DAYS = 90;

/**
 * Administration module dashboard: platform usage and security signals from the audit store.
 * Organisation-wide.
 */
@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since7d = new Date(now - 7 * DAY_MS);
    const sinceDormant = new Date(now - DORMANT_DAYS * DAY_MS);

    const [users, active7d, activeDormantWindow, failed24h, failed7d, securityByType] = await Promise.all([
      this.prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, createdAt: true } }),
      this.prisma.loginHistory.groupBy({
        by: ['userId'],
        where: { event: { in: ACTIVITY_EVENTS }, createdAt: { gte: since7d }, userId: { not: null } },
        orderBy: { userId: 'asc' },
      }),
      this.prisma.loginHistory.groupBy({
        by: ['userId'],
        where: { event: { in: ACTIVITY_EVENTS }, createdAt: { gte: sinceDormant }, userId: { not: null } },
        orderBy: { userId: 'asc' },
      }),
      this.prisma.loginHistory.count({ where: { event: 'login_failed', createdAt: { gte: since24h } } }),
      this.prisma.loginHistory.count({ where: { event: 'login_failed', createdAt: { gte: since7d } } }),
      this.prisma.securityEvent.groupBy({
        by: ['eventType'],
        where: { createdAt: { gte: since7d } },
        orderBy: { eventType: 'asc' },
        _count: { _all: true },
      }),
    ]);

    const recentlyActive = new Set(activeDormantWindow.map((r) => r.userId));
    // Accounts created inside the window are new, not dormant.
    const dormant = users.filter((u) => !recentlyActive.has(u.id) && u.createdAt < sinceDormant).length;
    const securityEvents7d: Record<string, number> = {};
    for (const g of securityByType) {
      const c = g._count;
      securityEvents7d[String(g.eventType)] = typeof c === 'object' && c ? (c._all ?? 0) : 0;
    }

    return {
      data: {
        users: users.length,
        activeUsers7d: active7d.length,
        dormantDays: DORMANT_DAYS,
        dormantUsers: dormant,
        failedSignIns24h: failed24h,
        failedSignIns7d: failed7d,
        securityEvents7d,
      },
    };
  }
}
