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
    description: 'Leave out to use last done + the review type interval (e.g. 90 days for supervision).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextDue?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Supporting document URL (uploaded via employee documents)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  documentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewedById?: string;
}

