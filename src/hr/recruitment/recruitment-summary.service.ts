import { Injectable } from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import {
  candidateScopeWhere,
  resolveRecruitmentScope,
  vacancyScopeWhere,
} from './utils/recruitment-scope.util';
import { FLOW_STAGES as PIPELINE_STAGES } from './utils/recruitment-flow.util';

@Injectable()
export class RecruitmentSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(user: RequestUser) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const vacancyWhere = { deletedAt: null, ...vacancyScopeWhere(scope) };
    const candidateScope = await candidateScopeWhere(this.prisma, scope);

    const [openVacancies, activeCandidates, stageGroups, recentApplications] =
      await this.prisma.$transaction([
        this.prisma.vacancy.count({
          where: { ...vacancyWhere, status: VacancyStatus.OPEN },
        }),
        this.prisma.candidate.count({
          where: {
            deletedAt: null,
            stage: { in: PIPELINE_STAGES },
            ...candidateScope,
          },
        }),
        this.prisma.candidate.groupBy({
          by: ['stage'],
          orderBy: { stage: 'asc' },
          where: {
            deletedAt: null,
            ...candidateScope,
          },
          _count: { _all: true },
        }),
        this.prisma.candidate.findMany({
          where: { deletedAt: null, ...candidateScope },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            vacancy: { select: { title: true, recordNo: true } },
          },
        }),
      ]);

    const pipelineSummary = PIPELINE_STAGES.map((stage) => {
      const group = stageGroups.find((g) => g.stage === stage);
      const count =
        group && typeof group._count === 'object' && group._count !== null
          ? group._count._all ?? 0
          : 0;
      return { stage, count };
    });

    return {
      data: {
        openVacancies,
        activeCandidates,
        pipelineSummary,
        recentApplications: recentApplications.map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`,
          stage: c.stage,
          vacancyTitle: c.vacancy.title,
          createdAt: c.createdAt,
        })),
      },
    };
  }
}
