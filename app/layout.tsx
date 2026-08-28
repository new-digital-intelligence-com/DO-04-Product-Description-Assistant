import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'DO-04 · Product Description Assistant',
  description: 'Raw product attributes in, grounded product descriptions out.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
