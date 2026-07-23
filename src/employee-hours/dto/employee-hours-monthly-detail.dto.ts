import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class EmployeeHoursMonthlyDetailQueryDto {
  @ApiProperty({ description: 'Employee id' })
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({
    example: '2026-07',
    description: 'Calendar month (YYYY-MM). Defaults to the current UTC month.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
