import type { FetchLike } from './azure-arm.client';
import { AzureApiError } from './azure-arm.client';

export const RETAIL_PRICES_URL = 'https://prices.azure.com/api/retail/prices';
/** The preview api-version returns unrounded unit prices (GA rounds tiny per-second prices to 0). */
export const RETAIL_PRICES_API_VERSION = '2023-01-01-preview';

export type RetailPriceItem = {
  currencyCode: string;
  tierMinimumUnits: number;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location?: string;
  effectiveStartDate?: string;
  meterId: string;
  meterName: string;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  serviceName: string;
  serviceId?: string;
  serviceFamily?: string;
  unitOfMeasure: string;
  type: string;
  isPrimaryMeterRegion?: boolean;
  armSkuName?: string;
};

type RetailPage = { Items?: RetailPriceItem[]; NextPageLink?: string | null };

/** Public, unauthenticated Azure Retail Prices API with NextPageLink pagination. */
export class AzureRetailPricesClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    opts: {
      fetchImpl?: FetchLike;
      timeoutMs?: number;
      maxPages?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxPages = opts.maxPages ?? 50;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly sleep: (ms: number) => Promise<void>;

  buildUrl(currency: string, filter: string): string {
    const params = new URLSearchParams();
    params.set('api-version', RETAIL_PRICES_API_VERSION);
    params.set('currencyCode', `'${currency}'`);
    params.set('$filter', filter);
    return `${RETAIL_PRICES_URL}?${params.toString()}`;
  }

  async fetchAll(currency: string, filter: string): Promise<RetailPriceItem[]> {
    const items: RetailPriceItem[] = [];
    let url: string | null = this.buildUrl(currency, filter);
    let pages = 0;
    while (url) {
      if (pages >= this.maxPages) {
        throw new AzureApiError(
          `Retail prices pagination exceeded ${this.maxPages} pages`,
          0,
        );
      }
      const page = await this.fetchPage(url);
      items.push(...(page.Items ?? []));
      pages += 1;
      url = page.NextPageLink || null;
      if (url && !url.startsWith('https://prices.azure.com/')) {
        throw new AzureApiError(
          'Unexpected retail prices NextPageLink host',
          0,
        );
      }
    }
    return items;
  }

  private async fetchPage(url: string, attempt = 0): Promise<RetailPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.ok) return (await res.json()) as RetailPage;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await this.sleep(1000 * 2 ** attempt);
        return this.fetchPage(url, attempt + 1);
      }
      throw new AzureApiError(
        `Retail prices request failed with HTTP ${res.status}`,
        res.status,
      );
    } catch (err) {
      if (err instanceof AzureApiError) throw err;
      if (attempt < 3) {
        await this.sleep(1000 * 2 ** attempt);
        return this.fetchPage(url, attempt + 1);
      }
      throw new AzureApiError(
        `Retail prices request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * OData filters for the services Careflow runs (Consumption list prices only).
 * Static Web Apps bill from West Europe; Private Link meters are Global.
 */
export function retailPriceFilters(region: string): string[] {
  const r = region.replace(/'/g, '');
  const cons = "priceType eq 'Consumption'";
  return [
    `serviceName eq 'Azure Database for PostgreSQL' and armRegionName eq '${r}' and ${cons} and contains(productName, 'Flex')`,
    `serviceName eq 'Azure Container Apps' and armRegionName eq '${r}' and ${cons}`,
    `serviceName eq 'Container Registry' and armRegionName eq '${r}' and ${cons}`,
    `serviceName eq 'Storage' and armRegionName eq '${r}' and ${cons} and productName eq 'Files v2'`,
    `serviceName eq 'Azure App Service' and productName eq 'Static Web Apps' and ${cons} and (armRegionName eq 'westeurope' or armRegionName eq 'Global')`,
    `serviceName eq 'Log Analytics' and armRegionName eq '${r}' and ${cons}`,
    `serviceName eq 'Azure Monitor' and armRegionName eq '${r}' and ${cons}`,
    `serviceName eq 'Key Vault' and armRegionName eq '${r}' and ${cons} and productName eq 'Key Vault'`,
    `serviceName eq 'Email' and ${cons} and (armRegionName eq '${r}' or armRegionName eq 'Global')`,
    `serviceName eq 'Virtual Network' and productName eq 'Virtual Network Private Link' and ${cons} and armRegionName eq 'Global'`,
    `serviceName eq 'Virtual Network' and productName eq 'IP Addresses' and ${cons} and armRegionName eq '${r}'`,
  ];
}

export function retailPriceKey(i: RetailPriceItem): string {
  return [
    i.meterId,
    i.skuId ?? '',
    i.type,
    i.armRegionName ?? '',
    String(i.tierMinimumUnits ?? 0),
    i.currencyCode,
  ].join('|');
}
