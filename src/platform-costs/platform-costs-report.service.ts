import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PlatformCostsAzureGateway } from './platform-costs-azure.gateway';
import { PlatformCostsDataService } from './platform-costs-data.service';
import { PlatformCostsService } from './platform-costs.service';
import {
  addMonths,
  filterRange,
  groupCosts,
  monthEnd,
  monthOf,
  monthStart,
  round2,
  sumCost,
  toCsv,
} from './platform-costs-aggregation.util';
import {
  escapeHtml,
  formatMoney,
  formatPercent,
  monthLabel,
} from './platform-costs-format.util';
import { SETTINGS_ID } from './platform-costs.constants';

export type MonthlyReport = {
  month: string;
  subject: string;
  html: string;
  text: string;
  csv: string;
  csvFilename: string;
};

/** Report period = the previous calendar month relative to `now` (UTC billing month). */
export function previousMonth(now: Date): string {
  return addMonths(monthOf(now), -1);
}

@Injectable()
export class PlatformCostsReportService {
  private readonly logger = new Logger(PlatformCostsReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly auditLogs: AuditLogsService,
    private readonly azure: PlatformCostsAzureGateway,
    private readonly data: PlatformCostsDataService,
    private readonly costs: PlatformCostsService,
  ) {}

  async buildMonthlyReport(month: string): Promise<MonthlyReport> {
    const currency = this.azure.settings.currency;
    const prev = addMonths(month, -1);
    const rows = await this.data.loadRows(monthStart(prev), monthEnd(month));
    const monthRows = filterRange(rows, monthStart(month), monthEnd(month));
    const prevRows = filterRange(rows, monthStart(prev), monthEnd(prev));
    const total = round2(sumCost(monthRows));
    const prevTotal = round2(sumCost(prevRows));
    const change =
      prevTotal > 0 ? round2(((total - prevTotal) / prevTotal) * 100) : null;
    const byService = groupCosts(monthRows, 'service');
    const prevByService = new Map(
      groupCosts(prevRows, 'service').map((r) => [r.key, r.cost]),
    );
    const topResources = groupCosts(monthRows, 'resource').slice(0, 10);
    const budget = await this.data.budgetView(total, null);
    const budgetAmount = budget?.amount ?? null;
    const budgetPct = budgetAmount
      ? round2((total / budgetAmount) * 100)
      : null;
    const unit = await this.costs.unitEconomics(month);
    const dataThrough = await this.data.dataThrough();
    const label = monthLabel(month);
    const subject = `Careflow Azure costs — ${label}: ${formatMoney(total, currency)}`;

    const money = (n: number | null) => escapeHtml(formatMoney(n, currency));
    const th =
      'style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.03em"';
    const thR = th.replace('text-align:left', 'text-align:right');
    const td =
      'style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a"';
    const tdR = td.replace(
      'padding:8px 10px',
      'padding:8px 10px;text-align:right;white-space:nowrap',
    );

    const serviceRows = byService.length
      ? byService
          .map((s) => {
            const p = prevByService.get(s.key) ?? 0;
            return `<tr><td ${td}>${escapeHtml(s.label)}</td><td ${tdR}>${money(s.cost)}</td><td ${tdR}>${escapeHtml(formatPercent(s.share))}</td><td ${tdR}>${money(p)}</td></tr>`;
          })
          .join('')
      : `<tr><td ${td} colspan="4">No cost data for this month.</td></tr>`;
    const resourceRows = topResources.length
      ? topResources
          .map(
            (r) =>
              `<tr><td ${td}>${escapeHtml(r.label)}<div style="font-size:12px;color:#64748b">${escapeHtml(r.service ?? '')} · ${escapeHtml(r.resourceGroup ?? '')}</div></td><td ${tdR}>${money(r.cost)}</td><td ${tdR}>${escapeHtml(formatPercent(r.share))}</td></tr>`,
          )
          .join('')
      : `<tr><td ${td} colspan="3">No resources with cost.</td></tr>`;
    const changeText =
      change === null
        ? 'no previous-month data'
        : `${change >= 0 ? '+' : ''}${formatPercent(change)} vs ${monthLabel(prev)}`;
    const changeColour =
      change === null ? '#64748b' : change > 0 ? '#b91c1c' : '#15803d';
    const kpi = (
      title: string,
      value: string,
      sub: string,
      colour = '#64748b',
    ) =>
      `<td style="padding:6px;width:33%;vertical-align:top"><div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#ffffff"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.03em">${escapeHtml(title)}</div><div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px">${escapeHtml(value)}</div><div style="font-size:12px;color:${colour};margin-top:2px">${escapeHtml(sub)}</div></div></td>`;
    const budgetBar =
      budgetPct === null
        ? ''
        : `<div style="margin:6px 6px 18px"><div style="font-size:13px;color:#334155;margin-bottom:6px">Budget <strong>${escapeHtml(budget?.name ?? '')}</strong>: ${money(total)} of ${money(budgetAmount)} (${escapeHtml(formatPercent(budgetPct))})</div><div style="background:#e2e8f0;border-radius:6px;height:10px;overflow:hidden"><div style="height:10px;width:${Math.min(100, Math.max(0, budgetPct))}%;background:${budgetPct >= 100 ? '#dc2626' : budgetPct >= 85 ? '#f59e0b' : '#2563eb'}"></div></div></div>`;

    const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">
<div style="background:#0f172a;color:#ffffff;border-radius:12px 12px 0 0;padding:20px 22px">
<div style="font-size:13px;opacity:.75">Careflow · Azure Pricing</div>
<div style="font-size:22px;font-weight:700;margin-top:4px">Monthly Azure cost report — ${escapeHtml(label)}</div>
</div>
<div style="background:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 16px 22px">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr>
${kpi('Total spend', formatMoney(total, currency), changeText, changeColour)}
${kpi('Previous month', formatMoney(prevTotal, currency), monthLabel(prev))}
${kpi('Budget used', budgetPct === null ? '—' : formatPercent(budgetPct), budgetAmount === null ? 'No budget found' : `of ${formatMoney(budgetAmount, currency)}`)}
</tr></table>
${budgetBar}
<h3 style="font-size:15px;color:#0f172a;margin:18px 6px 8px">Cost by service</h3>
<table style="width:100%;border-collapse:collapse"><thead><tr><th ${th}>Service</th><th ${thR}>Cost</th><th ${thR}>Share</th><th ${thR}>${escapeHtml(monthLabel(prev))}</th></tr></thead><tbody>${serviceRows}</tbody></table>
<h3 style="font-size:15px;color:#0f172a;margin:22px 6px 8px">Top resources</h3>
<table style="width:100%;border-collapse:collapse"><thead><tr><th ${th}>Resource</th><th ${thR}>Cost</th><th ${thR}>Share</th></tr></thead><tbody>${resourceRows}</tbody></table>
<h3 style="font-size:15px;color:#0f172a;margin:22px 6px 8px">Unit economics</h3>
<table style="width:100%;border-collapse:collapse"><thead><tr><th ${th}>Metric</th><th ${thR}>Volume</th><th ${thR}>Cost per unit</th></tr></thead><tbody>
<tr><td ${td}>Active service users</td><td ${tdR}>${unit.activeServiceUsers}</td><td ${tdR}>${money(unit.costPerServiceUser)}</td></tr>
<tr><td ${td}>Active carers / employees</td><td ${tdR}>${unit.activeCarers}</td><td ${tdR}>${money(unit.costPerCarer)}</td></tr>
<tr><td ${td}>Completed visits</td><td ${tdR}>${unit.completedVisits}</td><td ${tdR}>${money(unit.costPerVisit)}</td></tr>
</tbody></table>
<p style="font-size:12px;color:#64748b;margin:20px 6px 0;line-height:1.5">Actual cost from Azure Cost Management (resource groups: ${escapeHtml(this.azure.settings.resourceGroups.join(', '))}), list prices in ${escapeHtml(currency)} excluding VAT. Azure cost data is updated every 8–24 hours${dataThrough ? `; data through ${escapeHtml(dataThrough)}` : ''}. The attached CSV lists every resource.</p>
</div></div></body></html>`;

    const text = [
      `Careflow Azure cost report — ${label}`,
      `Total: ${formatMoney(total, currency)} (${changeText})`,
      `Previous month: ${formatMoney(prevTotal, currency)}`,
      budgetPct === null
        ? 'Budget: none found'
        : `Budget: ${formatPercent(budgetPct)} of ${formatMoney(budgetAmount, currency)}`,
      '',
      'By service:',
      ...byService.map(
        (s) =>
          `  ${s.label}: ${formatMoney(s.cost, currency)} (${formatPercent(s.share)})`,
      ),
      '',
      `Cost per active service user: ${formatMoney(unit.costPerServiceUser, currency)}`,
      `Cost per active carer: ${formatMoney(unit.costPerCarer, currency)}`,
      `Cost per completed visit: ${formatMoney(unit.costPerVisit, currency)}`,
    ].join('\n');

    const resources = groupCosts(monthRows, 'resource');
    const csv = toCsv(
      [
        'month',
        'resourceId',
        'resourceName',
        'resourceGroup',
        'service',
        `cost_${currency}`,
        'sharePercent',
      ],
      [
        ...resources.map((r) => [
          month,
          r.key,
          r.label,
          r.resourceGroup ?? '',
          r.service ?? '',
          r.cost,
          r.share,
        ]),
        [month, 'TOTAL', '', '', '', total, 100],
      ],
    );
    return {
      month,
      subject,
      html,
      text,
      csv,
      csvFilename: `azure-costs_${month}.csv`,
    };
  }

  async preview(userId: string, meta: RequestAuditMeta, now = new Date()) {
    const report = await this.buildMonthlyReport(previousMonth(now));
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_report_previewed',
      recordType: 'PlatformCostReport',
      description: `Previewed Azure monthly cost report for ${report.month}`,
      metadata: { month: report.month },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { subject: report.subject, html: report.html };
  }

  /** Sends the previous month's report to the requesting user only. */
  async sendTest(userId: string, meta: RequestAuditMeta, now = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email)
      throw new BadRequestException('Your account has no e-mail address');
    const report = await this.buildMonthlyReport(previousMonth(now));
    const result = await this.mail.send({
      to: user.email,
      subject: `[Test] ${report.subject}`,
      text: report.text,
      html: report.html,
      attachments: [
        {
          filename: report.csvFilename,
          content: report.csv,
          contentType: 'text/csv',
        },
      ],
    });
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_test_report_sent',
      recordType: 'PlatformCostReport',
      description: `Sent a test Azure monthly cost report (${report.month}) to self`,
      metadata: { month: report.month, mode: result.mode },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { sentTo: user.email, month: report.month, subject: report.subject };
  }

  /** Scheduled send for `month` (idempotent per month via lastMonthlyReportPeriod). */
  async sendScheduled(month: string): Promise<'sent' | 'skipped'> {
    const settings = await this.data.getSettings();
    if (!settings.monthlyReportEnabled) return 'skipped';
    if (settings.lastMonthlyReportPeriod === month) return 'skipped';
    if (!settings.monthlyReportRecipients.length) {
      this.logger.warn(
        `Azure monthly report for ${month} skipped: no recipients configured`,
      );
      return 'skipped';
    }
    const report = await this.buildMonthlyReport(month);
    await this.mail.send({
      to: settings.monthlyReportRecipients,
      subject: report.subject,
      text: report.text,
      html: report.html,
      attachments: [
        {
          filename: report.csvFilename,
          content: report.csv,
          contentType: 'text/csv',
        },
      ],
    });
    await this.prisma.platformCostSettings.update({
      where: { id: SETTINGS_ID },
      data: { lastMonthlyReportPeriod: month },
    });
    await this.auditLogs.logAudit({
      module: AuditModule.PLATFORM_COSTS,
      action: 'platform_costs_monthly_report_sent',
      recordType: 'PlatformCostReport',
      description: `Sent the Azure monthly cost report for ${month}`,
      metadata: { month, recipients: settings.monthlyReportRecipients.length },
    });
    return 'sent';
  }
}
