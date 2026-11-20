import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EvidencePackQueryDto } from './cqc-evidence-pack.dto';

// As the app's ValidationPipe reads query strings (implicit conversion on).
const parse = (query: Record<string, string>) =>
  plainToInstance(EvidencePackQueryDto, query, {
    enableImplicitConversion: true,
  });

describe('EvidencePackQueryDto', () => {
  it('reads "false" as false and "true" as true, and leaves a missing flag unset', () => {
    const dto = parse({
      format: 'zip',
      includeFiles: 'false',
      includePolicies: 'true',
    });
    expect(dto.includeFiles).toBe(false);
    expect(dto.includePolicies).toBe(true);
    expect(parse({ format: 'zip', includeFiles: '0' }).includeFiles).toBe(
      false,
    );
    expect(parse({ format: 'pdf' }).includePolicies).toBeUndefined();
    expect(validateSync(dto)).toEqual([]);
  });

  it('accepts only pdf or zip', () => {
    expect(validateSync(parse({ format: 'docx' })).length).toBeGreaterThan(0);
  });
});
