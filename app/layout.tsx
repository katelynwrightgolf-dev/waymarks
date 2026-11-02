import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { Fraunces, Nunito_Sans } from "next/font/google"
import { ServiceWorker } from "@/components/service-worker"
import "./globals.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
})

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Waymarks — Landmarks on the Road",
  description:
    "Find historic buildings and landmarks near you on the road, learn their story, and remember the ones you were just by.",
  generator: "v0.app",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Waymarks",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#8a3d24" },
    { media: "(prefers-color-scheme: dark)", color: "#231813" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${nunitoSans.variable}`}>
      <body className="bg-background font-sans antialiased">
        {children}
        <ServiceWorker />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
