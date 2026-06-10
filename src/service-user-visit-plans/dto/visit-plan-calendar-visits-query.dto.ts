import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VisitPlanCalendarVisitsQueryDto {
  @ApiProperty({ example: '2026-06-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
