import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  // Usa env em produção; fallback para localhost em dev
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Bat Car',
  description: 'Aplicativo Next.js',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>{children}</body>
    </html>
  )
}