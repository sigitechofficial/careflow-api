import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentRecordStatus, PaymentType } from '@prisma/client';

export class PaymentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Scope to payments allocated to invoice runs that include service users at this location; unmatched payments remain visible',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class PaymentAllocationInputDto {
  @IsUUID()
  invoiceRunId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreatePaymentDto {
  @IsString()
  @MaxLength(120)
  reference!: string;

  @IsEnum(PaymentType)
  paymentType!: PaymentType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsEnum(PaymentRecordStatus)
  recordStatus?: PaymentRecordStatus;

  @IsOptional()
  @IsUUID()
  funderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationInputDto)
  allocations?: PaymentAllocationInputDto[];
}

export class AddPaymentAllocationDto {
  @IsUUID()
  invoiceRunId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
