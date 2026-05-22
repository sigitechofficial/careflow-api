import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LinkActionChecklistDto {
  @ApiProperty()
  @IsUUID()
  checklistId!: string;
}
