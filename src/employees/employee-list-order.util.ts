import type { Prisma } from '@prisma/client';
import type { EmployeeQueryDto } from './dto/employee-query.dto';

export const EMPLOYEE_LIST_SORT_FIELDS = [
  'name',
  'status',
  'immigration',
  'jobTitle',
  'role',
  'grade',
  'contractType',
  'createdAt',
  'updatedAt',
] as const;

export type EmployeeListSortField = (typeof EMPLOYEE_LIST_SORT_FIELDS)[number];

export function buildEmployeeListOrderBy(
  query: EmployeeQueryDto,
): Prisma.EmployeeOrderByWithRelationInput[] {
  const order = query.sortOrder ?? 'desc';
  const sortBy = (query.sortBy ?? 'updatedAt') as EmployeeListSortField;

  switch (sortBy) {
    case 'name':
      return [
        { personalDetail: { lastName: order } },
        { personalDetail: { firstName: order } },
      ];
    case 'status':
      return [{ personalDetail: { status: { name: order } } }];
    case 'immigration':
      return [{ employment: { visaTypeId: order } }];
    case 'jobTitle':
      return [{ employment: { jobTitle: { name: order } } }];
    case 'role':
      return [{ employment: { role: { name: order } } }];
    case 'grade':
      return [{ employment: { grade: { name: order } } }];
    case 'contractType':
      return [{ employment: { contractType: { name: order } } }];
    case 'createdAt':
      return [{ createdAt: order }];
    case 'updatedAt':
    default:
      return [{ updatedAt: order }];
  }
}
