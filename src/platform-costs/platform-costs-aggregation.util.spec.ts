import {
  addMonths,
  compareWithLastMonth,
  csvEscape,
  dailySeries,
  dailySeriesByGroup,
  groupCosts,
  linearMonthEndForecast,
  monthEnd,
  resourceNameFromId,
  round2,
  toCsv,
  whisperJobName,
  whisperSpend,
  type CostRow,
} from './platform-costs-aggregation.util';
import { perUnit } from './platform-costs.service';

const PG =
  '/subscriptions/s/resourcegroups/rg-careflow-prod/providers/microsoft.dbforpostgresql/flexibleservers/psql-allforcare-prod';
const ACR =
  '/subscriptions/s/resourcegroups/rg-careflow-prod/providers/microsoft.containerregistry/registries/acrcareflowprod';
const IP =
  '/subscriptions/s/resourcegroups/rg-careflow-prod-cae-infra/providers/microsoft.network/publicipaddresses/capp-svc-lb-ip';

function row(
  date: string,
  serviceName: string,
  resourceId: string,
  cost: number,
  rg = 'rg-careflow-prod',
): CostRow {
  return {
    date,
    resourceGroup: rg,
    serviceName,
    resourceId,
    meterCategory: serviceName,
    cost,
  };
}

describe('platform costs aggregation', () => {
  const rows: CostRow[] = [
    row('2026-09-29', 'Azure Database for PostgreSQL', PG, 0.5),
    row('2026-09-29', 'Container Registry', ACR, 0.12),
    row('2026-09-30', 'Azure Database for PostgreSQL', PG, 0.5),
    row('2026-09-30', 'Container Registry', ACR, 0.12),
    row(
      '2026-09-30',
      'Virtual Network',
      IP,
      0.09,
      'rg-careflow-prod-cae-infra',
    ),
  ];

  it('rounds money to 2 dp without -0', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-0.001)).toBe(0);
    expect(Object.is(round2(-0.001), -0)).toBe(false);
  });

  it('groups by service with shares summing to ~100', () => {
    const g = groupCosts(rows, 'service');
    expect(g.map((r) => r.key)).toEqual([
      'Azure Database for PostgreSQL',
      'Container Registry',
      'Virtual Network',
    ]);
    expect(g[0].cost).toBe(1);
    expect(g[1].cost).toBe(0.24);
    expect(g.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 0);
  });

  it('groups by resource with label, resource group and service', () => {
    const g = groupCosts(rows, 'resource');
    expect(g[0]).toMatchObject({
      key: PG,
      label: 'psql-allforcare-prod',
      resourceGroup: 'rg-careflow-prod',
      service: 'Azure Database for PostgreSQL',
      cost: 1,
    });
  });

  it('labels a multi-service resource with its most expensive service', () => {
    const st =
      '/subscriptions/s/resourcegroups/rg/providers/microsoft.storage/storageaccounts/st';
    const g = groupCosts(
      [
        row('2026-09-01', 'Bandwidth', st, 0.01),
        row('2026-09-01', 'Storage', st, 0.03),
      ],
      'resource',
    );
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ label: 'st', service: 'Storage', cost: 0.04 });
  });

  it('groups by resource group and meter', () => {
    expect(
      groupCosts(rows, 'resourceGroup').map((r) => [r.key, r.cost]),
    ).toEqual([
      ['rg-careflow-prod', 1.24],
      ['rg-careflow-prod-cae-infra', 0.09],
    ]);
    expect(groupCosts(rows, 'meter')[0].key).toBe(
      'Azure Database for PostgreSQL',
    );
  });

  it('gives share 0 when total is 0', () => {
    expect(
      groupCosts([row('2026-09-01', 'X', '', 0)], 'service')[0].share,
    ).toBe(0);
  });

  it('labels rows without resource id', () => {
    expect(resourceNameFromId('')).toBe('(no resource)');
    expect(
      groupCosts([row('2026-09-01', 'Bandwidth', '', 1)], 'resource')[0].label,
    ).toBe('(no resource) Bandwidth');
  });

  it('zero-fills the daily series', () => {
    expect(dailySeries(rows, '2026-09-28', '2026-10-01')).toEqual([
      { date: '2026-09-28', cost: 0 },
      { date: '2026-09-29', cost: 0.62 },
      { date: '2026-09-30', cost: 0.71 },
      { date: '2026-10-01', cost: 0 },
    ]);
  });

  it('handles month arithmetic across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });

  it('compares month-to-date with the same period last month', () => {
    const data: CostRow[] = [
      row('2026-09-01', 'S', 'a', 10),
      row('2026-09-02', 'S', 'a', 10),
      row('2026-09-20', 'S', 'a', 50),
      row('2026-10-01', 'S', 'a', 12),
      row('2026-10-02', 'S', 'a', 13),
    ];
    const cmp = compareWithLastMonth(data, '2026-10', '2026-10-02');
    expect(cmp).toEqual({
      monthToDate: 25,
      lastMonthTotal: 70,
      lastMonthSamePeriod: 20,
      changeVsLastMonthPercent: 25,
    });
  });

  it('returns null change when last month had no spend in the period', () => {
    const cmp = compareWithLastMonth(
      [row('2026-10-01', 'S', 'a', 1)],
      '2026-10',
      '2026-10-01',
    );
    expect(cmp.changeVsLastMonthPercent).toBeNull();
    expect(cmp.lastMonthSamePeriod).toBe(0);
  });

  it('clamps the same-period day to the previous month length', () => {
    const data = [
      row('2026-02-28', 'S', 'a', 5),
      row('2026-03-31', 'S', 'a', 1),
    ];
    expect(
      compareWithLastMonth(data, '2026-03', '2026-03-31').lastMonthSamePeriod,
    ).toBe(5);
  });

  it('projects month end linearly from the last 7 data days', () => {
    const data: CostRow[] = [];
    for (let d = 1; d <= 10; d++)
      data.push(row(`2026-09-${String(d).padStart(2, '0')}`, 'S', 'a', 2));
    // MTD 20 + 2/day × 20 remaining days
    expect(linearMonthEndForecast(data, '2026-09', '2026-09-10')).toBe(60);
  });

  it('perUnit is null when the divisor is 0', () => {
    expect(perUnit(10, 0)).toBeNull();
    expect(perUnit(10, 3)).toBe(3.33);
  });

  it('escapes CSV and neutralises formulas in text cells only', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape(-1.5)).toBe('-1.5');
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });
});

