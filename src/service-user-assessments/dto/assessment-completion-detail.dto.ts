import { ApiProperty } from '@nestjs/swagger';

export class ServiceUserAssessmentCompletionDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  assessmentId!: string;

  @ApiProperty()
  assessmentKey!: string;

  @ApiProperty()
  source!: string;

  @ApiProperty({ nullable: true })
  sourceSubmissionId!: string | null;

  @ApiProperty({ nullable: true })
  sourceHolisticTabId!: number | null;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty({ nullable: true })
  completedById!: string | null;

  @ApiProperty()
  summary!: string;

  @ApiProperty()
  snapshot!: Record<string, unknown>;
}
