import {
  AzureApiError,
  AzureArmClient,
  retryAfterMs,
} from './azure-arm.client';
import {
  AzureRetailPricesClient,
  retailPriceFilters,
  retailPriceKey,
} from './azure-retail-prices.client';
import {
  parseAdvisor,
  parseBudgets,
  parseCostQueryRows,
  parseForecastRows,
  usageDateToIso,
} from './azure-cost-management.api';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const tokenProvider = { getToken: jest.fn(async () => 'test-token') };

describe('AzureArmClient', () => {
  it('reads the largest Cost Management retry-after header', () => {
    const h = new Headers({
      'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '3',
      'x-ms-ratelimit-microsoft.costmanagement-entity-retry-after': '7',
      'retry-after': '1',
    });
    expect(retryAfterMs(h)).toBe(7000);
    expect(retryAfterMs(new Headers())).toBeNull();
  });

  it('retries 429 honouring retry-after, then succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          429,
          { error: { code: 'TooManyRequests' } },
          {
            'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '12',
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, { properties: { rows: [] } }));
    const sleep = jest.fn(async () => undefined);
    const client = new AzureArmClient({ tokenProvider, fetchImpl, sleep });
    const res = await client.postQuery(
      '/subscriptions/x/providers/Microsoft.CostManagement/query',
      { a: 1 },
    );
    expect(res).toEqual({ properties: { rows: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(12_000);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://management.azure.com/subscriptions/x/providers/Microsoft.CostManagement/query',
    );
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('gives up after 3 retries and throws AzureApiError with the status', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(429, {
        error: { code: 'TooManyRequests', message: 'slow down' },
      }),
    );
    const sleep = jest.fn(async () => undefined);
    const client = new AzureArmClient({ tokenProvider, fetchImpl, sleep });
    await expect(client.get('/subscriptions/x')).rejects.toMatchObject({
      name: 'AzureApiError',
      status: 429,
      code: 'TooManyRequests',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('caps a huge retry-after hint', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '3600' }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const sleep = jest.fn(async () => undefined);
    await new AzureArmClient({
      tokenProvider,
      fetchImpl,
      sleep,
      maxRetryWaitMs: 60_000,
    }).get('/x');
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('retries 5xx with backoff but not 4xx', async () => {
    const sleep = jest.fn(async () => undefined);
    const f5 = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    await expect(
      new AzureArmClient({ tokenProvider, fetchImpl: f5, sleep }).get('/x'),
    ).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(1000);

    const f4 = jest.fn(async () =>
      jsonResponse(403, {
        error: { code: 'AuthorizationFailed', message: 'no access' },
      }),
    );
    const err = await new AzureArmClient({
      tokenProvider,
      fetchImpl: f4,
      sleep,
    })
      .get('/x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(AzureApiError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('no access');
    expect(err.message).not.toContain('test-token');
    expect(f4).toHaveBeenCalledTimes(1);
  });

  it('retries network errors / timeouts', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = jest.fn().mockRejectedValue(abort);
    const sleep = jest.fn(async () => undefined);
    const err = await new AzureArmClient({
      tokenProvider,
      fetchImpl,
      sleep,
      timeoutMs: 5,
    })
      .get('/x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(AzureApiError);
    expect(err.message).toContain('timed out');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('refuses absolute URLs outside management.azure.com', async () => {
    const fetchImpl = jest.fn();
    await expect(
      new AzureArmClient({ tokenProvider, fetchImpl }).get(
        'https://evil.example.com/x',
      ),
    ).rejects.toBeInstanceOf(AzureApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('AzureRetailPricesClient', () => {
  it('follows NextPageLink and uses the precise api-version + currency', async () => {
    const item = (meterId: string) => ({
      meterId,
      skuId: 's',
      type: 'Consumption',
      armRegionName: 'uksouth',
      tierMinimumUnits: 0,
      currencyCode: 'GBP',
      retailPrice: 1,
      unitPrice: 1,
      meterName: 'm',
      productName: 'p',
      skuName: 'k',
      serviceName: 'svc',
      unitOfMeasure: '1 Hour',
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          Items: [item('a')],
          NextPageLink: 'https://prices.azure.com/api/retail/prices?$skip=100',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { Items: [item('b')], NextPageLink: null }),
      );
    const client = new AzureRetailPricesClient({
      fetchImpl,
      sleep: async () => undefined,
    });
    const items = await client.fetchAll('GBP', "serviceName eq 'svc'");
    expect(items.map((i) => i.meterId)).toEqual(['a', 'b']);
    const firstUrl = decodeURIComponent(fetchImpl.mock.calls[0][0]);
    expect(firstUrl).toContain('api-version=2023-01-01-preview');
    expect(firstUrl).toContain("currencyCode='GBP'");
    expect(retailPriceKey(items[0] as never)).toBe(
      'a|s|Consumption|uksouth|0|GBP',
    );
  });

  it('rejects a NextPageLink to another host', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        Items: [],
        NextPageLink: 'https://evil.example.com/next',
      }),
    );
    await expect(
      new AzureRetailPricesClient({ fetchImpl }).fetchAll('GBP', 'x'),
    ).rejects.toBeInstanceOf(AzureApiError);
  });

  it('builds filters for every service in use', () => {
    const f = retailPriceFilters('uksouth').join('\n');
    for (const svc of [
      'Azure Database for PostgreSQL',
      'Azure Container Apps',
      'Container Registry',
      'Files v2',
      'Static Web Apps',
      'Log Analytics',
      'Key Vault',
      "'Email'",
      'Private Link',
      'IP Addresses',
    ]) {
      expect(f).toContain(svc);
    }
    expect(f).toContain("armRegionName eq 'westeurope'");
  });
});

describe('Cost Management parsers', () => {
  it('converts UsageDate formats', () => {
    expect(usageDateToIso(20260929)).toBe('2026-09-29');
    expect(usageDateToIso('2026-09-29T00:00:00')).toBe('2026-09-29');
    expect(usageDateToIso('bad')).toBeNull();
  });

  it('filters resource groups case-insensitively and merges duplicate keys', () => {
    const rows = parseCostQueryRows(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'ResourceGroupName' },
            { name: 'ServiceName' },
            { name: 'ResourceId' },
            { name: 'MeterCategory' },
            { name: 'Currency' },
          ],
          rows: [
            [
              0.1,
              20260929,
              'RG-CAREFLOW-PROD',
              'Storage',
              '/SUBSCRIPTIONS/X/A',
              'Storage',
              'GBP',
            ],
            [
              0.2,
              20260929,
              'rg-careflow-prod',
              'Storage',
              '/subscriptions/x/a',
              'Storage',
              'GBP',
            ],
            [
              5,
              20260929,
              'rg-other',
              'Storage',
              '/subscriptions/x/b',
              'Storage',
              'GBP',
            ],
          ],
        },
      },
      ['rg-careflow-prod'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-09-29',
      resourceGroup: 'rg-careflow-prod',
      resourceId: '/subscriptions/x/a',
    });
    expect(rows[0].cost).toBeCloseTo(0.3);
  });

  it('sums actual + forecast rows', () => {
    const f = parseForecastRows({
      properties: {
        columns: [
          { name: 'Cost' },
          { name: 'UsageDate' },
          { name: 'CostStatus' },
          { name: 'Currency' },
        ],
        rows: [
          [1, 20261001, 'Actual', 'GBP'],
          [2, 20261002, 'Forecast', 'GBP'],
        ],
      },
    });
    expect(f).toEqual({
      actualToDate: 1,
      forecastTotal: 3,
      hasForecastRows: true,
      currency: 'GBP',
    });
  });

  it('parses budgets without keeping contact e-mails', () => {
    const [b] = parseBudgets({
      value: [
        {
          id: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Consumption/budgets/budget-careflow-prod',
          name: 'budget-careflow-prod',
          properties: {
            amount: 100,
            timeGrain: 'Monthly',
            currentSpend: { amount: 12.5, unit: 'GBP' },
            notifications: {
              a: {
                enabled: true,
                threshold: 70,
                thresholdType: 'Actual',
                contactEmails: ['x@y.z'],
              } as never,
              b: { enabled: true, threshold: 50, thresholdType: 'Actual' },
              c: { enabled: true, threshold: 100, thresholdType: 'Forecasted' },
            },
          },
        },
      ],
    });
    expect(b).toMatchObject({
      name: 'budget-careflow-prod',
      amount: 100,
      currentSpend: 12.5,
      currency: 'GBP',
    });
    expect(b.thresholds.map((t) => `${t.percent}/${t.type}`)).toEqual([
      '50/Actual',
      '70/Actual',
      '100/Forecasted',
    ]);
    expect(JSON.stringify(b)).not.toContain('x@y.z');
  });

  it('parses Advisor cost recommendations', () => {
    const [r] = parseAdvisor({
      value: [
        {
          name: 'rec-1',
          properties: {
            impact: 'High',
            impactedValue: 'psql-allforcare-prod',
            shortDescription: {
              problem: 'Right-size',
              solution: 'Use a smaller SKU',
            },
            resourceMetadata: { resourceId: '/subscriptions/x/psql' },
            extendedProperties: {
              annualSavingsAmount: '120.5',
              savingsCurrency: 'GBP',
            },
          },
        },
      ],
    });
    expect(r).toEqual({
      recommendationId: 'rec-1',
      impact: 'High',
      problem: 'Right-size',
      solution: 'Use a smaller SKU',
      resourceId: '/subscriptions/x/psql',
      resourceName: 'psql-allforcare-prod',
      annualSavings: 120.5,
      currency: 'GBP',
    });
  });
});
