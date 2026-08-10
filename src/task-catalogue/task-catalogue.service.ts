import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskCatalogueTaskDto } from './dto/create-task-catalogue-task.dto';
import { UpdateTaskCatalogueTaskDto } from './dto/update-task-catalogue-task.dto';
import { buildTaskCatalogueFlagsJson } from './task-catalogue-flags.util';

function mapTask(task: {
  id: string;
  name: string;
  sortOrder: number;
  supportLevelApplicable: boolean;
  consentRequired: boolean;
  competencyGated: boolean;
  competency: string | null;
  outOfScope: boolean;
  requiresMultipleCarers: boolean;
  flagsJson: Prisma.JsonValue;
  isActive: boolean;
}) {
  return {
    id: task.id,
    name: task.name,
    sortOrder: task.sortOrder,
    supportLevelApplicable: task.supportLevelApplicable,
    consentRequired: task.consentRequired,
    competencyGated: task.competencyGated,
    competency: task.competency,
    outOfScope: task.outOfScope,
    requiresMultipleCarers: task.requiresMultipleCarers,
    flagsJson: task.flagsJson,
    isActive: task.isActive,
  };
}

@Injectable()
export class TaskCatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalogue(includeInactive = false) {
    const activeFilter = includeInactive ? {} : { isActive: true };
    const groups = await this.prisma.taskCatalogueGroup.findMany({
      where: { deletedAt: null, ...activeFilter },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        categories: {
          where: { deletedAt: null, ...activeFilter },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            tasks: {
              where: { deletedAt: null, ...activeFilter },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            },
          },
        },
      },
    });

    return {
      data: groups.map((group) => ({
        id: group.id,
        code: group.code,
        source: group.source,
        sortOrder: group.sortOrder,
        isActive: group.isActive,
        categories: group.categories.map((category) => ({
          id: category.id,
          name: category.name,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          tasks: category.tasks.map(mapTask),
        })),
      })),
    };
  }

  async createTask(_userId: string, dto: CreateTaskCatalogueTaskDto) {
    void _userId;
    const category = await this.prisma.taskCatalogueCategory.findFirst({
      where: { id: dto.categoryId, deletedAt: null, isActive: true },
      include: { group: true },
    });
    if (!category) throw new NotFoundException('Task category not found');

    const name = dto.name.trim();
    const duplicate = await this.prisma.taskCatalogueTask.findFirst({
      where: { categoryId: category.id, name, deletedAt: null },
    });
    if (duplicate) {
      throw new ConflictException('A task with this name already exists in the selected category');
    }

    const maxSort = await this.prisma.taskCatalogueTask.aggregate({
      where: { categoryId: category.id, deletedAt: null },
      _max: { sortOrder: true },
    });

    const created = await this.prisma.taskCatalogueTask.create({
      data: {
        categoryId: category.id,
        name,
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        supportLevelApplicable: dto.supportLevelApplicable ?? false,
        consentRequired: dto.consentRequired ?? false,
        competencyGated: dto.competencyGated ?? false,
        competency: dto.competencyGated ? dto.competency?.trim() ?? null : null,
        outOfScope: dto.outOfScope ?? false,
        requiresMultipleCarers: dto.requiresMultipleCarers ?? false,
        flagsJson: buildTaskCatalogueFlagsJson(name),
      },
    });

    return { message: 'Task created', data: mapTask(created) };
  }

  async updateTask(_userId: string, id: string, dto: UpdateTaskCatalogueTaskDto) {
    void _userId;
    const existing = await this.prisma.taskCatalogueTask.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Task not found');

    let categoryId = existing.categoryId;
    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      const category = await this.prisma.taskCatalogueCategory.findFirst({
        where: { id: dto.categoryId, deletedAt: null, isActive: true },
      });
      if (!category) throw new NotFoundException('Task category not found');
      categoryId = category.id;
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    if (!name) throw new BadRequestException('Task name is required');

    const duplicate = await this.prisma.taskCatalogueTask.findFirst({
      where: {
        categoryId,
        name,
        deletedAt: null,
        NOT: { id },
      },
    });
    if (duplicate) {
      throw new ConflictException('A task with this name already exists in the selected category');
    }

    const competencyGated = dto.competencyGated ?? existing.competencyGated;
    const existingFlags =
      existing.flagsJson && typeof existing.flagsJson === 'object' && !Array.isArray(existing.flagsJson)
        ? (existing.flagsJson as Record<string, unknown>)
        : null;

    const updated = await this.prisma.taskCatalogueTask.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined ? { categoryId } : {}),
        name,
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.supportLevelApplicable !== undefined
          ? { supportLevelApplicable: dto.supportLevelApplicable }
          : {}),
        ...(dto.consentRequired !== undefined ? { consentRequired: dto.consentRequired } : {}),
        ...(dto.competencyGated !== undefined ? { competencyGated: dto.competencyGated } : {}),
        ...(dto.competency !== undefined || dto.competencyGated !== undefined
          ? { competency: competencyGated ? dto.competency?.trim() ?? null : null }
          : {}),
        ...(dto.outOfScope !== undefined ? { outOfScope: dto.outOfScope } : {}),
        ...(dto.requiresMultipleCarers !== undefined
          ? { requiresMultipleCarers: dto.requiresMultipleCarers }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        flagsJson: buildTaskCatalogueFlagsJson(name, existingFlags),
      },
    });

    return { message: 'Task updated', data: mapTask(updated) };
  }

  async removeTask(_userId: string, id: string) {
    void _userId;
    const existing = await this.prisma.taskCatalogueTask.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Task not found');

    await this.prisma.taskCatalogueTask.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return { message: 'Task removed' };
  }
}
