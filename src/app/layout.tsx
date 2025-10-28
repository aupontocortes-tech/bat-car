import type { Metadata } from 'next'
import './globals.css'
import SwCleanup from '../components/SwCleanup'
import ErrorOverlay from '../components/ErrorOverlay'

export const metadata: Metadata = {
  // Usa env em produção; fallback para localhost em dev
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'Bat Car',
  description: 'Aplicativo Next.js',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>
        <SwCleanup />
        <ErrorOverlay />
        {children}
      </body>
    </html>
  )
}