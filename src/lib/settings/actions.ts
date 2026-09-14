'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import { createServerSupabase } from '@/lib/db/server-client';
import { createServiceSupabase } from '@/lib/db/service-client';
import { ACTIVE_BUSINESS_COOKIE, assertCapabilityFor, requireSession } from '@/lib/auth/session';
import { fieldErrorsOf, type FormState } from '@/lib/forms/state';
import {
  aiSettingsSchema,
  businessGeneralSchema,
  createBusinessSchema,
  faqSchema,
  followUpRuleSchema,
  followUpSettingsSchema,
  hotelProfileSchema,
  policySchema,
  roomSchema,
  whatsappSettingsSchema,
} from '@/lib/validation/schemas';

/**
 * Hotel configuration actions.
 *
 * Every action re-derives the caller's membership and capability from the
 * session — a business id arriving in a form field is never trusted on its own.
 */

function invalid(error: z.ZodError): FormState {
  return { ok: false, fieldErrors: fieldErrorsOf(error) };
}

function failure(message: string): FormState {
  return { ok: false, error: message };
}

function success(message: string): FormState {
  return { ok: true, message };
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : undefined;
}

function listOf(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function checkbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === 'on' || value === 'true';
}

// ---------------------------------------------------------------------------
// Hotel creation & onboarding
// ---------------------------------------------------------------------------

