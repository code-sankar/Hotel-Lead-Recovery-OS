import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking, RoomAvailability } from '@/types/domain';
import type { Store } from './store';

/**
 * The read slice of the Store backed by the signed-in user's session.
 *
 * The availability calculator takes a `Store`, but the settings page must read
 * as the user so Row Level Security applies. Rather than widen the page to the
 * service role, this exposes only the two reads the calculator needs and throws
 * loudly on anything else, so it can never be mistaken for a full store.
 */
export function storeForBusiness(client: SupabaseClient): Store {
  const unsupported = (method: string) => () => {
    throw new Error(
      `${method} is not available on the session-scoped store; use the service store instead.`,
    );
  };

  const reads = {
    async listRoomAvailability(
      businessId: string,
      from: string,
      to: string,
    ): Promise<RoomAvailability[]> {
      const { data, error } = await client
        .from('room_availability')
        .select('*')
        .eq('business_id', businessId)
        .gte('date', from)
        .lt('date', to);
      if (error) throw new Error(`Could not load availability: ${error.message}`);
      return (data ?? []) as RoomAvailability[];
    },

    async listBookings(businessId: string, from: string, to: string): Promise<Booking[]> {
      const { data, error } = await client
        .from('bookings')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'confirmed')
        .lt('check_in', to)
        .gt('check_out', from);
      if (error) throw new Error(`Could not load bookings: ${error.message}`);
      return (data ?? []) as Booking[];
    },
  };

  return new Proxy(reads as unknown as Store, {
    get(target, property: string) {
      if (property in reads) return reads[property as keyof typeof reads];
      return unsupported(property);
    },
  });
}
