import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ScheduleRunStatus } from '@prisma/client';
import { CreateScheduleRunDto } from './create-schedule-run.dto';

export class UpdateScheduleRunDto extends PartialType(
  OmitType(CreateScheduleRunDto, ['employeeId'] as const),
) {
  @ApiPropertyOptional({ enum: ScheduleRunStatus })
  @IsOptional()
  @IsEnum(ScheduleRunStatus)
  status?: ScheduleRunStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  employeeId?: string | null;
}
