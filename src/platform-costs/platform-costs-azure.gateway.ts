import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AzureCostConfig } from '../config/azure-cost.config';
import { buildAzureCostConfig } from '../config/azure-cost.config';
import {
  AzureArmClient,
  DefaultArmTokenProvider,
} from './azure/azure-arm.client';
import { AzureCostManagementApi } from './azure/azure-cost-management.api';
import { AzureRetailPricesClient } from './azure/azure-retail-prices.client';

/**
 * Single entry point to Azure for the feature (read-only). Lazily builds the clients so the
 * app boots without Azure credentials when AZURE_COST_ENABLED=false.
 */
@Injectable()
export class PlatformCostsAzureGateway {
  private costApi: AzureCostManagementApi | null = null;
  private retail: AzureRetailPricesClient | null = null;

  constructor(private readonly config: ConfigService) {}

  get settings(): AzureCostConfig {
    return (
      this.config.get<AzureCostConfig>('azureCost') ?? buildAzureCostConfig()
    );
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  costManagement(): AzureCostManagementApi {
    if (!this.costApi) {
      const arm = new AzureArmClient({
        tokenProvider: new DefaultArmTokenProvider(),
      });
      this.costApi = new AzureCostManagementApi(arm);
    }
    return this.costApi;
  }

  retailPrices(): AzureRetailPricesClient {
    if (!this.retail) this.retail = new AzureRetailPricesClient();
    return this.retail;
  }

  /** Subscription id from config, or parsed from the scope. */
  subscriptionId(): string {
    const s = this.settings;
    if (s.subscriptionId) return s.subscriptionId;
    const m = s.scope.match(/\/subscriptions\/([^/]+)/i);
    return m ? m[1] : '';
  }
}
