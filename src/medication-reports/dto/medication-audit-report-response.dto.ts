import { ApiProperty } from '@nestjs/swagger';

export class MedicationAuditReportMetaDto {
  @ApiProperty({ example: 42 })
  auditLogCount!: number;

  @ApiProperty({ example: 128 })
  eventCount!: number;
}

export class MedicationAuditReportDataDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Audit log entries' })
  auditLogs!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Administration events in range' })
  administrationEvents!: Record<string, unknown>[];
}

export class MedicationAuditReportResponseDto {
  @ApiProperty({ type: MedicationAuditReportDataDto })
  data!: MedicationAuditReportDataDto;

  @ApiProperty({ type: MedicationAuditReportMetaDto })
  meta!: MedicationAuditReportMetaDto;
}
