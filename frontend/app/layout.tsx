import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { Inter, Courier_Prime } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/AuthContext"
import ClientOnlyWrapper from "@/components/ClientOnlyWrapper"
import GlobalChunkGuard from "@/components/GlobalChunkGuard"

const inter = Inter({ subsets: ["latin"] })
const courierPrime = Courier_Prime({
  weight: ['400', '700'],
  style: ['normal', 'italic'],  // Load all variants to prevent faux synthesis
  subsets: ["latin"],
  variable: '--font-courier-prime'
})

export const metadata: Metadata = {
  title: "WritersRoom",
  description: "Professional screenwriting meets AI assistance",
  icons: {
    icon: '/favicon.png',
  },
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
        <ClientOnlyWrapper fallback={
          <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-black flex items-center justify-center">
            <div className="flex flex-col items-center px-8 py-24 sm:py-32">
              {/* Icon with glow - matching ProcessingScreen exactly */}
              <div className="relative mb-10">
                <div
                  className="absolute inset-0 rounded-2xl bg-purple-100/60 dark:bg-purple-900/20 blur-xl opacity-60"
                  style={{ animation: 'gentlePulse 3s ease-in-out infinite' }}
                />
                <div className="relative w-24 h-24 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center backdrop-blur-xl border border-purple-200/50 dark:border-purple-800/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
                  <svg
                    className="w-12 h-12 text-purple-600 dark:text-purple-400 drop-shadow-[0_0_8px_rgba(147,51,234,0.25)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                    style={{ animation: 'gentleFloat 3s ease-in-out infinite' }}
                  >
                    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
                    <path d="m6.2 5.3 3.1 3.9" />
                    <path d="m12.4 3.4 3.1 4" />
                    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                </div>
              </div>
              {/* Text content - matching ProcessingScreen typography */}
              <div className="text-center space-y-3 max-w-md">
                <h1
                  className="text-2xl md:text-3xl font-normal tracking-wide text-gray-800 dark:text-gray-100"
                  style={{ letterSpacing: '0.05em', animation: 'fadeInUp 0.6s ease-out' }}
                >
                  Initializing WritersRoom
                </h1>
                <p
                  className="text-sm md:text-base text-gray-500 dark:text-gray-400 font-light tracking-wider lowercase"
                  style={{ letterSpacing: '0.08em', animation: 'fadeInUp 0.8s ease-out', fontFamily: 'var(--font-courier-prime), "Courier New", monospace' }}
                >
                  preparing your creative workspace…
                </p>
              </div>
            </div>
          </div>
        }>
          <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-black flex items-center justify-center">
              <div className="flex flex-col items-center px-8 py-24 sm:py-32">
                {/* Icon with glow - matching ProcessingScreen exactly */}
                <div className="relative mb-10">
                  <div
                    className="absolute inset-0 rounded-2xl bg-purple-100/60 dark:bg-purple-900/20 blur-xl opacity-60"
                    style={{ animation: 'gentlePulse 3s ease-in-out infinite' }}
                  />
                  <div className="relative w-24 h-24 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center backdrop-blur-xl border border-purple-200/50 dark:border-purple-800/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
                    <svg
                      className="w-12 h-12 text-purple-600 dark:text-purple-400 drop-shadow-[0_0_8px_rgba(147,51,234,0.25)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      viewBox="0 0 24 24"
                      style={{ animation: 'gentleFloat 3s ease-in-out infinite' }}
                    >
                      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
                      <path d="m6.2 5.3 3.1 3.9" />
                      <path d="m12.4 3.4 3.1 4" />
                      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                    </svg>
                  </div>
                </div>
                {/* Text content - matching ProcessingScreen typography */}
                <div className="text-center space-y-3 max-w-md">
                  <h1
                    className="text-2xl md:text-3xl font-normal tracking-wide text-gray-800 dark:text-gray-100"
                    style={{ letterSpacing: '0.05em', animation: 'fadeInUp 0.6s ease-out' }}
                  >
                    Initializing WritersRoom
                  </h1>
                  <p
                    className="text-sm md:text-base text-gray-500 dark:text-gray-400 font-light tracking-wider lowercase"
                    style={{ letterSpacing: '0.08em', animation: 'fadeInUp 0.8s ease-out', fontFamily: 'var(--font-courier-prime), "Courier New", monospace' }}
                  >
                    preparing your creative workspace…
                  </p>
                </div>
              </div>
            </div>
          }>
            <AuthProvider>
              {children}
            </AuthProvider>
          </Suspense>
        </ClientOnlyWrapper>
      </body>
    </html>
  )
}
