import { requireBusiness } from '@/lib/auth/session';

/**
 * Inbox shell: the conversation list stays mounted on the left while the
 * selected thread renders on the right.
 */
export default async function ConversationsLayout({ children }: { children: React.ReactNode }) {
  await requireBusiness();
  return <div className="flex h-screen min-h-0">{children}</div>;
}
