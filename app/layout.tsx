import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZianeComms — Urgent people first. Nobody forgotten.',
  description: 'Unified communications and human-led response. Civilian, responder and command experiences on one explainable platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
