import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'holidayEndAfterStart', async: false })
class HolidayEndAfterStart implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const obj = args.object as any;
    const from = obj.startDate as Date | undefined;
    const to = obj.endDate as Date | undefined;
    if (!from || !to) return true;
    return to.getTime() >= from.getTime();
  }
  defaultMessage() {
    return 'endDate must be on or after startDate';
  }
}

export class CreateEmployeeHolidayDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  startDate!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  @Validate(HolidayEndAfterStart)
  endDate!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true (default), unallocate this employee from jobs in the holiday date range',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  applyToSchedule?: boolean;
}

