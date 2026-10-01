import { round2 } from './platform-costs-aggregation.util';

/**
 * Monthly cost estimator built on the stored Azure Retail Prices (list prices, Consumption).
 * Pure functions — the service passes in the catalogue rows.
 */

export const HOURS_PER_MONTH = 730;
export const DAYS_PER_MONTH = HOURS_PER_MONTH / 24; // 30.4167
export const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600; // 2,628,000

/** Container Apps Consumption free grant (per subscription per month). */
export const ACA_FREE_VCPU_SECONDS = 180_000;
export const ACA_FREE_GIB_SECONDS = 360_000;
export const ACA_FREE_REQUESTS = 2_000_000;

/** Usage assumptions that are not inputs of the what-if calculator. */
export const ASSUMED = {
  /** Share of the month a replica is "active" (billed at the active vCPU rate); rest is idle. */
  acaActiveFraction: 0.2,
  acaRequestsPerMonth: 1_000_000,
  filesWriteOpsPerMonth: 100_000,
  filesReadOpsPerMonth: 500_000,
  filesListOpsPerMonth: 20_000,
  filesProtocolOpsPerMonth: 500_000,
  acrStorageIncludedGb: 10,
  privateEndpointGbProcessedPerMonth: 10,
  emailAvgSizeMb: 0.05,
  keyVaultOpsPerMonth: 100_000,
  publicIps: 1,
} as const;

export const DB_SKUS = ['B1ms', 'B2s', 'B2ms', 'D2ds_v5'] as const;
export type DbSku = (typeof DB_SKUS)[number];

export type EstimateInput = {
  apiReplicas: number;
  apiVcpu: number;
  apiMemoryGiB: number;
  dbSku: DbSku;
  dbStorageGiB: number;
  dbHighAvailability: boolean;
  privateEndpoints: number;
  logGbPerDay: number;
  storageGiB: number;
  emailsPerMonth: number;
};

/** Current production architecture (also the what-if form defaults). */
export const BASELINE_INPUT: EstimateInput = {
  apiReplicas: 1,
  apiVcpu: 0.5,
  apiMemoryGiB: 1,
  dbSku: 'B1ms',
  dbStorageGiB: 32,
  dbHighAvailability: false,
  privateEndpoints: 0,
  logGbPerDay: 0.5,
  storageGiB: 100,
  emailsPerMonth: 2000,
};

export type PriceRow = {
  serviceName: string;
  productName: string;
  skuName: string;
  meterName: string;
  unitOfMeasure: string;
  retailPrice: number;
  tierMinimumUnits: number;
  armRegionName: string;
};

export type Tier = { min: number; price: number };

export type EstimateLine = {
  key: string;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  monthly: number;
  note: string;
};

export type EstimateResult = {
  monthlyTotal: number;
  lines: EstimateLine[];
  assumptions: string[];
  missingMeters: string[];
};

/** "1 Hour" → 1, "10K" → 10 000, "1M" → 1 000 000, "1 GB/Month" → 1, "100 Hours" → 100. */
export function unitMultiplier(unitOfMeasure: string): number {
  const m = unitOfMeasure
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([KkMm])?(?![a-zA-Z])/);
  if (!m) return 1;
  const n = Number(m[1]);
  const suffix = (m[2] ?? '').toUpperCase();
  return n * (suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : 1);
}

/** Cost of `quantity` units under graduated tiers (tier.min = first unit the price applies from). */
export function tieredCost(quantity: number, tiers: Tier[]): number {
  if (quantity <= 0 || !tiers.length) return 0;
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  let cost = 0;
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].min;
    const end = i + 1 < sorted.length ? sorted[i + 1].min : Infinity;
    if (quantity <= start) break;
    cost += (Math.min(quantity, end) - start) * sorted[i].price;
  }
  return cost;
}

type MeterSpec = {
  id: string;
  serviceName: string;
  productIncludes?: string;
  productName?: string;
  skuName?: string;
  meterName: string;
  regions: string[];
};

