import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DevToolsGuard } from './dev-tools.guard';

function guardWith(values: Record<string, unknown>): DevToolsGuard {
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new DevToolsGuard(config);
}

describe('DevToolsGuard', () => {
  it('allows non-production environments', () => {
    expect(guardWith({ 'app.nodeEnv': 'development', 'app.enableDevTools': false }).canActivate()).toBe(true);
    expect(guardWith({ 'app.nodeEnv': 'test', 'app.enableDevTools': false }).canActivate()).toBe(true);
  });

  it('blocks production when ENABLE_DEV_TOOLS is not set (404, as if the route does not exist)', () => {
    expect(() =>
      guardWith({ 'app.nodeEnv': 'production', 'app.enableDevTools': false }).canActivate(),
    ).toThrow(NotFoundException);
  });

  it('allows production only when ENABLE_DEV_TOOLS=true', () => {
    expect(guardWith({ 'app.nodeEnv': 'production', 'app.enableDevTools': true }).canActivate()).toBe(true);
  });

  it('defaults to development (allowed) when nodeEnv is unset', () => {
    expect(guardWith({}).canActivate()).toBe(true);
  });
});
