'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { FollowUp, Lead, LeadEvent, StaffNote } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { LeadStatusBadge, TemperatureBadge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { INTENT_LABELS } from '@/lib/ai/intent';
import { formatCurrency, formatDate, formatDateTime, formatRelative } from '@/lib/utils/format';
import {
  addNoteAction,
  assignLeadAction,
  cancelFollowUpAction,
  convertLeadAction,
  loseLeadAction,
  scheduleManualFollowUpAction,
  updateLeadDetailsAction,
} from '@/lib/conversations/actions';

const EVENT_LABELS: Record<string, string> = {
  lead_created: 'Enquiry captured',
  lead_scored: 'Lead scored',
  intent_detected: 'Intent detected',
  ai_replied: 'Assistant replied',
  ai_skipped: 'Assistant stayed out',
  staff_replied: 'Staff replied',
  follow_up_scheduled: 'Follow-up scheduled',
  follow_up_sent: 'Follow-up sent',
  follow_up_cancelled: 'Follow-up cancelled',
  customer_replied: 'Guest replied',
  customer_opted_out: 'Guest opted out',
  human_takeover: 'Handed to staff',
  ai_resumed: 'Assistant resumed',
  ai_paused: 'Assistant paused',
  lead_assigned: 'Lead assigned',
  lead_converted: 'Converted',
  lead_lost: 'Marked lost',
  note_added: 'Note added',
};

