import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { Inter, Courier_Prime } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/AuthContext"
import ClientOnlyWrapper from "@/components/ClientOnlyWrapper"
import GlobalChunkGuard from "@/components/GlobalChunkGuard"
import { LayoutWithBanner } from "@/components/LayoutWithBanner"

const inter = Inter({ subsets: ["latin"] })
const courierPrime = Courier_Prime({
  weight: ['400', '700'],
  subsets: ["latin"],
  variable: '--font-courier-prime'
})

export const metadata: Metadata = {
  title: "WritersRoom",
  description: "Professional screenwriting meets AI assistance",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${courierPrime.variable}`}>
        {/* Global guard for chunk load errors and auto-retry */}
        <GlobalChunkGuard />
        <ClientOnlyWrapper fallback={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
          <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
            <AuthProvider>
              <LayoutWithBanner>
                {children}
              </LayoutWithBanner>
            </AuthProvider>
          </Suspense>
        </ClientOnlyWrapper>
      </body>
    </html>
  )
}
