import Link from 'next/link';
import type { Metadata } from 'next';
import { requireBusiness } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { getDashboardMetrics, getRecentActivity, rangeForDays, todayRange } from '@/lib/analytics/metrics';
import { countOpenWork } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricTile } from '@/components/dashboard/metric-tile';
import { LeadFunnel } from '@/components/dashboard/funnel';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; denied?: string }>;
}) {
  const { active } = await requireBusiness();
  const role = active.role;
  const params = await searchParams;
  const days = params.range === '30' ? 30 : params.range === '7' ? 7 : 0;
  const timezone = active.business.timezone;
  const currency = active.business.currency;

  const range = days === 0 ? todayRange(timezone) : rangeForDays(days);
  const [metrics, activity, counts] = await Promise.all([
    getDashboardMetrics(active.business.id, range),
    getRecentActivity(active.business.id),
    countOpenWork(active.business.id),
  ]);
  const openIssues = counts.openIssues;

  const rangeLabel = days === 0 ? 'Today' : `Last ${days} days`;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description={`${active.business.name} · ${rangeLabel}`}
        actions={
          <div className="flex gap-1">
            {[
              { value: '0', label: 'Today' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ].map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={String(days) === option.value ? 'primary' : 'secondary'}
              >
                <Link href={`/dashboard?range=${option.value}`}>{option.label}</Link>
              </Button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-5 px-6 py-5">
        {openIssues > 0 && can(role, 'system_health:view') ? (
          <Link
            href="/settings/health"
            className="flex items-center justify-between gap-3 rounded-md bg-hot-50 px-3 py-2.5 text-[13px] text-hot-700 transition-colors hover:bg-hot-100"
          >
            <span>
              {openIssues} unresolved {openIssues === 1 ? 'issue' : 'issues'} need looking at —
              enquiries may be going unanswered.
            </span>
            <span className="shrink-0 font-medium underline underline-offset-2">Open health</span>
          </Link>
        ) : null}

        {params.denied ? (
          <p className="rounded-md bg-warm-50 px-3 py-2 text-[13px] text-warm-700">
            Your role does not have access to that page.
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Enquiries" value={formatNumber(metrics.enquiries)} hint={rangeLabel.toLowerCase()} />
          <MetricTile
            label="Hot leads"
            value={formatNumber(metrics.hotLeads)}
            tone="hot"
            hint="Open leads scoring 80 or above"
          />
          <MetricTile
            label="Follow-ups due"
            value={formatNumber(metrics.followUpsDue)}
            tone="warm"
            hint="Waiting to be sent now"
          />
          <MetricTile
            label="Conversions"
            value={formatNumber(metrics.conversions)}
            tone="money"
            hint={`${formatPercent(metrics.conversionRate, 1)} of enquiries`}
          />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricTile
            label="Revenue from recovered leads"
            value={formatCurrency(metrics.recoveredRevenue, currency)}
            tone="money"
            hint={
              metrics.recoveredConversions > 0
                ? `${metrics.recoveredConversions} of ${metrics.conversions} conversions received an automated follow-up before booking`
                : 'No conversion in this period had been followed up automatically'
            }
          />
          <MetricTile
            label="Total booked revenue"
            value={formatCurrency(metrics.bookedRevenue, currency)}
            hint="Every conversion your team recorded, however it came in"
          />
          <MetricTile
            label="Open pipeline"
            value={formatCurrency(metrics.pipelineValue, currency)}
            hint="Estimated value of leads still in play"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Lead funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadFunnel steps={metrics.funnel} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Recent activity</CardTitle>
              <Link href="/conversations" className="text-[12px] font-medium text-accent-600 hover:text-accent-700">
                Open inbox
              </Link>
            </CardHeader>
            <CardContent>
              <ActivityFeed items={activity} />
            </CardContent>
          </Card>
        </div>

        {metrics.enquiries === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm font-medium text-ink-800">No enquiries yet</p>
              <p className="mt-1 text-[13px] text-ink-500">
                Connect your WhatsApp number in settings, or run the demo to see a complete
                enquiry → follow-up → conversion flow without touching WhatsApp.
              </p>
              <div className="mt-4 flex gap-2">
                {can(role, 'whatsapp:manage') ? (
                  <Button asChild size="sm">
                    <Link href="/settings/whatsapp">Connect WhatsApp</Link>
                  </Button>
                ) : null}
                {can(role, 'demo:run') ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/demo">Run the demo</Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
