import { buildAzureCostConfig } from './azure-cost.config';
import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_TOKEN_SECRET: 'a',
  JWT_REFRESH_TOKEN_SECRET: 'b',
};
const SUB = '0142b441-6200-4c01-924e-a1f2ffbcfa51';

describe('Azure cost config', () => {
  it('defaults to disabled with the production resource groups', () => {
    expect(buildAzureCostConfig({})).toEqual({
      enabled: false,
      subscriptionId: '',
      scope: '',
      resourceGroups: ['rg-careflow-prod', 'rg-careflow-prod-cae-infra'],
      region: 'uksouth',
      currency: 'GBP',
    });
  });

  it('derives the scope from the subscription and normalises lists', () => {
    const c = buildAzureCostConfig({
      AZURE_COST_ENABLED: 'TRUE',
      AZURE_COST_SUBSCRIPTION_ID: SUB,
      AZURE_COST_RESOURCE_GROUPS: ' RG-A , rg-b ,',
      AZURE_COST_CURRENCY: 'gbp',
    });
    expect(c.enabled).toBe(true);
    expect(c.scope).toBe(`/subscriptions/${SUB}`);
    expect(c.resourceGroups).toEqual(['rg-a', 'rg-b']);
    expect(c.currency).toBe('GBP');
  });

  it('env validation requires a subscription GUID when enabled', () => {
    expect(() => validateEnv({ ...base, AZURE_COST_ENABLED: 'true' })).toThrow(
      /AZURE_COST_SUBSCRIPTION_ID/,
    );
    expect(() =>
      validateEnv({
        ...base,
        AZURE_COST_ENABLED: 'true',
        AZURE_COST_SUBSCRIPTION_ID: SUB,
      }),
    ).not.toThrow();
    expect(() => validateEnv({ ...base })).not.toThrow();
    expect(() => validateEnv({ ...base, AZURE_COST_ENABLED: 'yes' })).toThrow(
      /AZURE_COST_ENABLED/,
    );
    expect(() => validateEnv({ ...base, AZURE_COST_SCOPE: '/bad' })).toThrow(
      /AZURE_COST_SCOPE/,
    );
  });
});
