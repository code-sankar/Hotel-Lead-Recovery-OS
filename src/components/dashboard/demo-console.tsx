'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import {
  resetDemoDataAction,
  runDueFollowUpsAction,
  seedDemoDataAction,
  simulateInactivityAction,
  simulateInboundAction,
  type DemoResult,
} from '@/lib/demo/actions';

const SAMPLE_MESSAGES = [
  'Hi, do you have a room for 15 Sept for 2 people?',
  'room hai? price kya hai',
  'What is the price for a deluxe room?',
  'Yes, book it',
  'Can I pay by UPI?',
  'Is breakfast included?',
  'check in 2pm possible?',
  'Please stop messaging me',
];

export function DemoConsole({
  businessId,
  openLeads,
}: {
  businessId: string;
  openLeads: Array<{ id: string; conversationId: string; name: string; hasPendingFollowUp: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<Array<{ id: number; ok: boolean; text: string; detail?: string }>>([]);

  function run(action: (formData: FormData) => Promise<DemoResult>, formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      setLog((entries) => [
        {
          id: Date.now(),
          ok: result.ok,
          text: result.ok ? (result.message ?? 'Done.') : (result.error ?? 'That did not work.'),
          detail: result.detail,
        },
        ...entries.slice(0, 9),
      ]);
      if (result.ok) toast.success(result.message ?? 'Done.');
      else toast.error(result.error ?? 'That did not work.');
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Simulate an incoming WhatsApp message</CardTitle>
            <CardDescription>
              Runs the real pipeline: intent, entities, scoring, guardrails, reply and follow-up
              scheduling. Only the delivery to Meta is simulated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={(formData) => run(simulateInboundAction, formData)}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="businessId" value={businessId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Guest phone number" htmlFor="phoneNumber" hint="Digits only, with country code.">
                  <Input id="phoneNumber" name="phoneNumber" defaultValue="919810000199" required />
                </Field>
                <Field label="Guest name" htmlFor="name">
                  <Input id="name" name="name" defaultValue="Test Guest" />
                </Field>
              </div>
              <Field label="Message" htmlFor="text">
                <Textarea
                  id="text"
                  name="text"
                  rows={2}
                  required
                  defaultValue={SAMPLE_MESSAGES[0]}
                  placeholder="Hi, do you have a room for 15 Sept?"
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_MESSAGES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      const field = document.getElementById('text') as HTMLTextAreaElement | null;
                      if (field) field.value = sample;
                    }}
                    className="rounded-full border border-ink-200 px-2.5 py-1 text-[12px] text-ink-600 transition-colors hover:border-accent-200 hover:bg-accent-50 hover:text-accent-700"
                  >
                    {sample}
                  </button>
                ))}
              </div>
              <Button type="submit" disabled={pending} className="self-start">
                {pending ? 'Processing…' : 'Send simulated message'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Simulate the guest going quiet</CardTitle>
            <CardDescription>
              Rewinds an enquiry by 25 hours so its scheduled follow-up becomes due, then you can run
              the follow-up engine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {openLeads.length === 0 ? (
              <p className="text-[13px] text-ink-500">
                No open leads yet. Send a simulated enquiry first.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <form
                  action={(formData) => run(simulateInactivityAction, formData)}
                  className="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="businessId" value={businessId} />
                  <Field label="Enquiry" htmlFor="leadId" className="min-w-56 flex-1">
                    <Select id="leadId" name="leadId" required>
                      {openLeads.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.name}
                          {lead.hasPendingFollowUp ? ' · follow-up pending' : ' · no follow-up scheduled'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit" variant="secondary" disabled={pending}>
                    Rewind 25 hours
                  </Button>
                </form>

                <form action={(formData) => run(runDueFollowUpsAction, formData)}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Running…' : 'Run the follow-up engine now'}
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Demo data</CardTitle>
            <CardDescription>
              Twelve invented guests across every lead state, built by running the real pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form action={(formData) => run(seedDemoDataAction, formData)}>
              <input type="hidden" name="businessId" value={businessId} />
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? 'Seeding…' : 'Load demo hotel and conversations'}
              </Button>
            </form>
            <form action={(formData) => run(resetDemoDataAction, formData)}>
              <input type="hidden" name="businessId" value={businessId} />
              <Button type="submit" variant="secondary" disabled={pending} className="w-full">
                Delete all conversations and leads
              </Button>
            </form>
            <p className="text-[12px] text-ink-500">
              Seeding leaves your rooms, policies and FAQs alone if you have already added your own.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What just happened</CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-[13px] text-ink-500">Results of your demo actions appear here.</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {log.map((entry) => (
                  <li key={entry.id} className="border-l-2 pl-3" style={{ borderColor: entry.ok ? 'var(--color-money-600)' : 'var(--color-hot-600)' }}>
                    <p className="text-[13px] text-ink-800">{entry.text}</p>
                    {entry.detail ? <p className="mt-0.5 text-[12px] text-ink-500">{entry.detail}</p> : null}
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4 flex gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href="/conversations">Open the inbox</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/dashboard">See the dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
