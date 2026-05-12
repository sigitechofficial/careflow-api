import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class UpdateEmployeeComplianceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  complianceTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requirementId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  submittedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Clear verification when resetting record' })
  @IsOptional()
  @IsBoolean()
  clearVerification?: boolean;
}
