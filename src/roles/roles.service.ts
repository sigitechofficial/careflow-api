import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  create(data: { name: string; description?: string }) {
    return this.prisma.role.create({ data });
  }

  update(id: string, data: { name?: string; description?: string; isActive?: boolean }) {
    return this.prisma.role.update({ where: { id }, data });
  }
}

