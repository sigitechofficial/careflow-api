import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { SpecialistPathwayType } from '@prisma/client';

export class CreateSpecialistPathwayCaseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty({ enum: SpecialistPathwayType })
  @IsEnum(SpecialistPathwayType)
  pathwayType!: SpecialistPathwayType;

  @ApiPropertyOptional({
    description:
      'Keyed assessment answers: { [sectionKey]: { fields, verifiedById, verifiedAt } }',
  })
  @IsOptional()
  @IsObject()
  sections?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  reviewDueDate?: string;
}
