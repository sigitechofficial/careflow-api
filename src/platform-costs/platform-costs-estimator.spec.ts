import {
  ACA_FREE_VCPU_SECONDS,
  BASELINE_INPUT,
  HOURS_PER_MONTH,
  PriceBook,
  applyFreeGrant,
  estimateMonthly,
  tieredCost,
  unitMultiplier,
  type PriceRow,
} from './platform-costs-estimator';

const UKS = 'uksouth';
const PG = 'Azure Database for PostgreSQL';
const BURST =
  'Azure Database for PostgreSQL Flexible Server Burstable BS Series Compute';
const p = (
  serviceName: string,
  productName: string,
  skuName: string,
  meterName: string,
  unitOfMeasure: string,
  retailPrice: number,
  armRegionName = UKS,
  tierMinimumUnits = 0,
): PriceRow => ({
  serviceName,
  productName,
  skuName,
  meterName,
  unitOfMeasure,
  retailPrice,
  armRegionName,
  tierMinimumUnits,
});

/** GBP list prices observed from the Retail Prices API (UK South) on 2026-10-01. */
const CATALOGUE: PriceRow[] = [
  p(PG, BURST, 'B1MS', 'B1MS', '1 Hour', 0.0143),
  p(PG, BURST, 'B2S', 'B2S', '1 Hour', 0.0574),
  p(PG, BURST, 'B2ms', 'B2ms vCore', '1 Hour', 0.1147),
  p(
    PG,
    'Azure Database for PostgreSQL Flexible Server General Purpose Ddsv5 Series Compute',
    'vCore',
    'vCore',
    '1 Hour',
    0.0777,
  ),
  p(
    PG,
    'Azure Database for PostgreSQL Flex Server Storage',
    'Storage',
    'Storage Data Stored',
    '1 GB/Month',
    0.1004,
  ),
  p(
    PG,
    'Azure Database for PostgreSQL Flexible Server Backup Storage',
    'Backup Storage LRS',
    'Backup Storage LRS Data Stored',
    '1 GB/Month',
    0.0755,
  ),
  p(
    'Azure Container Apps',
    'Azure Container Apps',
    'Standard',
    'Standard vCPU Active Usage',
    '1 Second',
    0.000026,
  ),
  p(
    'Azure Container Apps',
    'Azure Container Apps',
    'Standard',
    'Standard vCPU Idle Usage',
    '1 Second',
    0.000003,
  ),
  p(
    'Azure Container Apps',
    'Azure Container Apps',
    'Standard',
    'Standard Memory Active Usage',
    '1 GiB Second',
    0.000003,
  ),
  p(
    'Azure Container Apps',
    'Azure Container Apps',
    'Standard',
    'Standard Memory Idle Usage',
    '1 GiB Second',
    0.000003,
  ),
  p(
    'Azure Container Apps',
    'Azure Container Apps',
    'Standard',
    'Standard Requests',
    '1M',
    0.301898,
  ),
  p(
    'Storage',
    'Files v2',
    'Standard GRS',
    'GRS Data Stored',
    '1 GB/Month',
    0.094343,
  ),
  p(
    'Storage',
    'Files v2',
    'Standard GRS',
    'GRS Write Operations',
    '10K',
    0.022642,
  ),
  p('Storage', 'Files v2', 'Standard GRS', 'Read Operations', '10K', 0.001132),
  p('Storage', 'Files v2', 'Standard GRS', 'List Operations', '10K', 0.011321),
  p(
    'Storage',
    'Files v2',
    'Standard GRS',
    'Protocol Operations',
    '10K',
    0.001132,
  ),
  p(
    'Container Registry',
    'Container Registry',
    'Basic',
    'Basic Registry Unit',
    '1/Day',
    0.125741,
  ),
  p(
    'Azure App Service',
    'Static Web Apps',
    'Standard',
    'Standard App',
    '1/Month',
    6.792709,
    'westeurope',
  ),
  p(
    'Log Analytics',
    'Log Analytics',
    'Analytics Logs',
    'Analytics Logs Data Ingestion',
    '1 GB',
    0,
    UKS,
    0,
  ),
  p(
    'Log Analytics',
    'Log Analytics',
    'Analytics Logs',
    'Analytics Logs Data Ingestion',
    '1 GB',
    2.173667,
    UKS,
    5,
  ),
  p(
    'Virtual Network',
    'Virtual Network Private Link',
    'Standard',
    'Standard Private Endpoint',
    '1 Hour',
    0.007547,
    'Global',
  ),
  p(
    'Virtual Network',
    'Virtual Network Private Link',
    'Standard',
    'Standard Data Processed - Ingress',
    '1 GB',
    0.007547,
    'Global',
  ),
  p(
    'Virtual Network',
    'Virtual Network Private Link',
    'Standard',
    'Standard Data Processed - Egress',
    '1 GB',
    0.007547,
    'Global',
  ),
  p('Email', 'Email', 'Basic', 'Basic Sent Email', '1', 0.000189),
  p('Email', 'Email', 'Basic', 'Basic Data Transferred', '1 MB', 0.000091),
  p('Key Vault', 'Key Vault', 'Standard', 'Operations', '10K', 0.022642),
  p(
    'Virtual Network',
    'IP Addresses',
    'Standard',
    'Standard IPv4 Static Public IP',
    '1 Hour',
    0.003774,
  ),
];

