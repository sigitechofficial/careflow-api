import { PartialType } from '@nestjs/swagger';
import {
  ServiceUserLegalAuthorityCategory,
  ServiceUserLegalAuthorityVerification,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const optionalDate = () =>
  ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '');

export class CreateServiceUserLegalAuthorityDto {
  @IsEnum(ServiceUserLegalAuthorityCategory)
  category!: ServiceUserLegalAuthorityCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  holderName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  holderRelationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  holderContact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  scope?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  lifeSustainingTreatment?: boolean | null;

  @IsOptional()
  @optionalDate()
  @IsDateString()
  registeredOn?: string | null;

  @IsOptional()
  @optionalDate()
  @IsDateString()
  expiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsEnum(ServiceUserLegalAuthorityVerification)
  verificationStatus?: ServiceUserLegalAuthorityVerification;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  verificationMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServiceUserLegalAuthorityDto extends PartialType(CreateServiceUserLegalAuthorityDto) {}
