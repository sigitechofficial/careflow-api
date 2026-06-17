import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleRunStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateScheduleRunDto } from './create-schedule-run.dto';

export class UpdateScheduleRunDto extends PartialType(
  OmitType(CreateScheduleRunDto, ['visitIds', 'employeeId'] as const),
) {
  @ApiPropertyOptional({ enum: ScheduleRunStatus })
  @IsOptional()
  @IsEnum(ScheduleRunStatus)
  status?: ScheduleRunStatus;

  @ApiPropertyOptional({ description: 'Assigned carer (employee)', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  employeeId?: string | null;
}
