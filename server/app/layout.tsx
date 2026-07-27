import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agentic Wallet',
  description: 'EIP-2612 Permit-based wallet sessions for AI agents. Connect your wallet, sign a one-time permit, get a session token.',
  openGraph: {
    title: 'Agentic Wallet — EIP-2612 Permit Sessions for AI Agents',
    description: 'Connect your wallet, sign a one-time EIP-2612 permit, get a session token for MCP servers.',
    type: 'website',
    url: 'https://mcp-agentic-wallet.com',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Agentic Wallet — EIP-2612 Permit Sessions',
    description: 'Connect your wallet, sign a one-time permit, get a session token.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="description" content="EIP-2612 Permit-based wallet sessions for AI agents" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a', color: '#e0e0e0', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
