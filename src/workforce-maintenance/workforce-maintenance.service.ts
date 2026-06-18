import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeComplianceService } from '../employee-compliance/employee-compliance.service';

export type WorkforceMaintenanceSummary = {
  complianceStatusUpdates: number;
  expiredSkills: number;
  expiringSkills: number;
  expiredCertifications: number;
  expiringCertifications: number;
};

@Injectable()
export class WorkforceMaintenanceService {
  private readonly logger = new Logger(WorkforceMaintenanceService.name);

  constructor(
    private readonly compliance: EmployeeComplianceService,
    private readonly prisma: PrismaService,
  ) {}

  async runDailyMaintenance(): Promise<WorkforceMaintenanceSummary> {
    const compliance = await this.compliance.runDailyComplianceCheck();
    const skillCert = await this.scanSkillAndCertExpiry();
    this.logger.log(
      `Daily workforce maintenance: compliance=${compliance.updated}, expiredSkills=${skillCert.expiredSkills}, expiringSkills=${skillCert.expiringSkills}, expiredCerts=${skillCert.expiredCertifications}, expiringCerts=${skillCert.expiringCertifications}`,
    );
    return {
      complianceStatusUpdates: compliance.updated,
      ...skillCert,
    };
  }

  /** Count active skill/cert rows past expiry or due within 30 days (UTC). */
  async scanSkillAndCertExpiry() {
    const now = new Date();
    const warnBefore = new Date(now);
    warnBefore.setUTCDate(warnBefore.getUTCDate() + 30);

    const [expiredSkills, expiringSkills, expiredCertifications, expiringCertifications] =
      await Promise.all([
        this.prisma.employeeSkill.count({
          where: { deletedAt: null, isActive: true, expiryDate: { lt: now } },
        }),
        this.prisma.employeeSkill.count({
          where: {
            deletedAt: null,
            isActive: true,
            expiryDate: { gte: now, lte: warnBefore },
          },
        }),
        this.prisma.employeeWorkCertification.count({
          where: { deletedAt: null, isActive: true, expiryDate: { lt: now } },
        }),
        this.prisma.employeeWorkCertification.count({
          where: {
            deletedAt: null,
            isActive: true,
            expiryDate: { gte: now, lte: warnBefore },
          },
        }),
      ]);

    return { expiredSkills, expiringSkills, expiredCertifications, expiringCertifications };
  }
}

@Injectable()
export class WorkforceMaintenanceCron {
  private readonly logger = new Logger(WorkforceMaintenanceCron.name);

  constructor(private readonly maintenance: WorkforceMaintenanceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyMaintenance() {
    try {
      await this.maintenance.runDailyMaintenance();
    } catch (error) {
      this.logger.error('Daily workforce maintenance failed', error);
    }
  }
}
