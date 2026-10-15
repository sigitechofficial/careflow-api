import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSpecialVisitDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty({ description: 'Start date/time (ISO)' })
  @IsDateString()
  startDateTime!: string;

  @ApiProperty({ description: 'End date/time (ISO)' })
  @IsDateString()
  endDateTime!: string;

  @ApiProperty({ description: 'Short title / reason for the special visit' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SpecialVisitQueryDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ description: 'Week start date (YYYY-MM-DD)' })
  @IsDateString()
  weekStart!: string;
}
