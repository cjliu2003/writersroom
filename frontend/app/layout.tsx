import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/AuthContext"
import ClientOnlyWrapper from "@/components/ClientOnlyWrapper"
import GlobalChunkGuard from "@/components/GlobalChunkGuard"

const inter = Inter({ subsets: ["latin"] })

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
      <body className={inter.className}>
        {/* Global guard for chunk load errors and auto-retry */}
        <GlobalChunkGuard />
        <ClientOnlyWrapper fallback={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
          <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
            <AuthProvider>
              {children}
            </AuthProvider>
          </Suspense>
        </ClientOnlyWrapper>
      </body>
    </html>
  )
}
