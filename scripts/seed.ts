/**
 * Seeds the demo hotel — "Riverfront Residency", Dibrugarh — together with a
 * set of invented guests spanning every lead state.
 *
 * Usage:
 *   npm run db:seed -- --email you@example.com
 *   npm run db:seed -- --business <uuid>
 *
 * Conversations are produced by running the real inbound pipeline, so what you
 * see in the app is what the code actually does. Messages are stored as
 * `simulated`: nothing is sent through WhatsApp.
 */
import './env';
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env';
import { DEMO_HOTEL } from '@/lib/demo/data';
import { seedDemoBusiness } from '@/lib/demo/seed';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let businessId = argValue('--business');
  const email = argValue('--email') ?? process.env.SEED_USER_EMAIL;

  if (!businessId) {
    if (!email) {
      console.error(
        'Pass --email <your signup email> so the demo hotel can be attached to your account,\n' +
          'or --business <uuid> to seed an existing hotel.',
      );
      process.exit(1);
    }

    const { data: users, error: usersError } = await client.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) throw usersError;
    const user = users.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.error(`No account found for ${email}. Sign up in the app first, then run this again.`);
      process.exit(1);
    }

    const { data: existing } = await client
      .from('business_members')
      .select('business_id, businesses(name, is_demo)')
      .eq('user_id', user.id);

    type MembershipRow = {
      business_id: string;
      businesses: { name: string; is_demo: boolean } | { name: string; is_demo: boolean }[] | null;
    };
    const demoMembership = ((existing ?? []) as unknown as MembershipRow[]).find((row) => {
      const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
      return business?.is_demo === true;
    });

    if (demoMembership) {
      businessId = demoMembership.business_id;
      console.log(`Reusing existing demo hotel ${businessId}`);
    } else {
      const { data: business, error } = await client
        .from('businesses')
        .insert({
          name: DEMO_HOTEL.name,
          timezone: DEMO_HOTEL.timezone,
          currency: DEMO_HOTEL.currency,
          is_demo: true,
          messaging_mode: 'demo',
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error) throw error;

      businessId = business.id as string;

      await client.from('business_members').insert({
        business_id: businessId,
        user_id: user.id,
        role: 'owner',
      });
      await client.from('business_profiles').insert({ business_id: businessId });
      await client.from('business_settings').insert({ business_id: businessId });
      await client.from('whatsapp_integrations').insert({ business_id: businessId });
      await client.rpc('seed_default_follow_up_rules', { target_business_id: businessId });
      await client.rpc('seed_default_whatsapp_templates', { target_business_id: businessId });

      console.log(`Created demo hotel "${DEMO_HOTEL.name}" (${businessId}) owned by ${email}`);
    }
  }

  console.log('Seeding hotel information and demo conversations…');
  const result = await seedDemoBusiness(client, businessId, { useRulesEngine: true });

  console.log('');
  console.log('Done.');
  console.log(
    `  Hotel content : ${result.hotelContent.rooms} rooms, ${result.hotelContent.policies} policies, ${result.hotelContent.faqs} FAQs`,
  );
  console.log(`  Guests        : ${result.customers}`);
  console.log(`  Conversations : ${result.conversations}`);
  console.log(`  Follow-ups    : ${result.followUpsSent} sent`);
  console.log(`  Conversions   : ${result.conversions}`);
  console.log('');
  console.log(`  Business id   : ${businessId}`);
  console.log('  Open the app and sign in to see the dashboard.');
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
