import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'dateToAfterDateFrom', async: false })
class DateToAfterDateFromConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const obj = args.object as any;
    const from = obj.dateFrom as Date | undefined;
    const to = obj.dateTo as Date | undefined;
    if (!from || !to) return true;
    return to.getTime() > from.getTime();
  }
  defaultMessage() {
    return 'dateTo must be after dateFrom';
  }
}

export class CreateNonCoreActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  dateFrom!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  @Validate(DateToAfterDateFromConstraint)
  dateTo!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeInPayroll?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onCallForPeriod?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true (default), unallocate this employee from jobs during the NCA period',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  applyToSchedule?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, each visit the employee is taken off is paid at its visit rate through a pay item awaiting approval, and the activity itself is not paid (no double pay). Needs applyToSchedule.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  payRemovedVisits?: boolean;
}

