import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ScheduleBuildSource } from '../enums/schedule-build-source.enum';

/** Reserved for future batch creation flows; Phase 1 uses `POST /schedules/build`. */
export class CreateScheduleBatchDto {
  @ApiProperty({ example: '2026-05-05' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduleDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ScheduleBuildSource })
  @IsOptional()
  @IsEnum(ScheduleBuildSource)
  buildSource?: ScheduleBuildSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
