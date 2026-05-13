import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateServiceUserDolsRecordDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  applicationDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @IsOptional()
  @IsBoolean()
  reportedToChc?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;
}
