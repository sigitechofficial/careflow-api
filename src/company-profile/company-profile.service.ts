import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPANY_ACTIVE_MODULES,
  COMPANY_MODULE_CATALOG,
} from '../../prisma/seed-data/company-active-modules';
import type { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

const DEFAULT_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

function uploadRoot() {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'company');
}

function mapRow(row: {
  id: string;
  groupName: string | null;
  companyName: string;
  odsCsCode: string;
  displayName: string;
  displayLogoUrl: string | null;
  displayLogoFileName: string | null;
  companyLogoUrl: string | null;
  companyLogoFileName: string | null;
  companyWebsite: string | null;
  contactName: string;
  email: string;
  phoneNumber: string;
  companyNumber: string | null;
  vatNumber: string | null;
  bankName: string | null;
  bankSortCode: string | null;
  bankAccountNumber: string | null;
  activeModules: string[];
  updatedAt: Date;
}, counts: { numberOfCarers: number; numberOfServiceUsers: number }) {
  return {
    id: row.id,
    groupName: row.groupName,
    companyName: row.companyName,
    odsCsCode: row.odsCsCode,
    displayName: row.displayName,
    displayLogoUrl: row.displayLogoUrl,
    displayLogoFileName: row.displayLogoFileName,
    companyLogoUrl: row.companyLogoUrl,
    companyLogoFileName: row.companyLogoFileName,
    companyWebsite: row.companyWebsite,
    contactName: row.contactName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    companyNumber: row.companyNumber,
    vatNumber: row.vatNumber,
    bankName: row.bankName,
    bankSortCode: row.bankSortCode,
    bankAccountNumber: row.bankAccountNumber,
    numberOfCarers: counts.numberOfCarers,
    numberOfServiceUsers: counts.numberOfServiceUsers,
    activeModules: row.activeModules,
    availableModules: [...COMPANY_ACTIVE_MODULES],
    moduleCatalog: COMPANY_MODULE_CATALOG.map((m) => ({ ...m })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CompanyProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate() {
    let row = await this.prisma.companyProfile.findUnique({
      where: { id: DEFAULT_PROFILE_ID },
    });
    if (row) return row;
    row = await this.prisma.companyProfile.create({
      data: {
        id: DEFAULT_PROFILE_ID,
        companyName: 'Company',
        odsCsCode: '',
        displayName: 'Company',
        contactName: '',
        email: 'admin@example.com',
        phoneNumber: '',
        activeModules: [],
      },
    });
    return row;
  }

  /** Active, non-deleted employees and service users (matches default list screens). */
  private async organisationCounts() {
    const [numberOfCarers, numberOfServiceUsers] = await Promise.all([
      this.prisma.employee.count({
        where: {
          deletedAt: null,
          isActive: true,
          personalDetail: { is: { deletedAt: null } },
        },
      }),
      this.prisma.serviceUser.count({
        where: { deletedAt: null, isActive: true },
      }),
    ]);
    return { numberOfCarers, numberOfServiceUsers };
  }

  private async toResponse(row: Awaited<ReturnType<CompanyProfileService['getOrCreate']>>) {
    const counts = await this.organisationCounts();
    return { data: mapRow(row, counts) };
  }

  private validateActiveModules(modules: string[] | undefined) {
    if (!modules) return;
    const allowed = new Set(COMPANY_ACTIVE_MODULES);
    for (const m of modules) {
      if (!allowed.has(m as (typeof COMPANY_ACTIVE_MODULES)[number])) {
        throw new BadRequestException(`Invalid active module: ${m}`);
      }
    }
  }

  async get() {
    const row = await this.getOrCreate();
    return this.toResponse(row);
  }

  /** Public branding for login shell (no sensitive fields). */
  async getBranding() {
    const row = await this.getOrCreate();
    return {
      data: {
        displayName: row.displayName,
        groupName: row.groupName,
        displayLogoUrl: row.displayLogoUrl,
        companyLogoUrl: row.companyLogoUrl,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  async update(userId: string, dto: UpdateCompanyProfileDto) {
    const existing = await this.getOrCreate();
    this.validateActiveModules(dto.activeModules);

    if (dto.companyName !== undefined && !dto.companyName.trim()) {
      throw new BadRequestException('companyName is required');
    }
    if (dto.odsCsCode !== undefined && !dto.odsCsCode.trim()) {
      throw new BadRequestException('odsCsCode is required');
    }
    if (dto.displayName !== undefined && !dto.displayName.trim()) {
      throw new BadRequestException('displayName is required');
    }
    if (dto.contactName !== undefined && !dto.contactName.trim()) {
      throw new BadRequestException('contactName is required');
    }
    if (dto.email !== undefined && !dto.email.trim()) {
      throw new BadRequestException('email is required');
    }
    if (dto.phoneNumber !== undefined && !dto.phoneNumber.trim()) {
      throw new BadRequestException('phoneNumber is required');
    }

    const row = await this.prisma.companyProfile.update({
      where: { id: existing.id },
      data: {
        groupName: dto.groupName !== undefined ? dto.groupName.trim() || null : undefined,
        companyName: dto.companyName?.trim(),
        odsCsCode: dto.odsCsCode?.trim(),
        displayName: dto.displayName?.trim(),
        companyWebsite: dto.companyWebsite !== undefined ? dto.companyWebsite.trim() || null : undefined,
        contactName: dto.contactName?.trim(),
        email: dto.email?.trim(),
        phoneNumber: dto.phoneNumber?.trim(),
        companyNumber: dto.companyNumber !== undefined ? dto.companyNumber.trim() || null : undefined,
        vatNumber: dto.vatNumber !== undefined ? dto.vatNumber.trim() || null : undefined,
        bankName: dto.bankName !== undefined ? dto.bankName.trim() || null : undefined,
        bankSortCode: dto.bankSortCode !== undefined ? dto.bankSortCode.trim() || null : undefined,
        bankAccountNumber:
          dto.bankAccountNumber !== undefined ? dto.bankAccountNumber.trim() || null : undefined,
        activeModules: dto.activeModules,
        updatedById: userId,
      },
    });

    return { message: 'Company details updated', ...(await this.toResponse(row)) };
  }

  private filePathFromUrl(url: string | null | undefined): string | null {
    if (!url?.startsWith('/uploads/')) return null;
    return join(process.cwd(), url.replace(/^\//, ''));
  }

  private async removeFile(url: string | null | undefined) {
    const path = this.filePathFromUrl(url);
    if (!path) return;
    try {
      await unlink(path);
    } catch {
      /* ignore missing file */
    }
  }

  async uploadDisplayLogo(userId: string, file: Express.Multer.File) {
    const existing = await this.getOrCreate();
    await this.removeFile(existing.displayLogoUrl);
    const url = `/uploads/company/${file.filename}`;
    const row = await this.prisma.companyProfile.update({
      where: { id: existing.id },
      data: {
        displayLogoUrl: url,
        displayLogoFileName: file.originalname,
        updatedById: userId,
      },
    });
    return { message: 'Display logo uploaded', ...(await this.toResponse(row)) };
  }

  async uploadCompanyLogo(userId: string, file: Express.Multer.File) {
    const existing = await this.getOrCreate();
    await this.removeFile(existing.companyLogoUrl);
    const url = `/uploads/company/${file.filename}`;
    const row = await this.prisma.companyProfile.update({
      where: { id: existing.id },
      data: {
        companyLogoUrl: url,
        companyLogoFileName: file.originalname,
        updatedById: userId,
      },
    });
    return { message: 'Company logo uploaded', ...(await this.toResponse(row)) };
  }

  async clearDisplayLogo(userId: string) {
    const existing = await this.getOrCreate();
    if (!existing.displayLogoUrl) {
      throw new NotFoundException('No display logo to remove');
    }
    await this.removeFile(existing.displayLogoUrl);
    const row = await this.prisma.companyProfile.update({
      where: { id: existing.id },
      data: {
        displayLogoUrl: null,
        displayLogoFileName: null,
        updatedById: userId,
      },
    });
    return { message: 'Display logo removed', ...(await this.toResponse(row)) };
  }

  static uploadDirectory() {
    return uploadRoot();
  }
}
