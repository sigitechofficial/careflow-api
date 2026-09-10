import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EmployeeComplianceReportQueryDto } from './employee-compliance-report-query.dto';

function parseQuery(plain: Record<string, unknown>) {
  return plainToInstance(EmployeeComplianceReportQueryDto, plain, {
    enableImplicitConversion: true,
  });
}

describe('EmployeeComplianceReportQueryDto', () => {
  it('does not coerce needsImmigrationRtw=false to true under implicit conversion', () => {
    const dto = parseQuery({ needsImmigrationRtw: 'false' });
    expect(dto.needsImmigrationRtw).toBe(false);
    expect(validateSync(dto)).toEqual([]);
  });

  it('parses needsImmigrationRtw=true', () => {
    const dto = parseQuery({ needsImmigrationRtw: 'true' });
    expect(dto.needsImmigrationRtw).toBe(true);
    expect(validateSync(dto)).toEqual([]);
  });

  it('leaves needsImmigrationRtw unset when omitted', () => {
    const dto = parseQuery({});
    expect(dto.needsImmigrationRtw).toBeUndefined();
  });

  it('does not coerce issuesOnly=false to true', () => {
    const dto = parseQuery({ issuesOnly: 'false' });
    expect(dto.issuesOnly).toBe(false);
    expect(validateSync(dto)).toEqual([]);
  });
});
