import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Hotel Lead Recovery OS',
    template: '%s · Hotel Lead Recovery OS',
  },
  description:
    'Capture WhatsApp hotel enquiries, follow up automatically, and see the revenue you recover.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
