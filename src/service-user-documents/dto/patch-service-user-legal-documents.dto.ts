import { IsBoolean, IsDateString, IsOptional, ValidateIf } from 'class-validator';

export class PatchServiceUserLegalDocumentsDto {
  @IsOptional()
  @IsBoolean()
  dnacprInPlace?: boolean;

  /** YYYY-MM-DD or empty string to clear; omit to leave unchanged */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  dnacprStartDate?: string | null;
}