export function LeadPanel({
  lead,
  events,
  notes,
  followUps,
  team,
  currency,
  timezone,
}: {
  lead: Lead | null;
  events: LeadEvent[];
  notes: Array<StaffNote & { author: { full_name: string | null } | null }>;
  followUps: FollowUp[];
  team: Array<{ userId: string; profile: { full_name: string | null } | null }>;
  currency: string;
  timezone: string;
}) {
  if (!lead) {
    return (
      <aside className="w-80 shrink-0 border-l border-ink-200 bg-white px-4 py-5">
        <p className="text-[13px] text-ink-500">
          No lead has been created for this conversation yet. One is created as soon as a guest sends
          an enquiry.
        </p>
      </aside>
    );
  }

  const scheduled = followUps.filter((f) => f.status === 'scheduled');
  const isClosed = lead.status === 'converted' || lead.status === 'lost';

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-ink-200 bg-white scrollbar-thin">
      <div className="border-b border-ink-200 px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <LeadStatusBadge status={lead.status} />
          <TemperatureBadge temperature={lead.temperature} />
          <span className="tabular text-[13px] font-medium text-ink-700">{lead.lead_score}/100</span>
        </div>
        <p className="mt-2 text-[13px] text-ink-500">{INTENT_LABELS[lead.intent]}</p>
        {lead.estimated_value ? (
          <p className="mt-2 text-sm font-semibold text-ink-900 tabular">
            {formatCurrency(Number(lead.estimated_value), currency)}
            <span className="ml-1 text-[12px] font-normal text-ink-500">estimated</span>
          </p>
        ) : null}
      </div>

      {!isClosed ? (
        <div className="flex gap-2 border-b border-ink-200 px-4 py-3">
          <ConvertDialog leadId={lead.id} currency={currency} suggested={lead.estimated_value} />
          <LoseDialog leadId={lead.id} />
        </div>
      ) : (
        <div className="border-b border-ink-200 px-4 py-3">
          {lead.status === 'converted' ? (
            <p className="text-[13px] text-money-700">
              Converted for {formatCurrency(Number(lead.conversion_value), currency)} on{' '}
              {formatDate(lead.converted_at, timezone)}.
            </p>
          ) : (
            <p className="text-[13px] text-ink-500">
              Marked lost on {formatDate(lead.lost_at, timezone)}
              {lead.loss_reason ? ` — ${lead.loss_reason}` : ''}.
            </p>
          )}
        </div>
      )}

      <Section title="Enquiry details">
        <LeadDetailsForm lead={lead} currency={currency} />
      </Section>

      <Section title="Assigned to">
        <AssignControl leadId={lead.id} assignedTo={lead.assigned_staff_id} team={team} />
      </Section>

      <Section title="Follow-ups">
        {scheduled.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            {lead.follow_ups_sent > 0
              ? `${lead.follow_ups_sent} follow-up${lead.follow_ups_sent > 1 ? 's' : ''} sent. Nothing pending.`
              : 'Nothing scheduled.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {scheduled.map((followUp) => (
              <li key={followUp.id} className="rounded-md border border-ink-200 px-3 py-2">
                <p className="text-[12px] font-medium text-ink-700">
                  Step {followUp.sequence_index} · {formatRelative(followUp.scheduled_for)}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {formatDateTime(followUp.scheduled_for, timezone)}
                </p>
                <p className="mt-1 line-clamp-2 text-[12px] text-ink-600">{followUp.body}</p>
                <CancelFollowUpButton followUpId={followUp.id} />
              </li>
            ))}
          </ul>
        )}
        {!isClosed ? <ManualFollowUpDialog leadId={lead.id} /> : null}
      </Section>

      <Section title="Notes">
        <NoteForm leadId={lead.id} />
        {notes.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-md bg-ink-50 px-3 py-2">
                <p className="text-[12px] text-ink-700">{note.body}</p>
                <p className="mt-1 text-[11px] text-ink-400">
                  {note.author?.full_name ?? 'Staff'} · {formatRelative(note.created_at)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Timeline">
        <ol className="flex flex-col gap-2.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300" />
              <span className="min-w-0">
                <span className="block text-[12px] text-ink-700">
                  {EVENT_LABELS[event.type] ?? event.type}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {formatDateTime(event.created_at, timezone)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-ink-200 px-4 py-4 last:border-b-0">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

function LeadDetailsForm({ lead, currency }: { lead: Lead; currency: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await updateLeadDetailsAction(formData);
          if (result.ok) toast.success('Lead updated.');
          else toast.error(result.error ?? 'That did not work.');
        })
      }
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="leadId" value={lead.id} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Check-in" htmlFor="expectedCheckIn">
          <Input
            id="expectedCheckIn"
            name="expectedCheckIn"
            type="date"
            defaultValue={lead.expected_check_in ?? ''}
            className="h-8 text-[12px]"
          />
        </Field>
        <Field label="Check-out" htmlFor="expectedCheckOut">
          <Input
            id="expectedCheckOut"
            name="expectedCheckOut"
            type="date"
            defaultValue={lead.expected_check_out ?? ''}
            className="h-8 text-[12px]"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Guests" htmlFor="guests">
          <Input
            id="guests"
            name="guests"
            type="number"
            min={1}
            defaultValue={lead.guests ?? ''}
            className="h-8 text-[12px]"
          />
        </Field>
        <Field label={`Value (${currency})`} htmlFor="estimatedValue">
          <Input
            id="estimatedValue"
            name="estimatedValue"
            type="number"
            min={0}
            defaultValue={lead.estimated_value ? Number(lead.estimated_value) : ''}
            className="h-8 text-[12px]"
          />
        </Field>
      </div>
      <Field label="Room preference" htmlFor="roomPreference">
        <Input
          id="roomPreference"
          name="roomPreference"
          defaultValue={lead.room_preference ?? ''}
          className="h-8 text-[12px]"
        />
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save details'}
      </Button>
    </form>
  );
}

function AssignControl({
  leadId,
  assignedTo,
  team,
}: {
  leadId: string;
  assignedTo: string | null;
  team: Array<{ userId: string; profile: { full_name: string | null } | null }>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Assign lead"
      defaultValue={assignedTo ?? ''}
      disabled={pending}
      className="h-8 text-[12px]"
      onChange={(event) => {
        const formData = new FormData();
        formData.set('leadId', leadId);
        formData.set('staffId', event.target.value);
        startTransition(async () => {
          const result = await assignLeadAction(formData);
          if (result.ok) toast.success('Lead assigned.');
          else toast.error(result.error ?? 'That did not work.');
        });
      }}
    >
      <option value="">Unassigned</option>
      {team.map((member) => (
        <option key={member.userId} value={member.userId}>
          {member.profile?.full_name ?? 'Team member'}
        </option>
      ))}
    </Select>
  );
}

