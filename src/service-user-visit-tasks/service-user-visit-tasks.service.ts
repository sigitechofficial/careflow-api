import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ReplaceServiceUserVisitTasksDto } from './dto/replace-service-user-visit-tasks.dto';

const assignmentInclude = {
  task: {
    include: {
      category: {
        include: {
          group: true,
        },
      },
    },
  },
} satisfies Prisma.ServiceUserVisitTaskAssignmentInclude;

function normalizeInstructions(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class ServiceUserVisitTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureServiceUser(serviceUserId: string) {
    const row = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Service user not found');
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const [assignments, rounds] = await Promise.all([
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: { serviceUserId, deletedAt: null, isActive: true },
        orderBy: [
          { medicationRoundCode: 'asc' },
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        include: assignmentInclude,
      }),
      this.prisma.medicationAdministrationRound.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          code: true,
          time: true,
          windowStart: true,
          windowEnd: true,
          sortOrder: true,
        },
      }),
    ]);

    const byRound = new Map<string, ReturnType<typeof this.mapAssignment>[]>();
    for (const assignment of assignments) {
      const code = assignment.medicationRoundCode;
      const list = byRound.get(code) ?? [];
      list.push(this.mapAssignment(assignment));
      byRound.set(code, list);
    }

    return {
      data: {
        rounds,
        assignmentsByRound: Object.fromEntries(byRound),
      },
    };
  }

  async replace(
    userId: string,
    serviceUserId: string,
    dto: ReplaceServiceUserVisitTasksDto,
    meta?: RequestAuditMeta,
  ) {
    void meta;
    await this.ensureServiceUser(serviceUserId);

    const desired = new Map<
      string,
      Array<{ taskCatalogueTaskId: string; carerInstructions: string | null }>
    >();
    for (const round of dto.rounds) {
      const code = round.medicationRoundCode.trim().toUpperCase();
      if (!code) continue;
      const seen = new Set<string>();
      const items: Array<{ taskCatalogueTaskId: string; carerInstructions: string | null }> = [];
      for (const task of round.tasks) {
        if (seen.has(task.taskCatalogueTaskId)) continue;
        seen.add(task.taskCatalogueTaskId);
        items.push({
          taskCatalogueTaskId: task.taskCatalogueTaskId,
          carerInstructions: normalizeInstructions(task.carerInstructions),
        });
      }
      desired.set(code, items);
    }

    const taskIds = [
      ...new Set(
        dto.rounds.flatMap((round) => round.tasks.map((task) => task.taskCatalogueTaskId)),
      ),
    ];
    if (taskIds.length > 0) {
      const count = await this.prisma.taskCatalogueTask.count({
        where: { id: { in: taskIds }, deletedAt: null, isActive: true },
      });
      if (count !== taskIds.length) {
        throw new NotFoundException('One or more catalogue tasks were not found');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserVisitTaskAssignment.findMany({
        where: { serviceUserId, deletedAt: null },
      });

      const existingByKey = new Map(
        existing.map((row) => [`${row.medicationRoundCode}:${row.taskCatalogueTaskId}`, row]),
      );

      const keepIds = new Set<string>();

      for (const [roundCode, items] of desired.entries()) {
        let sortOrder = 0;
        for (const item of items) {
          const key = `${roundCode}:${item.taskCatalogueTaskId}`;
          const prev = existingByKey.get(key);
          if (prev) {
            await tx.serviceUserVisitTaskAssignment.update({
              where: { id: prev.id },
              data: {
                isActive: true,
                deletedAt: null,
                sortOrder,
                carerInstructions: item.carerInstructions,
                updatedById: userId,
              },
            });
            keepIds.add(prev.id);
          } else {
            const created = await tx.serviceUserVisitTaskAssignment.create({
              data: {
                serviceUserId,
                medicationRoundCode: roundCode,
                taskCatalogueTaskId: item.taskCatalogueTaskId,
                sortOrder,
                carerInstructions: item.carerInstructions,
                createdById: userId,
                updatedById: userId,
              },
            });
            keepIds.add(created.id);
          }
          sortOrder += 1;
        }
      }

      const toDeactivate = existing.filter((row) => !keepIds.has(row.id));
      if (toDeactivate.length > 0) {
        await tx.serviceUserVisitTaskAssignment.updateMany({
          where: { id: { in: toDeactivate.map((row) => row.id) } },
          data: {
            isActive: false,
            deletedAt: new Date(),
            updatedById: userId,
          },
        });
      }
    });

    return this.list(serviceUserId);
  }

  private mapAssignment(
    row: Prisma.ServiceUserVisitTaskAssignmentGetPayload<{ include: typeof assignmentInclude }>,
  ) {
    return {
      id: row.id,
      medicationRoundCode: row.medicationRoundCode,
      sortOrder: row.sortOrder,
      carerInstructions: row.carerInstructions,
      task: {
        id: row.task.id,
        name: row.task.name,
        categoryId: row.task.categoryId,
        categoryName: row.task.category.name,
        groupCode: row.task.category.group.code,
        supportLevelApplicable: row.task.supportLevelApplicable,
        consentRequired: row.task.consentRequired,
        competencyGated: row.task.competencyGated,
        competency: row.task.competency,
        outOfScope: row.task.outOfScope,
        flagsJson: row.task.flagsJson,
      },
    };
  }
}
