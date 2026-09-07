import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { getAnalyticsSummary, rangeForDays } from '@/lib/analytics/metrics';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricTile } from '@/components/dashboard/metric-tile';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { active } = await requireCapability('analytics:view');
  const params = await searchParams;
  const days = params.range === '90' ? 90 : params.range === '7' ? 7 : 30;
  const summary = await getAnalyticsSummary(active.business.id, rangeForDays(days));
  const currency = active.business.currency;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Analytics"
        description={`Last ${days} days`}
        actions={
          <div className="flex gap-1">
            {['7', '30', '90'].map((option) => (
              <Button
                key={option}
                asChild
                size="sm"
                variant={String(days) === option ? 'primary' : 'secondary'}
              >
                <Link href={`/analytics?range=${option}`}>{option} days</Link>
              </Button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-5 px-6 py-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Conversations" value={formatNumber(summary.conversations)} />
          <MetricTile label="New leads" value={formatNumber(summary.newLeads)} />
          <MetricTile label="Conversions" value={formatNumber(summary.conversions)} tone="money" />
          <MetricTile
            label="Conversion rate"
            value={formatPercent(summary.conversionRate, 1)}
            hint="Of enquiries received in this period"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Enquiries, follow-ups and conversions</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart data={summary.daily} />
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recovery</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-ink-100">
                <Row label="Follow-ups sent" value={formatNumber(summary.followUpsSent)} />
                <Row
                  label="Follow-ups that got a reply"
                  value={`${formatNumber(summary.followUpsReplied)} · ${formatPercent(summary.followUpReplyRate, 0)}`}
                />
                <Row
                  label="Revenue from recovered leads"
                  value={formatCurrency(summary.attributedRevenue, currency)}
                  hint="Conversions where an automated follow-up went out before the booking"
                />
                <Row
                  label="Total booked revenue"
                  value={formatCurrency(summary.bookedRevenue, currency)}
                  hint="Every conversion recorded in this period"
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Handling</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-ink-100">
                <Row label="Inbound messages" value={formatNumber(summary.inboundMessages)} />
                <Row label="Outbound messages" value={formatNumber(summary.outboundMessages)} />
                <Row
                  label="Average first response"
                  value={
                    summary.averageResponseMinutes === null
                      ? '—'
                      : summary.averageResponseMinutes < 60
                        ? `${Math.round(summary.averageResponseMinutes)} min`
                        : `${(summary.averageResponseMinutes / 60).toFixed(1)} hrs`
                  }
                />
                <Row
                  label="Handled by the assistant"
                  value={formatNumber(summary.aiHandledConversations)}
                />
                <Row label="Human takeover rate" value={formatPercent(summary.humanTakeoverRate, 0)} />
                <Row label="Hot leads" value={formatNumber(summary.hotLeads)} />
                <Row label="Warm leads" value={formatNumber(summary.warmLeads)} />
              </dl>
            </CardContent>
          </Card>
        </div>

        <p className="text-[12px] text-ink-500">
          “Revenue from recovered leads” counts only conversions where the event log shows an
          automated follow-up reached the guest before they booked. Everything else is reported as
          total booked revenue — the system does not claim credit it cannot evidence.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-[13px] text-ink-600">
        {label}
        {hint ? <span className="mt-0.5 block text-[11px] text-ink-400">{hint}</span> : null}
      </dt>
      <dd className="shrink-0 text-[13px] font-medium text-ink-900 tabular">{value}</dd>
    </div>
  );
}
