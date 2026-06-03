import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export const IA_AUTOFILL_LEVELS = ['low', 'normal', 'critical'] as const;
export type IaAutofillLevelDto = (typeof IA_AUTOFILL_LEVELS)[number];

export class RunIaPlaywrightDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty({ enum: IA_AUTOFILL_LEVELS })
  @IsIn(IA_AUTOFILL_LEVELS)
  level!: IaAutofillLevelDto;
}
