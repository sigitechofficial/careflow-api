import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'holidayEndAfterStartUpdate', async: false })
class HolidayEndAfterStartUpdate implements ValidatorConstraintInterface {
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

export class UpdateEmployeeHolidayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @Validate(HolidayEndAfterStartUpdate)
  endDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

