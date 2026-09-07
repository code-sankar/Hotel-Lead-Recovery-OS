'use client';

import type { Business, BusinessProfile } from '@/types/domain';
import { Field, Input, Textarea } from '@/components/ui/input';
import { updateBusinessGeneralAction, updateHotelProfileAction } from '@/lib/settings/actions';
import { SettingsForm } from './settings-form';
import { SettingsSection } from './settings-section';

export function HotelContactForm({ business }: { business: Business }) {
  return (
    <SettingsSection title="Contact details" description="Where the hotel is and how guests reach it.">
      <SettingsForm action={updateBusinessGeneralAction.bind(null, business.id)}>
        {(errors) => (
          <>
            <Field label="Hotel name" htmlFor="name" error={errors.name}>
              <Input id="name" name="name" defaultValue={business.name} required />
            </Field>
            <Field label="Address" htmlFor="address" error={errors.address}>
              <Input id="address" name="address" defaultValue={business.address ?? ''} placeholder="Mancotta Road" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City" htmlFor="city" error={errors.city}>
                <Input id="city" name="city" defaultValue={business.city ?? ''} />
              </Field>
              <Field label="State" htmlFor="state" error={errors.state}>
                <Input id="state" name="state" defaultValue={business.state ?? ''} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reception phone" htmlFor="phone" error={errors.phone}>
                <Input id="phone" name="phone" defaultValue={business.phone ?? ''} placeholder="+91 373 230 0100" />
              </Field>
              <Field label="Website" htmlFor="website" error={errors.website}>
                <Input id="website" name="website" defaultValue={business.website ?? ''} placeholder="https://" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone" htmlFor="timezone" error={errors.timezone}>
                <Input id="timezone" name="timezone" defaultValue={business.timezone} required />
              </Field>
              <Field label="Currency" htmlFor="currency" error={errors.currency}>
                <Input id="currency" name="currency" defaultValue={business.currency} maxLength={3} required />
              </Field>
            </div>
          </>
        )}
      </SettingsForm>
    </SettingsSection>
  );
}

export function HotelProfileForm({
  businessId,
  profile,
}: {
  businessId: string;
  profile: BusinessProfile | null;
}) {
  const hours = (profile?.business_hours ?? {}) as { reception?: string; restaurant?: string };

  return (
    <SettingsSection
      title="Hotel information"
      description="The assistant answers from this. Anything not written here, it will not claim."
    >
      <SettingsForm action={updateHotelProfileAction.bind(null, businessId)}>
        {(errors) => (
          <>
            <Field
              label="About the hotel"
              htmlFor="description"
              hint="A short, factual description."
              error={errors.description}
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={profile?.description ?? ''}
                placeholder="A 24-room riverside property, 15 minutes from the town centre."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Check-in time" htmlFor="checkInTime" error={errors.checkInTime}>
                <Input id="checkInTime" name="checkInTime" defaultValue={profile?.check_in_time ?? ''} placeholder="12:00 PM" />
              </Field>
              <Field label="Check-out time" htmlFor="checkOutTime" error={errors.checkOutTime}>
                <Input id="checkOutTime" name="checkOutTime" defaultValue={profile?.check_out_time ?? ''} placeholder="11:00 AM" />
              </Field>
            </div>

            <Field
              label="Hotel amenities"
              htmlFor="amenities"
              hint="Comma separated. The assistant may only mention what is listed here."
              error={errors.amenities}
            >
              <Input
                id="amenities"
                name="amenities"
                defaultValue={profile?.amenities?.join(', ') ?? ''}
                placeholder="free Wi-Fi, free parking, in-house restaurant"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reception hours" htmlFor="receptionHours">
                <Input id="receptionHours" name="receptionHours" defaultValue={hours.reception ?? ''} placeholder="24 hours" />
              </Field>
              <Field label="Restaurant hours" htmlFor="restaurantHours">
                <Input
                  id="restaurantHours"
                  name="restaurantHours"
                  defaultValue={hours.restaurant ?? ''}
                  placeholder="7:00 AM – 10:30 PM"
                />
              </Field>
            </div>

            <Field label="Location notes" htmlFor="locationNote" error={errors.locationNote}>
              <Input
                id="locationNote"
                name="locationNote"
                defaultValue={profile?.location_note ?? ''}
                placeholder="A short drive from the river ghat and the railway station."
              />
            </Field>

            <Field label="Nearby landmarks and distances" htmlFor="landmarks" error={errors.landmarks}>
              <Input
                id="landmarks"
                name="landmarks"
                defaultValue={profile?.landmarks ?? ''}
                placeholder="Airport 40 minutes; railway station 4 km."
              />
            </Field>
          </>
        )}
      </SettingsForm>
    </SettingsSection>
  );
}
