import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  ServiceUserDnacprStatusConfirmation,
  ServiceUserLpaStatusConfirmation,
} from '@prisma/client';

export class PatchServiceUserLegalDocumentsDto {
  @IsOptional()
  @IsBoolean()
  dnacprInPlace?: boolean;

  @IsOptional()
  @IsEnum(ServiceUserDnacprStatusConfirmation)
  dnacprStatusConfirmation?: ServiceUserDnacprStatusConfirmation;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  dnacprPhysicalLocation?: string | null;

  @IsOptional()
  @IsEnum(ServiceUserLpaStatusConfirmation)
  lpaStatusConfirmation?: ServiceUserLpaStatusConfirmation;

  /** YYYY-MM-DD or empty string to clear; omit to leave unchanged */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  dnacprStartDate?: string | null;
}
