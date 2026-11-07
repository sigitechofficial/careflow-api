import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEmployeeReviewDto {
  @ApiProperty()
  @IsUUID()
  reviewTypeId!: string;

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

  @ApiPropertyOptional({ maxLength: 2000, description: 'Short note; the detail belongs in the document or a supervision session.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Supporting document URL (uploaded via employee documents)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  documentUrl?: string;

  @ApiPropertyOptional({ description: 'User ID who reviewed' })
  @IsOptional()
  @IsUUID()
  reviewedById?: string;
}

/** Preview of the next due date a review would get (Staff reviews → Record a review). */
export class NextDuePreviewQueryDto {
  @ApiProperty()
  @IsUUID()
  reviewTypeId!: string;

  @ApiPropertyOptional({ description: 'Date the review was done; left out = the first one from the start date.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastDone?: Date;
}
