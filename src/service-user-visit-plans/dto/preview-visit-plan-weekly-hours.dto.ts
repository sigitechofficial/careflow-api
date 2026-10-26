import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { VisitPlanSlotDto } from './visit-plan-slot.dto';

/** Unsaved visit schedule to count weekly hours for (same shape as a plan save). */
export class PreviewVisitPlanWeeklyHoursDto {
  @ApiPropertyOptional({ type: [VisitPlanSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitPlanSlotDto)
  slots?: VisitPlanSlotDto[];
}
