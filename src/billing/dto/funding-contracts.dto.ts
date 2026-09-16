import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { BillingCardQueryDto } from './billing-cards.dto';

export class FundingContractsQueryDto extends BillingCardQueryDto {
  @ApiPropertyOptional({ enum: ['READY', 'INCOMPLETE', 'ENDED', 'ALL'] })
  @IsOptional()
  @IsString()
  readiness?: 'READY' | 'INCOMPLETE' | 'ENDED' | 'ALL';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
