import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AllocateJobDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledVisitId?: string;

  @ApiPropertyOptional({ default: false, description: 'Proceed despite warnings' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Assignment start (ISO). Omit to inherit the job visit window. Must be within the job window when provided.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledStartDateTime?: string;

  @ApiPropertyOptional({
    description:
      'Assignment end (ISO). Omit to inherit the job visit window. Must be within the job window when provided.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional({ description: 'Mark this carer as lead for the visit' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLeadCarer?: boolean;
}
