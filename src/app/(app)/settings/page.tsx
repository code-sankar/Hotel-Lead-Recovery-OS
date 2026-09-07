import { redirect } from 'next/navigation';
import { requireBusiness } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';

export default async function SettingsIndexPage() {
  const { active } = await requireBusiness();
  redirect(can(active.role, 'hotel_content:manage') ? '/settings/hotel' : '/settings/profile');
}
