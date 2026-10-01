import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Allocate the whole carer team of a multi-carer visit in one transaction.
 * New visit: every required carer. Gap fill: only the missing carers.
 */
export class AllocateTeamDto {
  @ApiProperty({
    type: [String],
    description:
      'Carers to add in this save. Together with carers already on the visit, must equal requiredCarers.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  employeeIds!: string[];

  @ApiProperty({
    description:
      'Lead carer for the visit. Must be one of employeeIds or a carer already on the visit.',
  })
  @IsUUID()
  leadEmployeeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledVisitId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Proceed despite overridable warnings (never bypasses hard blocks)',
  })
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
    description: 'Assignment start (ISO) for the new carers. Omit to inherit the job visit window.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledStartDateTime?: string;

  @ApiPropertyOptional({
    description: 'Assignment end (ISO) for the new carers. Omit to inherit the job visit window.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledEndDateTime?: string;
}
