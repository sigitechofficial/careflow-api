import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IaQaDemoGuard } from './ia-qa-demo.guard';

function guardWith(values: Record<string, unknown>): IaQaDemoGuard {
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new IaQaDemoGuard(config);
}

describe('IaQaDemoGuard', () => {
  it('allows non-production environments without ENABLE_IA_QA_DEMO', () => {
    expect(
      guardWith({ 'app.nodeEnv': 'development', 'app.enableIaQaDemo': false }).canActivate(),
    ).toBe(true);
    expect(guardWith({ 'app.nodeEnv': 'test', 'app.enableIaQaDemo': false }).canActivate()).toBe(
      true,
    );
  });

  it('blocks production when ENABLE_IA_QA_DEMO is not set (404, as if the route does not exist)', () => {
    expect(() =>
      guardWith({ 'app.nodeEnv': 'production', 'app.enableIaQaDemo': false }).canActivate(),
    ).toThrow(NotFoundException);
  });

  it('allows production only when ENABLE_IA_QA_DEMO=true', () => {
    expect(
      guardWith({ 'app.nodeEnv': 'production', 'app.enableIaQaDemo': true }).canActivate(),
    ).toBe(true);
  });

  it('does not honour ENABLE_DEV_TOOLS — generate-ia-section stays unavailable without ENABLE_IA_QA_DEMO', () => {
    expect(() =>
      guardWith({
        'app.nodeEnv': 'production',
        'app.enableIaQaDemo': false,
        'app.enableDevTools': true,
      }).canActivate(),
    ).toThrow(NotFoundException);
  });

  it('defaults to development (allowed) when nodeEnv is unset', () => {
    expect(guardWith({}).canActivate()).toBe(true);
  });
});
