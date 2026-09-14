'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { AvailabilitySnapshot } from '@/lib/availability/calculate';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { emptyFormState } from '@/lib/forms/state';
import { updateAvailabilityAction } from '@/lib/availability/actions';
import { cn } from '@/lib/utils/cn';

/**
 * Availability calendar.
 *
 * Rows are dates, columns are room types, because a hotelier reads a week down
 * the page. Each cell shows how many rooms are free that night and why — the
 * numbers are computed, not stored, so they already account for bookings.
 */

interface CellState {
  date: string;
  roomName: string;
  free: number;
  capacity: number;
  booked: number;
  closed: boolean;
}

function toneFor(cell: CellState): string {
  if (cell.closed) return 'bg-ink-200 text-ink-500';
  if (cell.free <= 0) return 'bg-hot-50 text-hot-700';
  if (cell.free <= Math.max(1, Math.floor(cell.capacity * 0.25))) return 'bg-warm-50 text-warm-700';
  return 'bg-money-50 text-money-700';
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function AvailabilityGrid({
  businessId,
  snapshot,
  from,
  days,
}: {
  businessId: string;
  snapshot: AvailabilitySnapshot;
  from: string;
  days: number;
}) {
  const dates = snapshot.rooms[0]?.nights.map((night) => night.date) ?? [];

  const previous = new Date(Date.parse(`${from}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const next = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/settings/availability?from=${previous}&days=${days}`}>← Earlier</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/settings/availability?days=${days}`}>Today</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/settings/availability?from=${next}&days=${days}`}>Later →</Link>
          </Button>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-ink-600">
          <Legend className="bg-money-50 text-money-700" label="Free" />
          <Legend className="bg-warm-50 text-warm-700" label="Nearly full" />
          <Legend className="bg-hot-50 text-hot-700" label="Sold out" />
          <Legend className="bg-ink-200 text-ink-500" label="Closed" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-ink-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/60">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Date
              </th>
              {snapshot.rooms.map((room) => (
                <th
                  key={room.roomId}
                  className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500"
                >
                  {room.roomName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {dates.map((date, index) => (
              <tr key={date}>
                <td className="whitespace-nowrap px-3 py-1.5 text-[13px] text-ink-700">
                  <span className="text-ink-400">{weekday(date)}</span> {dayLabel(date)}
                </td>
                {snapshot.rooms.map((room) => {
                  const night = room.nights[index];
                  if (!night) return <td key={room.roomId} className="px-3 py-1.5" />;
                  const cell: CellState = {
                    date,
                    roomName: room.roomName,
                    free: night.free,
                    capacity: night.capacity,
                    booked: night.booked,
                    closed: night.closed,
                  };
                  return (
                    <td key={room.roomId} className="px-3 py-1.5">
                      <span
                        title={
                          night.closed
                            ? 'Closed'
                            : `${night.free} free of ${night.capacity}${night.booked ? ` · ${night.booked} booked` : ''}`
                        }
                        className={cn(
                          'inline-flex min-w-11 items-center justify-center rounded px-2 py-0.5 text-[12px] font-medium tabular',
                          toneFor(cell),
                        )}
                      >
                        {night.closed ? 'closed' : night.free}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BulkEditor
        businessId={businessId}
        rooms={snapshot.rooms.map((room) => ({ id: room.roomId, name: room.roomName }))}
        defaultFrom={from}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn('size-3 rounded', className)} />
      {label}
    </span>
  );
}

function BulkEditor({
  businessId,
  rooms,
  defaultFrom,
}: {
  businessId: string;
  rooms: Array<{ id: string; name: string }>;
  defaultFrom: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateAvailabilityAction.bind(null, businessId),
    emptyFormState,
  );

  return (
    <form action={formAction} className="rounded-md border border-ink-200 bg-ink-50/50 px-4 py-4">
      <p className="text-[13px] font-medium text-ink-800">Change a date range</p>
      <p className="mt-0.5 text-[13px] text-ink-500">
        You only record exceptions. Anything you do not change uses the room type&rsquo;s own room
        count, minus whatever is booked.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Room type" htmlFor="roomId">
          <Select id="roomId" name="roomId" defaultValue="all">
            <option value="all">All room types</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="from" error={state.fieldErrors?.from}>
          <Input id="from" name="from" type="date" defaultValue={defaultFrom} required />
        </Field>
        <Field label="To (inclusive)" htmlFor="to" error={state.fieldErrors?.to}>
          <Input id="to" name="to" type="date" defaultValue={defaultFrom} required />
        </Field>
        <Field label="Change" htmlFor="action">
          <Select id="action" name="action" defaultValue="close">
            <option value="close">Close these dates</option>
            <option value="set_units">Set rooms available</option>
            <option value="open">Reopen at the default count</option>
            <option value="clear">Clear my overrides</option>
          </Select>
        </Field>
        <Field
          label="Rooms available"
          htmlFor="units"
          hint="Used by “Set rooms available”."
          error={state.fieldErrors?.units}
        >
          <Input id="units" name="units" type="number" min={0} max={500} placeholder="0" />
        </Field>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Applying…' : 'Apply change'}
        </Button>
        {state.ok && state.message ? (
          <span role="status" className="text-[13px] text-money-700">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
