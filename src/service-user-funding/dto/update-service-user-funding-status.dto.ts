import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FundingStatus } from '../enums/funding-status.enum';

export class UpdateServiceUserFundingStatusDto {
  @ApiProperty({ enum: FundingStatus })
  @IsEnum(FundingStatus)
  status!: FundingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
