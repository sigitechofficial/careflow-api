import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class CreateEmployeeComplianceDto {
  @ApiProperty()
  @IsUUID()
  complianceTypeId!: string;

  @ApiPropertyOptional({ description: 'Optional explicit requirement row; otherwise best match from employment is used.' })
  @IsOptional()
  @IsUUID()
  requirementId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @ValidateIf((o) => o.issueDate != null)
  expiryDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
