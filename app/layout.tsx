import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seams | Utility project coordination',
  description: 'Find nearby utility projects that can share work and resources.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
