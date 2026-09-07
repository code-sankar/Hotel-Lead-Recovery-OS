'use client';

import { useActionState, useEffect } from 'react';
import type { Room } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { emptyFormState } from '@/lib/forms/state';
import { deleteRoomAction, saveRoomAction } from '@/lib/settings/actions';
import { formatCurrency } from '@/lib/utils/format';
import { ListEditor } from './list-editor';

export function RoomsEditor({
  businessId,
  rooms,
  currency,
}: {
  businessId: string;
  rooms: Room[];
  currency: string;
}) {
  return (
    <ListEditor
      items={rooms}
      addLabel="Add a room type"
      emptyLabel="No room types yet. The assistant can only quote rooms and prices you add here."
      onDelete={async (id) => deleteRoomAction(businessId, id)}
      renderSummary={(room) => (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink-900">{room.name}</span>
            <span className="tabular text-sm text-ink-700">
              {formatCurrency(Number(room.base_price), currency)} / night
            </span>
            <Badge>Sleeps {room.max_guests}</Badge>
            {room.breakfast_included ? <Badge tone="money">Breakfast included</Badge> : null}
            {!room.active ? <Badge>Inactive</Badge> : null}
          </div>
          {room.description ? (
            <p className="mt-1 line-clamp-2 text-[13px] text-ink-500">{room.description}</p>
          ) : null}
        </div>
      )}
      renderForm={(room, onDone) => (
        <RoomForm businessId={businessId} room={room} currency={currency} onDone={onDone} />
      )}
    />
  );
}

function RoomForm({
  businessId,
  room,
  currency,
  onDone,
}: {
  businessId: string;
  room: Room | null;
  currency: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    saveRoomAction.bind(null, businessId),
    emptyFormState,
  );

  // Close the inline editor once the server action reports success.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {room ? <input type="hidden" name="id" value={room.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room name" htmlFor="name" error={state.fieldErrors?.name}>
          <Input id="name" name="name" defaultValue={room?.name ?? ''} placeholder="Deluxe Room" required />
        </Field>
        <Field
          label={`Base price per night (${currency})`}
          htmlFor="basePrice"
          error={state.fieldErrors?.basePrice}
        >
          <Input
            id="basePrice"
            name="basePrice"
            type="number"
            min={0}
            step={1}
            defaultValue={room ? Number(room.base_price) : ''}
            placeholder="2800"
            required
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="description" error={state.fieldErrors?.description}>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={room?.description ?? ''}
          placeholder="Queen bed, garden-facing, 220 sq ft."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Maximum guests" htmlFor="maxGuests" error={state.fieldErrors?.maxGuests}>
          <Input
            id="maxGuests"
            name="maxGuests"
            type="number"
            min={1}
            max={30}
            defaultValue={room?.max_guests ?? 2}
            required
          />
        </Field>
        <Field
          label="Amenities"
          htmlFor="amenities"
          hint="Comma separated."
          error={state.fieldErrors?.amenities}
        >
          <Input
            id="amenities"
            name="amenities"
            defaultValue={room?.amenities?.join(', ') ?? ''}
            placeholder="air conditioning, free Wi-Fi, TV"
          />
        </Field>
      </div>

      <Field label="Internal notes" htmlFor="notes" hint="Shown to the assistant as context.">
        <Input id="notes" name="notes" defaultValue={room?.notes ?? ''} />
      </Field>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input
            type="checkbox"
            name="breakfastIncluded"
            defaultChecked={room?.breakfast_included ?? false}
            className="size-4 rounded border-ink-300 accent-accent-600"
          />
          Breakfast included
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input
            type="checkbox"
            name="active"
            defaultChecked={room?.active ?? true}
            className="size-4 rounded border-ink-300 accent-accent-600"
          />
          Active
        </label>
      </div>

      {state.error ? <p className="text-[13px] text-hot-600">{state.error}</p> : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : room ? 'Update room' : 'Add room'}
        </Button>
      </div>
    </form>
  );
}
