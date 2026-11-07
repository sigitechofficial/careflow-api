import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateEmployeeReviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewTypeId?: string;

  @ApiPropertyOptional({
    description: 'Ignored: the API works out status (SCHEDULED, DUE_SOON, OVERDUE, COMPLETED) from the dates.',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastDone?: Date;

  @ApiPropertyOptional({
    description: "Leave out to use the review type's schedule (e.g. last done + 90 days for supervision, the next probation milestone).",
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextDue?: Date;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'Supporting document URL (uploaded via employee documents)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  documentUrl?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  reviewedById?: string | null;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Why it changed. Required when the type, last done or next due date changes; kept in the history.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

