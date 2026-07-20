import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class EmployeeVisitsQueryDto {
  @ApiProperty({ example: '2026-07', description: 'UTC calendar month (YYYY-MM)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be YYYY-MM' })
  month!: string;
}