describe('dailySeriesByGroup', () => {
  it('splits each day into the top N groups plus Other, keyed like rows[].key', () => {
    const rows: CostRow[] = [];
    const services = ['A', 'B', 'C', 'D'];
    services.forEach((svc, i) => {
      rows.push({
        date: '2026-09-01',
        resourceGroup: 'rg',
        serviceName: svc,
        resourceId: `/r/${svc}`,
        meterCategory: svc,
        cost: 4 - i,
      });
    });
    const out = dailySeriesByGroup(
      rows,
      '2026-09-01',
      '2026-09-02',
      'service',
      2,
    );
    expect(out).toEqual([
      { date: '2026-09-01', cost: 10, groups: { A: 4, B: 3, Other: 3 } },
      { date: '2026-09-02', cost: 0, groups: {} },
    ]);
    const keys = groupCosts(rows, 'resource').map((g) => g.key);
    const byRes = dailySeriesByGroup(
      rows,
      '2026-09-01',
      '2026-09-01',
      'resource',
    );
    expect(Object.keys(byRes[0].groups).every((k) => keys.includes(k))).toBe(
      true,
    );
  });
});

describe('whisperSpend', () => {
  const WHISPER =
    '/subscriptions/s/resourceGroups/rg-careflow-prod/providers/Microsoft.App/jobs/job-careflow-whisper';
  const OTHER_JOB =
    '/subscriptions/s/resourcegroups/rg-careflow-prod/providers/microsoft.app/jobs/job-careflow-whisper-old';
  const rows = [
    row('2026-10-15', 'Azure Container Apps', WHISPER.toLowerCase(), 0.4),
    row('2026-11-02', 'Azure Container Apps', WHISPER, 0.25),
    row('2026-11-05', 'Azure Container Apps', WHISPER.toLowerCase(), 0.5),
    row('2026-11-05', 'Azure Container Apps', OTHER_JOB, 9),
    row('2026-11-05', 'Azure Database for PostgreSQL', PG, 5.25),
  ];

  it('sums only the Whisper job, this month and last month, case-insensitively', () => {
    expect(whisperSpend(rows, '2026-11', 'job-careflow-whisper')).toEqual({
      jobName: 'job-careflow-whisper',
      monthToDate: 0.75,
      lastMonthTotal: 0.4,
      shareOfMonth: 5,
    });
  });

  it('is zero when the job has no costs yet', () => {
    expect(
      whisperSpend(
        [row('2026-11-05', 'PG', PG, 3)],
        '2026-11',
        'job-careflow-whisper',
      ),
    ).toEqual({
      jobName: 'job-careflow-whisper',
      monthToDate: 0,
      lastMonthTotal: 0,
      shareOfMonth: 0,
    });
    expect(
      whisperSpend([], '2026-11', 'job-careflow-whisper').shareOfMonth,
    ).toBe(0);
  });

  it('takes the job name from WHISPER_JOB_RESOURCE_ID', () => {
    expect(whisperJobName(WHISPER)).toBe('job-careflow-whisper');
    expect(
      whisperJobName('/subscriptions/s/x/providers/Microsoft.App/jobs/My-Job'),
    ).toBe('my-job');
    expect(whisperJobName(undefined)).toBe('job-careflow-whisper');
    expect(whisperJobName('')).toBe('job-careflow-whisper');
  });
});
