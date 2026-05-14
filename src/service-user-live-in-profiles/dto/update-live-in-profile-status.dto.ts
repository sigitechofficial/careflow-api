import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LiveInProfileStatus } from '../enums/live-in-profile-status.enum';

export class UpdateLiveInProfileStatusDto {
  @ApiProperty({ enum: LiveInProfileStatus })
  @IsEnum(LiveInProfileStatus)
  status!: LiveInProfileStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
