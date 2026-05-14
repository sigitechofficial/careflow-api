import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export async function assertServiceUserExists(prisma: PrismaService, serviceUserId: string) {
  const su = await prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
  if (!su) throw new NotFoundException('Service user not found');
  return su;
}

export async function assertActiveEmployee(prisma: PrismaService, employeeId: string | null | undefined) {
  if (!employeeId) return;
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null, isActive: true },
  });
  if (!emp) throw new BadRequestException('Administering employee is invalid or inactive');
}
