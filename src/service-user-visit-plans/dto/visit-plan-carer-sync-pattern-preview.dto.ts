import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { VisitPlanSlotDto } from './visit-plan-slot.dto';

export class VisitPlanCarerSyncPatternPreviewDto {
  @ApiPropertyOptional({ type: [VisitPlanSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitPlanSlotDto)
  slots?: VisitPlanSlotDto[];
}
