import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarChartCellDto {
  @ApiProperty({ example: 15, description: '1-based day column in the grid' })
  day!: number;

  @ApiProperty({ example: '2026-05-15' })
  date!: string;

  @ApiProperty({
    enum: ['due', 'na', 'prn', 'recorded'],
    description:
      'due = scheduled, no event; recorded = administration logged; na = not scheduled; prn = PRN, no administration that day',
  })
  cellState!: 'due' | 'na' | 'prn' | 'recorded';

  @ApiPropertyOptional({ nullable: true })
  recordId!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'G' })
  statusCode!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Given' })
  statusLabel!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#2E7D32' })
  color!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#FFFFFF' })
  textColor!: string | null;

  @ApiProperty({ example: false })
  requiresReview!: boolean;
}

export class MarChartLegendItemDto {
  @ApiProperty({ example: 'G' })
  code!: string;

  @ApiProperty({ example: 'Given' })
  label!: string;

  @ApiProperty({ example: '#2E7D32' })
  color!: string;

  @ApiProperty({ example: '#FFFFFF' })
  textColor!: string;

  @ApiProperty({ example: false })
  requiresReview!: boolean;
}

export class MarChartDaySummaryDto {
  @ApiProperty({ example: '2026-05-28', description: 'UTC date key for today in the chart period' })
  date!: string;

  @ApiProperty({ example: 3, description: 'Scheduled dose-slots still due today' })
  due!: number;

  @ApiProperty({ example: 12, description: 'Administrations recorded today (any status code)' })
  recorded!: number;

  @ApiProperty({
    example: 1,
    description: 'Recorded today with status N or R only',
  })
  missed!: number;

  @ApiProperty({ example: 0, description: 'Recorded today pending manager review' })
  reviewToday!: number;
}

export class MarMonthStatsDto {
  @ApiProperty({
    example: '2026-05-28',
    description:
      'Last calendar date (UTC) included in completion stats: min(today, periodEnd), or full period when viewing a past month',
  })
  completionThroughDate!: string;

  @ApiProperty({
    example: 186,
    description: 'Scheduled dose-slots from period start through completionThroughDate (excludes N/A and PRN-empty days)',
  })
  scheduledToDate!: number;

  @ApiProperty({
    example: 142,
    description: 'Scheduled slots with any administration event (any status code)',
  })
  documented!: number;

  @ApiProperty({
    example: 44,
    description: 'Scheduled slots in the window with no administration record yet',
  })
  stillOpen!: number;

  @ApiProperty({
    example: 128,
    description: 'Documented slots with given codes: G, F, I, S, T',
  })
  given!: number;

  @ApiProperty({
    example: 14,
    description: 'Documented slots with refused, missed, held, cancelled, or other non-given codes',
  })
  notGiven!: number;

  @ApiProperty({
    example: 76.3,
    nullable: true,
    description:
      'MAR completion % = documented ÷ (documented + stillOpen) × 100 (one decimal). Documentation completeness, not % physically given.',
  })
  marCompletionPercent!: number | null;

  @ApiProperty({
    example: 6,
    description: 'PRN administrations recorded in the completion window (separate from scheduled completion)',
  })
  prnAdministered!: number;

  @ApiProperty({
    example: 44,
    deprecated: true,
    description: 'Deprecated alias for stillOpen',
  })
  due!: number;

  @ApiProperty({
    example: 142,
    deprecated: true,
    description: 'Deprecated alias for documented',
  })
  recorded!: number;

  @ApiProperty({
    example: 76.3,
    nullable: true,
    deprecated: true,
    description: 'Deprecated alias for marCompletionPercent',
  })
  compliancePercent!: number | null;
}

export class MarChartMedicationRowDto {
  @ApiProperty()
  medicationId!: string;

  @ApiPropertyOptional({ nullable: true })
  scheduleId!: string | null;

  @ApiProperty({ example: 'Atorvastatin 20mg' })
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true })
  packName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiPropertyOptional({ nullable: true })
  strength!: string | null;

  @ApiPropertyOptional({ nullable: true })
  routeName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  type!: string | null;

  @ApiPropertyOptional({ nullable: true })
  frequency!: string | null;

  @ApiProperty({
    enum: ['daily', 'weekly', 'specific', 'prn', 'monthly', 'interval'],
  })
  scheduleType!: 'daily' | 'weekly' | 'specific' | 'prn' | 'monthly' | 'interval';

  @ApiProperty({ example: 'Morning' })
  timeSlot!: string;

  @ApiPropertyOptional({ nullable: true, example: '08:00' })
  dueTime!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '07:00' })
  roundWindowStart!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '10:00' })
  roundWindowEnd!: string | null;

  @ApiPropertyOptional({ nullable: true })
  startDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  endDate!: string | null;

  @ApiProperty({ type: [MarChartCellDto] })
  days!: MarChartCellDto[];
}

export class MedicationRegularChartResponseDto {
  @ApiProperty({ example: '2026-05' })
  month!: string;

  @ApiProperty({ example: 31 })
  lastDay!: number;

  @ApiPropertyOptional({ example: '2026-05-01' })
  periodStart?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  periodEnd?: string;

  @ApiPropertyOptional({ example: 'May 2026' })
  periodLabel?: string;

  @ApiPropertyOptional({ type: [String], example: ['2026-05-01', '2026-05-02'] })
  dayDates?: string[];

  @ApiPropertyOptional({ example: 9 })
  medicationCount?: number;

  @ApiPropertyOptional({ example: 24, description: 'Schedule rows (medication × time slot)' })
  scheduleRowCount?: number;

  @ApiProperty({ type: [MarChartLegendItemDto] })
  legend!: MarChartLegendItemDto[];

  @ApiProperty({ type: MarChartDaySummaryDto })
  summary!: MarChartDaySummaryDto;

  @ApiProperty({ type: MarMonthStatsDto })
  monthStats!: MarMonthStatsDto;

  @ApiProperty({ type: [MarChartMedicationRowDto] })
  medications!: MarChartMedicationRowDto[];
}
