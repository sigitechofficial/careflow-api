import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'dateToAfterDateFromUpdate', async: false })
class DateToAfterDateFromUpdateConstraint implements ValidatorConstraintInterface {
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

export class UpdateNonCoreActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @Validate(DateToAfterDateFromUpdateConstraint)
  dateTo?: Date;

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
}

