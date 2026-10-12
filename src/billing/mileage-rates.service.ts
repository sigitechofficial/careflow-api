import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MileageVehicleType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateMileageRateDto, VerifyApprovedMileageAmountsDto } from './dto/mileage-rates.dto';

const toDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00.000Z`);

/**
 * TR-09: mileage rates per period and vehicle type. What the organisation reimburses and what
 * HMRC approves as tax-free are separate figures, entered by people and audited; the application
 * does not carry either of them in its code.
 */
@Injectable()
export class MileageRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list() {
    const rows = await this.prisma.mileageRate.findMany({
      orderBy: [{ vehicleType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return {
      data: rows.map((row) => ({
        ...row,
        approvedAmountsVerified: !!row.approvedVerifiedAt && row.approvedRateFirst != null,
      })),
    };
  }

  /** A change of the organisation's rates from a date. Earlier periods keep their own rates. */
  async create(userId: string, dto: CreateMileageRateDto, meta?: RequestAuditMeta) {
    if (dto.thresholdMiles == null && dto.rateAfter !== dto.rateFirst) {
      throw new BadRequestException(
        'Without a threshold there is one rate: enter the same rate for both, or give the threshold in miles.',
      );
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.mileageRate.create({
          data: {
            effectiveFrom: toDate(dto.effectiveFrom),
            vehicleType: dto.vehicleType as MileageVehicleType,
            rateFirst: dto.rateFirst,
            rateAfter: dto.rateAfter,
            thresholdMiles: dto.thresholdMiles ?? null,
            passengerRate: dto.passengerRate ?? 0,
            label: dto.label?.trim() || null,
            createdById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.BILLING,
          action: AuditAction.MILEAGE_RATE_CREATED,
          recordType: 'MileageRate',
          recordId: created.id,
          newValues: {
            effectiveFrom: dto.effectiveFrom.slice(0, 10),
            vehicleType: created.vehicleType,
            rateFirst: Number(created.rateFirst),
            rateAfter: Number(created.rateAfter),
            thresholdMiles: created.thresholdMiles,
            passengerRate: Number(created.passengerRate),
          },
          metadata: { reason: dto.reason.trim() },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return created;
      });
      return { message: 'Mileage rate added', data: row };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A rate for that vehicle type already starts on that date');
      }
      throw e;
    }
  }

  /**
   * Records HMRC's approved amounts for a period, with where they were checked. From then on the
   * part of a reimbursement above them is treated as taxable; until then it is "not verified".
   */
  async verifyApprovedAmounts(
    userId: string,
    id: string,
    dto: VerifyApprovedMileageAmountsDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.mileageRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Mileage rate not found');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mileageRate.update({
        where: { id },
        data: {
          approvedRateFirst: dto.approvedRateFirst,
          approvedRateAfter: dto.approvedRateAfter ?? dto.approvedRateFirst,
          approvedThresholdMiles: dto.approvedThresholdMiles ?? null,
          approvedPassengerRate: dto.approvedPassengerRate ?? 0,
          approvedSource: dto.source.trim(),
          approvedVerifiedAt: new Date(),
          approvedVerifiedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.MILEAGE_APPROVED_AMOUNTS_VERIFIED,
        recordType: 'MileageRate',
        recordId: id,
        oldValues: {
          approvedRateFirst: existing.approvedRateFirst != null ? Number(existing.approvedRateFirst) : null,
          approvedRateAfter: existing.approvedRateAfter != null ? Number(existing.approvedRateAfter) : null,
          approvedThresholdMiles: existing.approvedThresholdMiles,
        },
        newValues: {
          approvedRateFirst: Number(updated.approvedRateFirst),
          approvedRateAfter: Number(updated.approvedRateAfter),
          approvedThresholdMiles: updated.approvedThresholdMiles,
          approvedPassengerRate: Number(updated.approvedPassengerRate),
        },
        metadata: { source: dto.source.trim() },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return updated;
    });
    return { message: 'HMRC approved amounts recorded', data: row };
  }
}
