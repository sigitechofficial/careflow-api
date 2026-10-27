import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SpecialistPathwayStatus } from '@prisma/client';

export class UpdateSpecialistPathwayCaseDto {
  @ApiPropertyOptional({
    description:
      'Keyed assessment answers: { [sectionKey]: { fields, verifiedById, verifiedAt } }',
  })
  @IsOptional()
  @IsObject()
  sections?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: SpecialistPathwayStatus })
  @IsOptional()
  @IsEnum(SpecialistPathwayStatus)
  status?: SpecialistPathwayStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  reviewDueDate?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  closedReason?: string;
}