function ConvertDialog({
  leadId,
  currency,
  suggested,
}: {
  leadId: string;
  currency: string;
  suggested: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="success" size="sm" className="flex-1">
          Mark converted
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Record the booking"
        description="Enter the revenue for this booking. It is what the dashboard reports."
      >
        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await convertLeadAction(formData);
              if (result.ok) {
                toast.success(result.message ?? 'Lead converted.');
                setOpen(false);
              } else {
                toast.error(result.error ?? 'That did not work.');
              }
            })
          }
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <Field label={`Booking value (${currency})`} htmlFor="conversionValue">
            <Input
              id="conversionValue"
              name="conversionValue"
              type="number"
              min={0}
              step={1}
              defaultValue={suggested ? Number(suggested) : ''}
              placeholder="5600"
              required
              autoFocus
            />
          </Field>
          <Button type="submit" variant="success" disabled={pending}>
            {pending ? 'Saving…' : 'Record conversion'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoseDialog({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="flex-1">
          Mark lost
        </Button>
      </DialogTrigger>
      <DialogContent title="Close this enquiry" description="Follow-ups stop immediately.">
        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await loseLeadAction(formData);
              if (result.ok) {
                toast.success(result.message ?? 'Lead marked lost.');
                setOpen(false);
              } else {
                toast.error(result.error ?? 'That did not work.');
              }
            })
          }
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <Field label="Reason (optional)" htmlFor="reason">
            <Input id="reason" name="reason" placeholder="Booked elsewhere" autoFocus />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? 'Saving…' : 'Mark lost'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualFollowUpDialog({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaultTime = defaultFollowUpTime();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-2 w-full">
          Schedule a follow-up
        </Button>
      </DialogTrigger>
      <DialogContent title="Schedule a follow-up" description="Sent automatically at the time you choose.">
        <form
          action={(formData) => {
            const local = String(formData.get('scheduledForLocal') ?? '');
            formData.set('scheduledFor', new Date(local).toISOString());
            startTransition(async () => {
              const result = await scheduleManualFollowUpAction(formData);
              if (result.ok) {
                toast.success(result.message ?? 'Follow-up scheduled.');
                setOpen(false);
              } else {
                toast.error(result.error ?? 'That did not work.');
              }
            });
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <Field label="Send at" htmlFor="scheduledForLocal" hint="Your local time.">
            <Input
              id="scheduledForLocal"
              name="scheduledForLocal"
              type="datetime-local"
              defaultValue={defaultTime}
              required
            />
          </Field>
          <Field label="Message" htmlFor="body">
            <Textarea
              id="body"
              name="body"
              rows={3}
              required
              placeholder="Just checking whether you would like me to hold the room for your dates."
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Scheduling…' : 'Schedule follow-up'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Tomorrow, in the input's local-datetime format. Outside the component to keep render pure. */
function defaultFollowUpTime(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function CancelFollowUpButton({ followUpId }: { followUpId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set('followUpId', followUpId);
        startTransition(async () => {
          const result = await cancelFollowUpAction(formData);
          if (result.ok) toast.success('Follow-up cancelled.');
          else toast.error(result.error ?? 'That did not work.');
        });
      }}
      className="mt-1.5 text-[11px] font-medium text-hot-600 hover:text-hot-700"
    >
      Cancel
    </button>
  );
}

function NoteForm({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await addNoteAction(formData);
          if (result.ok) toast.success('Note added.');
          else toast.error(result.error ?? 'That did not work.');
        })
      }
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <Textarea name="body" rows={2} required placeholder="Add a note for your team…" className="text-[12px]" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Add note'}
      </Button>
    </form>
  );
}