export async function createBusinessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = createBusinessSchema.safeParse({
    name: formData.get('name'),
    timezone: formData.get('timezone') ?? 'Asia/Kolkata',
    currency: formData.get('currency') ?? 'INR',
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('create_business_with_owner', {
    business_name: parsed.data.name,
    business_timezone: parsed.data.timezone,
    business_currency: parsed.data.currency,
  });
  if (error) return failure(error.message);

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, String(data), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  redirect('/onboarding/hotel');
}

export async function completeOnboardingAction(businessId: string): Promise<void> {
  await assertCapabilityFor(businessId, 'business:manage');
  const supabase = await createServerSupabase();
  await supabase
    .from('businesses')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', businessId);
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// General & hotel profile
// ---------------------------------------------------------------------------

export async function updateBusinessGeneralAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'business:manage');
  const parsed = businessGeneralSchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address'),
    city: formData.get('city'),
    state: formData.get('state'),
    phone: formData.get('phone'),
    website: formData.get('website'),
    timezone: formData.get('timezone'),
    currency: formData.get('currency'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('businesses')
    .update({
      name: parsed.data.name,
      address: parsed.data.address || null,
      city: parsed.data.city || null,
      state: parsed.data.state || null,
      phone: parsed.data.phone || null,
      website: parsed.data.website || null,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
    })
    .eq('id', businessId);

  if (error) return failure(error.message);
  revalidatePath('/', 'layout');
  return success('Hotel details saved.');
}

export async function updateHotelProfileAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const parsed = hotelProfileSchema.safeParse({
    description: formData.get('description'),
    locationNote: formData.get('locationNote'),
    landmarks: formData.get('landmarks'),
    checkInTime: formData.get('checkInTime'),
    checkOutTime: formData.get('checkOutTime'),
    amenities: listOf(formData.get('amenities')),
    receptionHours: formData.get('receptionHours'),
    restaurantHours: formData.get('restaurantHours'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('business_profiles').upsert(
    {
      business_id: businessId,
      description: parsed.data.description || null,
      location_note: parsed.data.locationNote || null,
      landmarks: parsed.data.landmarks || null,
      check_in_time: parsed.data.checkInTime || null,
      check_out_time: parsed.data.checkOutTime || null,
      amenities: parsed.data.amenities,
      business_hours: {
        reception: parsed.data.receptionHours || null,
        restaurant: parsed.data.restaurantHours || null,
      },
    },
    { onConflict: 'business_id' },
  );

  if (error) return failure(error.message);
  revalidatePath('/settings/hotel');
  return success('Hotel information saved.');
}

// ---------------------------------------------------------------------------
// Rooms, policies, FAQs — the AI's factual source of truth
// ---------------------------------------------------------------------------

export async function saveRoomAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const parsed = roomSchema.safeParse({
    id: optional(formData.get('id')),
    name: formData.get('name'),
    description: formData.get('description'),
    basePrice: formData.get('basePrice'),
    maxGuests: formData.get('maxGuests'),
    totalUnits: formData.get('totalUnits'),
    amenities: listOf(formData.get('amenities')),
    breakfastIncluded: checkbox(formData, 'breakfastIncluded'),
    notes: formData.get('notes'),
    active: !formData.has('active') || checkbox(formData, 'active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const payload = {
    business_id: businessId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    base_price: parsed.data.basePrice,
    max_guests: parsed.data.maxGuests,
    total_units: parsed.data.totalUnits,
    amenities: parsed.data.amenities,
    breakfast_included: parsed.data.breakfastIncluded,
    notes: parsed.data.notes || null,
    active: parsed.data.active,
  };

  const { error } = parsed.data.id
    ? await supabase.from('rooms').update(payload).eq('id', parsed.data.id).eq('business_id', businessId)
    : await supabase.from('rooms').insert(payload);

  if (error) return failure(error.message);
  revalidatePath('/settings/rooms');
  revalidatePath('/settings/availability');
  revalidatePath('/onboarding/rooms');
  return success(parsed.data.id ? 'Room updated.' : 'Room added.');
}

export async function deleteRoomAction(businessId: string, roomId: string): Promise<void> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const supabase = await createServerSupabase();
  await supabase.from('rooms').delete().eq('id', roomId).eq('business_id', businessId);
  revalidatePath('/settings/rooms');
  revalidatePath('/onboarding/rooms');
}

export async function savePolicyAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const parsed = policySchema.safeParse({
    id: optional(formData.get('id')),
    type: formData.get('type'),
    title: formData.get('title'),
    content: formData.get('content'),
    active: !formData.has('active') || checkbox(formData, 'active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const payload = {
    business_id: businessId,
    type: parsed.data.type,
    title: parsed.data.title || null,
    content: parsed.data.content,
    active: parsed.data.active,
  };

  const { error } = parsed.data.id
    ? await supabase
        .from('hotel_policies')
        .update(payload)
        .eq('id', parsed.data.id)
        .eq('business_id', businessId)
    : await supabase.from('hotel_policies').insert(payload);

  if (error) return failure(error.message);
  revalidatePath('/settings/policies');
  revalidatePath('/onboarding/policies');
  return success(parsed.data.id ? 'Policy updated.' : 'Policy added.');
}

export async function deletePolicyAction(businessId: string, policyId: string): Promise<void> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const supabase = await createServerSupabase();
  await supabase.from('hotel_policies').delete().eq('id', policyId).eq('business_id', businessId);
  revalidatePath('/settings/policies');
  revalidatePath('/onboarding/policies');
}

export async function saveFaqAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const parsed = faqSchema.safeParse({
    id: optional(formData.get('id')),
    question: formData.get('question'),
    answer: formData.get('answer'),
    active: !formData.has('active') || checkbox(formData, 'active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const payload = {
    business_id: businessId,
    question: parsed.data.question,
    answer: parsed.data.answer,
    active: parsed.data.active,
  };

  const { error } = parsed.data.id
    ? await supabase.from('hotel_faqs').update(payload).eq('id', parsed.data.id).eq('business_id', businessId)
    : await supabase.from('hotel_faqs').insert(payload);

  if (error) return failure(error.message);
  revalidatePath('/settings/faqs');
  revalidatePath('/onboarding/faqs');
  return success(parsed.data.id ? 'FAQ updated.' : 'FAQ added.');
}

export async function deleteFaqAction(businessId: string, faqId: string): Promise<void> {
  await assertCapabilityFor(businessId, 'hotel_content:manage');
  const supabase = await createServerSupabase();
  await supabase.from('hotel_faqs').delete().eq('id', faqId).eq('business_id', businessId);
  revalidatePath('/settings/faqs');
  revalidatePath('/onboarding/faqs');
}

// ---------------------------------------------------------------------------
// Assistant & follow-up settings
// ---------------------------------------------------------------------------

export async function updateAiSettingsAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'business:manage');
  const parsed = aiSettingsSchema.safeParse({
    aiEnabled: checkbox(formData, 'aiEnabled'),
    aiTone: formData.get('aiTone'),
    aiWelcomeMessage: formData.get('aiWelcomeMessage'),
    aiEscalationMessage: formData.get('aiEscalationMessage'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('business_settings')
    .update({
      ai_enabled: parsed.data.aiEnabled,
      ai_tone: parsed.data.aiTone,
      ai_welcome_message: parsed.data.aiWelcomeMessage || null,
      ai_escalation_message: parsed.data.aiEscalationMessage,
    })
    .eq('business_id', businessId);

  if (error) return failure(error.message);
  revalidatePath('/settings/ai');
  return success('Assistant settings saved.');
}

export async function updateFollowUpSettingsAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'follow_up_rules:manage');
  const quietStart = optional(formData.get('quietHoursStart'));
  const quietEnd = optional(formData.get('quietHoursEnd'));

  const parsed = followUpSettingsSchema.safeParse({
    followUpsEnabled: checkbox(formData, 'followUpsEnabled'),
    maxFollowUps: formData.get('maxFollowUps'),
    quietHoursStart: quietStart ?? null,
    quietHoursEnd: quietEnd ?? null,
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('business_settings')
    .update({
      follow_ups_enabled: parsed.data.followUpsEnabled,
      max_follow_ups: parsed.data.maxFollowUps,
      quiet_hours_start: parsed.data.quietHoursStart,
      quiet_hours_end: parsed.data.quietHoursEnd,
    })
    .eq('business_id', businessId);

  if (error) return failure(error.message);
  revalidatePath('/settings/follow-ups');
  return success('Follow-up settings saved.');
}

export async function updateFollowUpRuleAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'follow_up_rules:manage');
  const parsed = followUpRuleSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    delayMinutes: formData.get('delayMinutes'),
    messageTemplate: formData.get('messageTemplate'),
    active: checkbox(formData, 'active'),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('follow_up_rules')
    .update({
      name: parsed.data.name,
      delay_minutes: parsed.data.delayMinutes,
      message_template: parsed.data.messageTemplate,
      active: parsed.data.active,
    })
    .eq('id', parsed.data.id)
    .eq('business_id', businessId);

  if (error) return failure(error.message);
  revalidatePath('/settings/follow-ups');
  return success('Rule saved.');
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * Credentials are written with the service role because the
 * whatsapp_integrations table is fully denied to `authenticated` — the browser
 * must never be able to read a token back. Ownership is verified first.
 */
export async function updateWhatsAppSettingsAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'whatsapp:manage');
  const parsed = whatsappSettingsSchema.safeParse({
    phoneNumberId: formData.get('phoneNumberId'),
    displayPhoneNumber: formData.get('displayPhoneNumber'),
    wabaId: formData.get('wabaId'),
    accessToken: formData.get('accessToken'),
    appSecret: formData.get('appSecret'),
    verifyToken: formData.get('verifyToken'),
    messagingMode: formData.get('messagingMode'),
  });
  if (!parsed.success) return invalid(parsed.error);

  let service;
  try {
    service = createServiceSupabase();
  } catch {
    return failure(
      'SUPABASE_SERVICE_ROLE_KEY is not configured, so WhatsApp credentials cannot be stored.',
    );
  }

  const { data: existing } = await service
    .from('whatsapp_integrations')
    .select('phone_number_id, access_token, app_secret, verify_token')
    .eq('business_id', businessId)
    .maybeSingle();

  // Blank secret fields mean "leave what is stored" — the UI never shows them back.
  const patch: Record<string, unknown> = {
    business_id: businessId,
    phone_number_id: parsed.data.phoneNumberId || existing?.phone_number_id || null,
    display_phone_number: parsed.data.displayPhoneNumber || null,
    waba_id: parsed.data.wabaId || null,
    access_token: parsed.data.accessToken || existing?.access_token || null,
    app_secret: parsed.data.appSecret || existing?.app_secret || null,
    verify_token: parsed.data.verifyToken || existing?.verify_token || null,
  };
  patch.status =
    patch.access_token && patch.phone_number_id && patch.verify_token ? 'configured' : 'not_configured';

  const { error } = await service
    .from('whatsapp_integrations')
    .upsert(patch, { onConflict: 'business_id' });
  if (error) return failure(error.message);

  if (parsed.data.messagingMode === 'live' && patch.status !== 'configured') {
    return failure(
      'Add the phone number ID, access token and verify token before switching to live mode.',
    );
  }

  const { error: modeError } = await service
    .from('businesses')
    .update({ messaging_mode: parsed.data.messagingMode })
    .eq('id', businessId);
  if (modeError) return failure(modeError.message);

  revalidatePath('/settings/whatsapp');
  revalidatePath('/', 'layout');
  return success(
    parsed.data.messagingMode === 'live'
      ? 'WhatsApp settings saved. This hotel now sends through the Meta Cloud API.'
      : 'WhatsApp settings saved. This hotel stays in demo mode.',
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function updateMemberRoleAction(
  businessId: string,
  userId: string,
  role: 'owner' | 'manager' | 'staff',
): Promise<void> {
  const context = await assertCapabilityFor(businessId, 'staff:manage');
  if (userId === context.user.id) {
    throw new Error('You cannot change your own role.');
  }
  const supabase = await createServerSupabase();
  await supabase
    .from('business_members')
    .update({ role })
    .eq('business_id', businessId)
    .eq('user_id', userId);
  revalidatePath('/settings/team');
}

export async function removeMemberAction(businessId: string, userId: string): Promise<void> {
  const context = await assertCapabilityFor(businessId, 'staff:manage');
  if (userId === context.user.id) {
    throw new Error('You cannot remove yourself from the hotel.');
  }
  const supabase = await createServerSupabase();
  await supabase
    .from('business_members')
    .delete()
    .eq('business_id', businessId)
    .eq('user_id', userId);
  revalidatePath('/settings/team');
}
