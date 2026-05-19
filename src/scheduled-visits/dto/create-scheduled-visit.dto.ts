import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ScheduledVisitStatus } from '../enums/scheduled-visit-status.enum';

export class CreateScheduledVisitDto {
  @ApiProperty()
  @IsUUID()
  scheduledJobId!: string;

  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  visitName!: string;

  @ApiProperty()
  @IsString()
  scheduledStartDateTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional({ enum: ScheduledVisitStatus })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requiredCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  medicationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  checklistRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  photoRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  notesRequired?: boolean;
}
