import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class EmployeeVisaTypeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ minimum: 0, maximum: 168 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(168)
  weeklyHours!: number;
}