const ci = (a: string | undefined, b: string | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

function meterSpecs(region: string): Record<string, MeterSpec> {
  const pg = 'Azure Database for PostgreSQL';
  return {
    pgB1ms: {
      id: 'pgB1ms',
      serviceName: pg,
      productIncludes: 'Flexible Server Burstable',
      skuName: 'B1ms',
      meterName: 'B1ms',
      regions: [region],
    },
    pgB2s: {
      id: 'pgB2s',
      serviceName: pg,
      productIncludes: 'Flexible Server Burstable',
      skuName: 'B2s',
      meterName: 'B2s',
      regions: [region],
    },
    pgB2ms: {
      id: 'pgB2ms',
      serviceName: pg,
      productIncludes: 'Flexible Server Burstable',
      skuName: 'B2ms',
      meterName: 'B2ms vCore',
      regions: [region],
    },
    pgDdsv5_2: {
      id: 'pgDdsv5_2',
      serviceName: pg,
      productIncludes: 'General Purpose Ddsv5 Series Compute',
      skuName: '2 vCore',
      meterName: 'vCore',
      regions: [region],
    },
    pgDdsv5_1: {
      id: 'pgDdsv5_1',
      serviceName: pg,
      productIncludes: 'General Purpose Ddsv5 Series Compute',
      skuName: 'vCore',
      meterName: 'vCore',
      regions: [region],
    },
    pgStorage: {
      id: 'pgStorage',
      serviceName: pg,
      productIncludes: 'Flex Server Storage',
      skuName: 'Storage',
      meterName: 'Storage Data Stored',
      regions: [region],
    },
    pgBackup: {
      id: 'pgBackup',
      serviceName: pg,
      productIncludes: 'Flexible Server Backup Storage',
      meterName: 'Backup Storage LRS Data Stored',
      regions: [region],
    },
    acaVcpuActive: {
      id: 'acaVcpuActive',
      serviceName: 'Azure Container Apps',
      skuName: 'Standard',
      meterName: 'Standard vCPU Active Usage',
      regions: [region],
    },
    acaVcpuIdle: {
      id: 'acaVcpuIdle',
      serviceName: 'Azure Container Apps',
      skuName: 'Standard',
      meterName: 'Standard vCPU Idle Usage',
      regions: [region],
    },
    acaMemActive: {
      id: 'acaMemActive',
      serviceName: 'Azure Container Apps',
      skuName: 'Standard',
      meterName: 'Standard Memory Active Usage',
      regions: [region],
    },
    acaMemIdle: {
      id: 'acaMemIdle',
      serviceName: 'Azure Container Apps',
      skuName: 'Standard',
      meterName: 'Standard Memory Idle Usage',
      regions: [region],
    },
    acaRequests: {
      id: 'acaRequests',
      serviceName: 'Azure Container Apps',
      skuName: 'Standard',
      meterName: 'Standard Requests',
      regions: [region],
    },
    filesData: {
      id: 'filesData',
      serviceName: 'Storage',
      productName: 'Files v2',
      skuName: 'Standard GRS',
      meterName: 'GRS Data Stored',
      regions: [region],
    },
    filesWrite: {
      id: 'filesWrite',
      serviceName: 'Storage',
      productName: 'Files v2',
      skuName: 'Standard GRS',
      meterName: 'GRS Write Operations',
      regions: [region],
    },
    filesRead: {
      id: 'filesRead',
      serviceName: 'Storage',
      productName: 'Files v2',
      skuName: 'Standard GRS',
      meterName: 'Read Operations',
      regions: [region],
    },
    filesList: {
      id: 'filesList',
      serviceName: 'Storage',
      productName: 'Files v2',
      skuName: 'Standard GRS',
      meterName: 'List Operations',
      regions: [region],
    },
    filesProtocol: {
      id: 'filesProtocol',
      serviceName: 'Storage',
      productName: 'Files v2',
      skuName: 'Standard GRS',
      meterName: 'Protocol Operations',
      regions: [region],
    },
    acrBasic: {
      id: 'acrBasic',
      serviceName: 'Container Registry',
      skuName: 'Basic',
      meterName: 'Basic Registry Unit',
      regions: [region],
    },
    swaStandard: {
      id: 'swaStandard',
      serviceName: 'Azure App Service',
      productName: 'Static Web Apps',
      skuName: 'Standard',
      meterName: 'Standard App',
      regions: ['westeurope', 'global'],
    },
    logIngestion: {
      id: 'logIngestion',
      serviceName: 'Log Analytics',
      skuName: 'Analytics Logs',
      meterName: 'Analytics Logs Data Ingestion',
      regions: [region],
    },
    peHour: {
      id: 'peHour',
      serviceName: 'Virtual Network',
      productName: 'Virtual Network Private Link',
      skuName: 'Standard',
      meterName: 'Standard Private Endpoint',
      regions: ['global'],
    },
    peIngress: {
      id: 'peIngress',
      serviceName: 'Virtual Network',
      productName: 'Virtual Network Private Link',
      skuName: 'Standard',
      meterName: 'Standard Data Processed - Ingress',
      regions: ['global'],
    },
    peEgress: {
      id: 'peEgress',
      serviceName: 'Virtual Network',
      productName: 'Virtual Network Private Link',
      skuName: 'Standard',
      meterName: 'Standard Data Processed - Egress',
      regions: ['global'],
    },
    emailSent: {
      id: 'emailSent',
      serviceName: 'Email',
      skuName: 'Basic',
      meterName: 'Basic Sent Email',
      regions: [region, 'global'],
    },
    emailMb: {
      id: 'emailMb',
      serviceName: 'Email',
      skuName: 'Basic',
      meterName: 'Basic Data Transferred',
      regions: [region, 'global'],
    },
    kvOps: {
      id: 'kvOps',
      serviceName: 'Key Vault',
      productName: 'Key Vault',
      skuName: 'Standard',
      meterName: 'Operations',
      regions: [region],
    },
    publicIp: {
      id: 'publicIp',
      serviceName: 'Virtual Network',
      productName: 'IP Addresses',
      skuName: 'Standard',
      meterName: 'Standard IPv4 Static Public IP',
      regions: [region],
    },
  };
}

/** True when a catalogue row is one of the meters the estimator prices (i.e. part of our architecture). */
export function isEstimatorMeter(
  row: Omit<PriceRow, 'retailPrice' | 'tierMinimumUnits' | 'unitOfMeasure'>,
  region: string,
): boolean {
  return Object.values(meterSpecs(region.toLowerCase())).some(
    (spec) =>
      ci(row.serviceName, spec.serviceName) &&
      ci(row.meterName, spec.meterName) &&
      spec.regions.some((r) => ci(r, row.armRegionName)) &&
      (spec.skuName === undefined || ci(row.skuName, spec.skuName)) &&
      (spec.productName === undefined ||
        ci(row.productName, spec.productName)) &&
      (spec.productIncludes === undefined ||
        row.productName
          .toLowerCase()
          .includes(spec.productIncludes.toLowerCase())),
  );
}

/** Price lookup over the stored catalogue: per-unit tiers for a meter spec (first matching region wins). */
export class PriceBook {
  private readonly specs: Record<string, MeterSpec>;
  readonly missing = new Set<string>();

  constructor(
    private readonly rows: PriceRow[],
    readonly region: string,
  ) {
    this.specs = meterSpecs(region.toLowerCase());
  }

  /** Per single unit (e.g. per hour, per GB, per request) tiers; null when not in the catalogue. */
  tiers(specId: string): Tier[] | null {
    const spec = this.specs[specId];
    if (!spec) return null;
    for (const region of spec.regions) {
      const matches = this.rows.filter(
        (r) =>
          ci(r.serviceName, spec.serviceName) &&
          ci(r.meterName, spec.meterName) &&
          ci(r.armRegionName, region) &&
          (spec.skuName === undefined || ci(r.skuName, spec.skuName)) &&
          (spec.productName === undefined ||
            ci(r.productName, spec.productName)) &&
          (spec.productIncludes === undefined ||
            r.productName
              .toLowerCase()
              .includes(spec.productIncludes.toLowerCase())),
      );
      if (matches.length) {
        const byMin = new Map<number, Tier>();
        for (const r of matches) {
          const unitDiv = unitMultiplier(r.unitOfMeasure);
          const min = r.tierMinimumUnits;
          const prev = byMin.get(min);
          const price = r.retailPrice / unitDiv;
          // tierMinimumUnits count units of measure (e.g. "10K"); convert to single units.
          const minUnits = min * unitDiv;
          if (!prev || price < prev.price)
            byMin.set(min, { min: minUnits, price });
        }
        return [...byMin.values()].sort((a, b) => a.min - b.min);
      }
    }
    this.missing.add(specId);
    return null;
  }

  /** Flat per-unit price of the lowest tier (use `cost()` for graduated meters). */
  unit(specId: string): number | null {
    const t = this.tiers(specId);
    return t ? t[0].price : null;
  }

  cost(specId: string, quantity: number): number {
    const t = this.tiers(specId);
    return t ? tieredCost(quantity, t) : 0;
  }
}

function dbComputeSpec(sku: DbSku): { specId: string; label: string } {
  switch (sku) {
    case 'B2s':
      return { specId: 'pgB2s', label: 'Burstable B2s (2 vCore, 4 GiB)' };
    case 'B2ms':
      return { specId: 'pgB2ms', label: 'Burstable B2ms (2 vCore, 8 GiB)' };
    case 'D2ds_v5':
      return {
        specId: 'pgDdsv5_2',
        label: 'General Purpose D2ds_v5 (2 vCore, 8 GiB)',
      };
    case 'B1ms':
    default:
      return { specId: 'pgB1ms', label: 'Burstable B1ms (1 vCore, 2 GiB)' };
  }
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/** Split a usage quantity across the free grant: active seconds consume the grant first. */
export function applyFreeGrant(active: number, idle: number, free: number) {
  const activeBilled = Math.max(0, active - free);
  const leftover = Math.max(0, free - active);
  const idleBilled = Math.max(0, idle - leftover);
  return { activeBilled, idleBilled };
}

export function estimateMonthly(
  input: EstimateInput,
  book: PriceBook,
): EstimateResult {
  const lines: EstimateLine[] = [];
  const add = (l: Omit<EstimateLine, 'monthly'> & { monthlyRaw: number }) => {
    const { monthlyRaw, ...rest } = l;
    lines.push({ ...rest, monthly: monthlyRaw });
  };

  // ── PostgreSQL Flexible Server ──
  const haFactor = input.dbHighAvailability ? 2 : 1;
  const db = dbComputeSpec(input.dbSku);
  let dbHourly = book.unit(db.specId);
  if (dbHourly === null && input.dbSku === 'D2ds_v5') {
    const perVcore = book.unit('pgDdsv5_1');
    if (perVcore !== null) {
      book.missing.delete('pgDdsv5_2');
      dbHourly = perVcore * 2;
    }
  }
  const dbHours = HOURS_PER_MONTH * haFactor;
  add({
    key: 'db_compute',
    label: `PostgreSQL compute — ${db.label}`,
    quantity: dbHours,
    unit: 'hours',
    unitPrice: dbHourly,
    monthlyRaw: (dbHourly ?? 0) * dbHours,
    note: input.dbHighAvailability
      ? 'High availability: primary + standby compute (×2).'
      : 'Single server, always on (730 h).',
  });
  const storageGb = input.dbStorageGiB * haFactor;
  const pgStorage = book.unit('pgStorage');
  add({
    key: 'db_storage',
    label: 'PostgreSQL storage',
    quantity: storageGb,
    unit: 'GiB-month',
    unitPrice: pgStorage,
    monthlyRaw: (pgStorage ?? 0) * storageGb,
    note: input.dbHighAvailability
      ? `${input.dbStorageGiB} GiB provisioned, billed for primary + standby.`
      : `${input.dbStorageGiB} GiB provisioned.`,
  });
  const pgBackup = book.unit('pgBackup');
  add({
    key: 'db_backup',
    label: 'PostgreSQL geo-redundant backup',
    quantity: input.dbStorageGiB,
    unit: 'GB-month',
    unitPrice: pgBackup,
    monthlyRaw: (pgBackup ?? 0) * input.dbStorageGiB,
    note: 'Local backup up to 100% of provisioned storage is free; the geo-redundant copy (~1× storage) is billed.',
  });

  // ── Container Apps (Consumption) ──
  const vcpuSeconds = input.apiReplicas * input.apiVcpu * SECONDS_PER_MONTH;
  const vcpuActive = vcpuSeconds * ASSUMED.acaActiveFraction;
  const vcpuIdle = vcpuSeconds - vcpuActive;
  const vcpu = applyFreeGrant(vcpuActive, vcpuIdle, ACA_FREE_VCPU_SECONDS);
  const vActive = book.unit('acaVcpuActive');
  const vIdle = book.unit('acaVcpuIdle');
  add({
    key: 'aca_vcpu',
    label: `Container Apps vCPU — ${input.apiReplicas} × ${input.apiVcpu} vCPU`,
    quantity: Math.round(vcpuSeconds),
    unit: 'vCPU-seconds',
    unitPrice: vActive,
    monthlyRaw:
      (vActive ?? 0) * vcpu.activeBilled + (vIdle ?? 0) * vcpu.idleBilled,
    note: `${Math.round(ASSUMED.acaActiveFraction * 100)}% active / ${Math.round((1 - ASSUMED.acaActiveFraction) * 100)}% idle rate; first ${fmtNum(ACA_FREE_VCPU_SECONDS)} vCPU-s free.`,
  });
  const gibSeconds = input.apiReplicas * input.apiMemoryGiB * SECONDS_PER_MONTH;
  const memActive = gibSeconds * ASSUMED.acaActiveFraction;
  const mem = applyFreeGrant(
    memActive,
    gibSeconds - memActive,
    ACA_FREE_GIB_SECONDS,
  );
  const mA = book.unit('acaMemActive');
  const mI = book.unit('acaMemIdle');
  add({
    key: 'aca_memory',
    label: `Container Apps memory — ${input.apiReplicas} × ${input.apiMemoryGiB} GiB`,
    quantity: Math.round(gibSeconds),
    unit: 'GiB-seconds',
    unitPrice: mA,
    monthlyRaw: (mA ?? 0) * mem.activeBilled + (mI ?? mA ?? 0) * mem.idleBilled,
    note: `First ${fmtNum(ACA_FREE_GIB_SECONDS)} GiB-s free.`,
  });
  const reqPrice = book.unit('acaRequests');
  const billedRequests = Math.max(
    0,
    ASSUMED.acaRequestsPerMonth - ACA_FREE_REQUESTS,
  );
  add({
    key: 'aca_requests',
    label: 'Container Apps requests',
    quantity: ASSUMED.acaRequestsPerMonth,
    unit: 'requests',
    unitPrice: reqPrice,
    monthlyRaw: (reqPrice ?? 0) * billedRequests,
    note: `Assumes ${fmtNum(ASSUMED.acaRequestsPerMonth)} requests/month; first ${fmtNum(ACA_FREE_REQUESTS)} free.`,
  });

  // ── Storage account (Azure Files, transaction optimised, GRS) ──
  const filesData = book.unit('filesData');
  const filesOps =
    book.cost('filesWrite', ASSUMED.filesWriteOpsPerMonth) +
    book.cost('filesRead', ASSUMED.filesReadOpsPerMonth) +
    book.cost('filesList', ASSUMED.filesListOpsPerMonth) +
    book.cost('filesProtocol', ASSUMED.filesProtocolOpsPerMonth);
  add({
    key: 'storage_files',
    label: 'Storage — Azure Files (GRS)',
    quantity: input.storageGiB,
    unit: 'GB-month',
    unitPrice: filesData,
    monthlyRaw: (filesData ?? 0) * input.storageGiB + filesOps,
    note: 'Used capacity + assumed transactions (100k write, 500k read, 500k protocol, 20k list per month).',
  });

  // ── Container Registry Basic ──
  const acrDaily = book.unit('acrBasic');
  add({
    key: 'acr',
    label: 'Container Registry (Basic)',
    quantity: round2(DAYS_PER_MONTH),
    unit: 'days',
    unitPrice: acrDaily,
    monthlyRaw: (acrDaily ?? 0) * DAYS_PER_MONTH,
    note: `Includes ${ASSUMED.acrStorageIncludedGb} GB image storage.`,
  });

  // ── Static Web Apps Standard ──
  const swa = book.unit('swaStandard');
  add({
    key: 'swa',
    label: 'Static Web Apps (Standard)',
    quantity: 1,
    unit: 'app-month',
    unitPrice: swa,
    monthlyRaw: swa ?? 0,
    note: 'Admin SPA, West Europe; 100 GB bandwidth included.',
  });

  // ── Log Analytics (PAYG) ──
  const logGb = input.logGbPerDay * DAYS_PER_MONTH;
  const logTiers = book.tiers('logIngestion');
  add({
    key: 'log_analytics',
    label: 'Log Analytics ingestion (Pay-As-You-Go)',
    quantity: round2(logGb),
    unit: 'GB',
    unitPrice: logTiers
      ? (logTiers.find((t) => t.price > 0)?.price ?? logTiers[0].price)
      : null,
    monthlyRaw: logTiers ? tieredCost(logGb, logTiers) : 0,
    note: `${input.logGbPerDay} GB/day; first 5 GB/month per billing account free.`,
  });

  // ── Private endpoints ──
  const peHourly = book.unit('peHour');
  const peGb =
    input.privateEndpoints * ASSUMED.privateEndpointGbProcessedPerMonth;
  add({
    key: 'private_endpoints',
    label: 'Private endpoints',
    quantity: input.privateEndpoints * HOURS_PER_MONTH,
    unit: 'endpoint-hours',
    unitPrice: peHourly,
    monthlyRaw:
      (peHourly ?? 0) * input.privateEndpoints * HOURS_PER_MONTH +
      book.cost('peIngress', peGb / 2) +
      book.cost('peEgress', peGb / 2),
    note: `${input.privateEndpoints} endpoint(s) + ${ASSUMED.privateEndpointGbProcessedPerMonth} GB processed each.`,
  });

  // ── Communication Services Email ──
  const emailPrice = book.unit('emailSent');
  const mbPrice = book.unit('emailMb');
  const mb = input.emailsPerMonth * ASSUMED.emailAvgSizeMb;
  add({
    key: 'email',
    label: 'Communication Services Email',
    quantity: input.emailsPerMonth,
    unit: 'emails',
    unitPrice: emailPrice,
    monthlyRaw: (emailPrice ?? 0) * input.emailsPerMonth + (mbPrice ?? 0) * mb,
    note: `Per message + ${ASSUMED.emailAvgSizeMb} MB average per email.`,
  });

  // ── Key Vault ──
  const kv = book.unit('kvOps');
  add({
    key: 'key_vault',
    label: 'Key Vault (Standard) operations',
    quantity: ASSUMED.keyVaultOpsPerMonth,
    unit: 'operations',
    unitPrice: kv,
    monthlyRaw: (kv ?? 0) * ASSUMED.keyVaultOpsPerMonth,
    note: `Assumes ${fmtNum(ASSUMED.keyVaultOpsPerMonth)} secret reads/month.`,
  });

  // ── Container Apps environment public IP ──
  const ip = book.unit('publicIp');
  add({
    key: 'public_ip',
    label: 'Container Apps environment public IP (Standard)',
    quantity: ASSUMED.publicIps * HOURS_PER_MONTH,
    unit: 'hours',
    unitPrice: ip,
    monthlyRaw: (ip ?? 0) * ASSUMED.publicIps * HOURS_PER_MONTH,
    note: 'Load balancer IP in the managed infrastructure resource group.',
  });

  const total = lines.reduce((acc, l) => acc + l.monthly, 0);
  const assumptions = buildAssumptions(input, book);
  return {
    monthlyTotal: round2(total),
    lines: lines.map((l) => ({
      ...l,
      monthly: round2(l.monthly),
      unitPrice:
        l.unitPrice === null ? null : Number(l.unitPrice.toPrecision(6)),
    })),
    assumptions,
    missingMeters: [...book.missing],
  };
}

function buildAssumptions(input: EstimateInput, book: PriceBook): string[] {
  const a = [
    `List (retail, Pay-As-You-Go) prices from the Azure Retail Prices API in ${book.region} (Static Web Apps: West Europe; Private Link: Global). No discounts, reservations, credits or VAT.`,
    `A month is ${HOURS_PER_MONTH} hours (${round2(DAYS_PER_MONTH)} days).`,
    `Container Apps Consumption free grant applied per month: ${fmtNum(ACA_FREE_VCPU_SECONDS)} vCPU-seconds, ${fmtNum(ACA_FREE_GIB_SECONDS)} GiB-seconds and ${fmtNum(ACA_FREE_REQUESTS)} requests (once per subscription).`,
    `Container Apps replicas run all month (min replicas = ${input.apiReplicas}); ${Math.round(ASSUMED.acaActiveFraction * 100)}% of the time is billed at the active vCPU rate and the rest at the idle rate. The migrations job is negligible.`,
    'PostgreSQL high availability doubles compute and storage (standby server). Backup within 100% of provisioned storage is free; the geo-redundant copy is estimated at ~1× provisioned storage at the backup storage rate.',
    'Log Analytics: Pay-As-You-Go ingestion with the first 5 GB/month free; 31 days interactive retention included. Application Insights is workspace-based (included in this ingestion).',
    'Storage: Azure Files transaction-optimised on a Standard_GRS account billed on used capacity, plus small assumed transaction volumes.',
    'Not included: bandwidth/egress, Monitor alert rules and availability tests (pence per month), VNet (free), Defender plans, tax.',
  ];
  if (input.dbHighAvailability && input.dbSku !== 'D2ds_v5') {
    a.push(
      'Warning: Azure does not offer zone-redundant high availability on Burstable (B-series) servers — choose General Purpose (D2ds_v5) for HA.',
    );
  }
  if (book.missing.size) {
    a.push(
      `Prices not found in the stored catalogue (counted as £0): ${[...book.missing].join(', ')} — run a price sync.`,
    );
  }
  return a;
}