const line = (res: ReturnType<typeof estimateMonthly>, key: string) => {
  const l = res.lines.find((x) => x.key === key);
  if (!l) throw new Error(`missing line ${key}`);
  return l;
};

describe('estimator maths', () => {
  it('parses unit-of-measure multipliers', () => {
    expect(unitMultiplier('1 Hour')).toBe(1);
    expect(unitMultiplier('10K')).toBe(10_000);
    expect(unitMultiplier('1M')).toBe(1_000_000);
    expect(unitMultiplier('1 GB/Month')).toBe(1);
    expect(unitMultiplier('100 Hours')).toBe(100);
    expect(unitMultiplier('1 MB')).toBe(1);
    expect(unitMultiplier('1/Day')).toBe(1);
  });

  it('computes graduated tier costs', () => {
    const tiers = [
      { min: 0, price: 0 },
      { min: 5, price: 2 },
    ];
    expect(tieredCost(3, tiers)).toBe(0);
    expect(tieredCost(15, tiers)).toBe(20);
    expect(tieredCost(0, tiers)).toBe(0);
    expect(
      tieredCost(10, [
        { min: 0, price: 1 },
        { min: 4, price: 0.5 },
      ]),
    ).toBe(4 + 3);
  });

  it('applies the free grant to active seconds first, then idle', () => {
    expect(applyFreeGrant(100, 1000, 300)).toEqual({
      activeBilled: 0,
      idleBilled: 800,
    });
    expect(applyFreeGrant(500, 1000, 300)).toEqual({
      activeBilled: 200,
      idleBilled: 1000,
    });
  });

  it('prices the baseline architecture line by line', () => {
    const res = estimateMonthly(BASELINE_INPUT, new PriceBook(CATALOGUE, UKS));
    expect(res.missingMeters).toEqual([]);
    expect(line(res, 'db_compute').monthly).toBe(10.44); // 0.0143 × 730
    expect(line(res, 'db_storage').monthly).toBe(3.21); // 32 × 0.1004
    expect(line(res, 'db_backup').monthly).toBe(2.42); // 32 × 0.0755
    // vCPU: 1,314,000 s; 20 % active = 262,800 − 180,000 free = 82,800 × 0.000026 = 2.15
    //       idle 1,051,200 × 0.000003 = 3.15 → 5.31
    expect(line(res, 'aca_vcpu').monthly).toBe(5.31);
    // memory: 2,628,000 GiB-s − 360,000 free = 2,268,000 × 0.000003 = 6.80
    expect(line(res, 'aca_memory').monthly).toBe(6.8);
    expect(line(res, 'aca_requests').monthly).toBe(0);
    expect(line(res, 'acr').monthly).toBe(3.82); // 0.125741 × 30.4167
    expect(line(res, 'swa').monthly).toBe(6.79);
    // 0.5 GB × 30.4167 = 15.21 GB; (15.21 − 5) × 2.173667 = 22.19
    expect(line(res, 'log_analytics').monthly).toBe(22.19);
    expect(line(res, 'private_endpoints').monthly).toBe(0);
    expect(line(res, 'email').monthly).toBe(0.39); // 2000 × 0.000189 + 100 MB × 0.000091
    expect(line(res, 'key_vault').monthly).toBe(0.23);
    expect(line(res, 'public_ip').monthly).toBe(2.76);
    const sum = res.lines.reduce((a, l) => a + l.monthly, 0);
    expect(Math.abs(res.monthlyTotal - sum)).toBeLessThan(0.05);
    expect(res.monthlyTotal).toBeGreaterThan(40);
    expect(res.monthlyTotal).toBeLessThan(90);
    expect(res.assumptions.join(' ')).toContain('free grant');
  });

  it('doubles database compute and storage with high availability', () => {
    const book = () => new PriceBook(CATALOGUE, UKS);
    const base = estimateMonthly(
      { ...BASELINE_INPUT, dbSku: 'D2ds_v5' },
      book(),
    );
    const ha = estimateMonthly(
      { ...BASELINE_INPUT, dbSku: 'D2ds_v5', dbHighAvailability: true },
      book(),
    );
    expect(line(ha, 'db_compute').quantity).toBe(HOURS_PER_MONTH * 2);
    expect(line(ha, 'db_compute').monthly).toBeCloseTo(
      line(base, 'db_compute').monthly * 2,
      1,
    );
    expect(line(ha, 'db_storage').monthly).toBeCloseTo(
      line(base, 'db_storage').monthly * 2,
      1,
    );
    expect(line(ha, 'db_backup').monthly).toBe(line(base, 'db_backup').monthly);
  });

  it('derives D2ds_v5 from the per-vCore meter when the 2-vCore SKU row is absent', () => {
    const res = estimateMonthly(
      { ...BASELINE_INPUT, dbSku: 'D2ds_v5' },
      new PriceBook(CATALOGUE, UKS),
    );
    expect(line(res, 'db_compute').monthly).toBe(113.44); // 0.0777 × 2 × 730
    expect(res.missingMeters).toEqual([]);
  });

  it('warns that Burstable servers cannot run HA', () => {
    const res = estimateMonthly(
      { ...BASELINE_INPUT, dbHighAvailability: true },
      new PriceBook(CATALOGUE, UKS),
    );
    expect(res.assumptions.some((a) => a.includes('Burstable'))).toBe(true);
  });

  it('prices private endpoints per hour plus processed data', () => {
    const res = estimateMonthly(
      { ...BASELINE_INPUT, privateEndpoints: 2 },
      new PriceBook(CATALOGUE, UKS),
    );
    // 2 × 730 × 0.007547 + 20 GB × 0.007547
    expect(line(res, 'private_endpoints').monthly).toBe(11.17);
  });

  it('scales Container Apps with replicas beyond the free grant', () => {
    const one = estimateMonthly(BASELINE_INPUT, new PriceBook(CATALOGUE, UKS));
    const two = estimateMonthly(
      { ...BASELINE_INPUT, apiReplicas: 2 },
      new PriceBook(CATALOGUE, UKS),
    );
    expect(line(two, 'aca_vcpu').quantity).toBe(
      2 * line(one, 'aca_vcpu').quantity,
    );
    expect(line(two, 'aca_vcpu').monthly).toBeGreaterThan(
      line(one, 'aca_vcpu').monthly * 2,
    );
    expect(ACA_FREE_VCPU_SECONDS).toBe(180_000);
  });

  it('reports missing meters and counts them as zero', () => {
    const res = estimateMonthly(BASELINE_INPUT, new PriceBook([], UKS));
    expect(res.monthlyTotal).toBe(0);
    expect(res.missingMeters).toContain('pgB1ms');
    expect(res.assumptions.some((a) => a.includes('run a price sync'))).toBe(
      true,
    );
    expect(line(res, 'db_compute').unitPrice).toBeNull();
  });
});
