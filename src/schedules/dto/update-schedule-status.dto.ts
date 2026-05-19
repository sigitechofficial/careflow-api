import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ScheduleStatus } from '../enums/schedule-status.enum';

export class UpdateScheduleAreaStatusItemDto {
  @ApiProperty()
  @IsUUID()
  scheduleAreaId!: string;

  @ApiProperty({ enum: ScheduleStatus })
  @IsEnum(ScheduleStatus)
  status!: ScheduleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateScheduleStatusDto {
  @ApiPropertyOptional({ enum: ScheduleStatus })
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ type: [UpdateScheduleAreaStatusItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateScheduleAreaStatusItemDto)
  areaStatuses?: UpdateScheduleAreaStatusItemDto[];
}
