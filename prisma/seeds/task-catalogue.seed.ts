import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveVisitTaskCompletionInput } from '../../src/visit-tasks/visit-task-completion-input.util';

type SeedTask = {
  name: string;
  supportLevelApplicable?: boolean;
  consentRequired?: boolean;
  competencyGated?: boolean;
  competency?: string | null;
  outOfScope?: boolean | string;
  feedsObservation?: string[];
  evidenceRequired?: string[];
  recurring?: boolean;
  mandatory?: boolean;
  seniorOnly?: boolean;
  defaultHorizon?: string;
  $note?: string;
};

type SeedCategory = {
  category: string;
  tasks: SeedTask[];
};

type SeedGroup = {
  group: string;
  source?: string;
  categories: SeedCategory[];
};

type TaskCatalogueSeedFile = {
  categories: SeedGroup[];
};

function resolveOutOfScope(value: SeedTask['outOfScope']): boolean {
  if (value === true) return true;
  if (typeof value === 'string' && value.toLowerCase() === 'conditional') return true;
  return false;
}

function buildFlagsJson(task: SeedTask): Record<string, unknown> | null {
  const flags: Record<string, unknown> = {};
  if (task.feedsObservation?.length) flags.feedsObservation = task.feedsObservation;
  if (task.evidenceRequired?.length) flags.evidenceRequired = task.evidenceRequired;
  if (task.recurring) flags.recurring = true;
  if (task.mandatory) flags.mandatory = true;
  if (task.seniorOnly) flags.seniorOnly = true;
  if (task.defaultHorizon) flags.defaultHorizon = task.defaultHorizon;
  if (task.$note) flags.note = task.$note;
  flags.completionInput = resolveVisitTaskCompletionInput({
    name: task.name,
    flagsJson: flags,
  });
  return Object.keys(flags).length > 0 ? flags : null;
}

export async function seedTaskCatalogue(prisma: PrismaClient): Promise<void> {
  const seedPath = join(process.cwd(), 'task-catalogue-seed.json');
  const raw = readFileSync(seedPath, 'utf8');
  const parsed = JSON.parse(raw) as TaskCatalogueSeedFile;

  let groupOrder = 0;
  for (const groupBlock of parsed.categories) {
    const group = await prisma.taskCatalogueGroup.upsert({
      where: { code: groupBlock.group },
      update: {
        source: groupBlock.source ?? null,
        sortOrder: groupOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        id: randomUUID(),
        code: groupBlock.group,
        source: groupBlock.source ?? null,
        sortOrder: groupOrder,
        isActive: true,
      },
    });
    groupOrder += 1;

    let categoryOrder = 0;
    for (const categoryBlock of groupBlock.categories) {
      const existingCategory = await prisma.taskCatalogueCategory.findFirst({
        where: { groupId: group.id, name: categoryBlock.category, deletedAt: null },
      });

      const category =
        existingCategory ??
        (await prisma.taskCatalogueCategory.create({
          data: {
            id: randomUUID(),
            groupId: group.id,
            name: categoryBlock.category,
            sortOrder: categoryOrder,
            isActive: true,
          },
        }));

      if (existingCategory) {
        await prisma.taskCatalogueCategory.update({
          where: { id: category.id },
          data: { sortOrder: categoryOrder, isActive: true, deletedAt: null },
        });
      }

      let taskOrder = 0;
      for (const task of categoryBlock.tasks) {
        const existingTask = await prisma.taskCatalogueTask.findFirst({
          where: { categoryId: category.id, name: task.name, deletedAt: null },
        });

        const data = {
          sortOrder: taskOrder,
          supportLevelApplicable: task.supportLevelApplicable ?? false,
          consentRequired: task.consentRequired ?? false,
          competencyGated: task.competencyGated ?? false,
          competency: task.competency ?? null,
          outOfScope: resolveOutOfScope(task.outOfScope),
          flagsJson: (buildFlagsJson(task) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          isActive: true,
          deletedAt: null,
        };

        if (existingTask) {
          await prisma.taskCatalogueTask.update({
            where: { id: existingTask.id },
            data,
          });
        } else {
          await prisma.taskCatalogueTask.create({
            data: {
              id: randomUUID(),
              categoryId: category.id,
              name: task.name,
              ...data,
            },
          });
        }
        taskOrder += 1;
      }
      categoryOrder += 1;
    }
  }
}
