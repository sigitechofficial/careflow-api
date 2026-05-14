import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LiveInProfileStatus } from '../enums/live-in-profile-status.enum';

export class CreateLiveInProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLiveInEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  residentContactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  levelOfCareId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scanTypeId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  numberOfCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  careInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ enum: LiveInProfileStatus })
  @IsOptional()
  @IsEnum(LiveInProfileStatus)
  status?: LiveInProfileStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
