import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateServiceUserVisitTaskSettingsDto {
  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 1440,
    example: 60,
    description:
      'When no visit covers a task, it moves to the nearest visit only if that visit is within ' +
      'this many minutes of the due time. Null = no limit.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  nearestVisitGraceMinutes?: number | null;
}
