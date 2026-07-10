import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { ExternalLinkHandler } from "./components/external_link_handler";
import { LicenseGate } from "./components/license_gate";
import { LicenseProvider } from "./context/license";
import { UpdateProvider } from "./context/update";
import "./globals.css";
import { SITE_URL, social } from "./seo";

const geistSans = localFont({
    src: "./fonts/GeistVF.woff",
    variable: "--font-geist-sans",
    weight: "100 900",
});
const geistMono = localFont({
    src: "./fonts/GeistMonoVF.woff",
    variable: "--font-geist-mono",
    weight: "100 900",
});
// Vendored (latin subset) so builds don't fetch from Google Fonts — required
// for sandboxed/offline builds like the Nix package, and keeps the app's
// no-external-services promise at build time too.
const dmSerifDisplay = localFont({
    src: "./fonts/DMSerifDisplay-Regular.woff2",
    weight: "400",
    variable: "--font-dm-serif",
    adjustFontFallback: "Times New Roman",
});

const SITE_TITLE = "CMMC | SP NIST 800-171 Rev 3";
const SITE_DESCRIPTION =
    "This application simplifies achieving NIST SP 800-171 Revision 3 compliance by providing a user-friendly interface to manage security controls, store data locally, and generate compliance summaries. ";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    applicationName: "CMMC",
    ...social({ title: SITE_TITLE, description: SITE_DESCRIPTION, path: "/" }),
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <head>
                <meta
                    httpEquiv="Content-Security-Policy"
                    content={process.env.NEXT_PUBLIC_CSP}
                />
                <Script id="service-worker">{`"serviceWorker" in navigator && navigator.serviceWorker.register("/sw.js", { scope: "/" });`}</Script>
            </head>
            <body
                className={`${geistSans.variable} ${geistMono.variable} ${dmSerifDisplay.variable} antialiased`}
            >
                <ExternalLinkHandler />
                <LicenseProvider>
                    <UpdateProvider>
                        <LicenseGate>{children}</LicenseGate>
                    </UpdateProvider>
                </LicenseProvider>
            </body>
        </html>
    );
}
