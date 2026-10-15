import { registerAs } from '@nestjs/config';

/**
 * Azure Pricing (platform costs). Strictly read-only towards Azure:
 * Cost Management query/forecast, Consumption budgets, Advisor, public Retail Prices.
 * Auth: DefaultAzureCredential — the API's managed identity on Azure (AZURE_CLIENT_ID),
 * the developer's `az login` locally. No secret.
 */
export const DEFAULT_AZURE_COST_RESOURCE_GROUPS = [
  'rg-careflow-prod',
  'rg-careflow-prod-cae-infra',
];

export type AzureCostConfig = {
  enabled: boolean;
  subscriptionId: string;
  scope: string;
  resourceGroups: string[];
  region: string;
  currency: string;
};

export function buildAzureCostConfig(
  env: NodeJS.ProcessEnv = process.env,
): AzureCostConfig {
  const subscriptionId = (env.AZURE_COST_SUBSCRIPTION_ID ?? '').trim();
  const scopeRaw = (env.AZURE_COST_SCOPE ?? '').trim();
  const scope = (
    scopeRaw || (subscriptionId ? `/subscriptions/${subscriptionId}` : '')
  ).replace(/\/+$/, '');
  const rgRaw = (env.AZURE_COST_RESOURCE_GROUPS ?? '').trim();
  const resourceGroups = (
    rgRaw ? rgRaw.split(',') : DEFAULT_AZURE_COST_RESOURCE_GROUPS
  )
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    enabled: (env.AZURE_COST_ENABLED ?? '').trim().toLowerCase() === 'true',
    subscriptionId,
    scope,
    resourceGroups,
    region: (env.AZURE_COST_REGION ?? '').trim().toLowerCase() || 'uksouth',
    currency: (env.AZURE_COST_CURRENCY ?? '').trim().toUpperCase() || 'GBP',
  };
}

export const azureCostConfig = registerAs('azureCost', () =>
  buildAzureCostConfig(),
);
