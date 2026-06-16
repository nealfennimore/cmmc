import type { Metadata } from "next";
import { DM_Serif_Display } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

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
const dmSerifDisplay = DM_Serif_Display({
    subsets: ["latin"],
    weight: "400",
    variable: "--font-dm-serif",
});

export const metadata: Metadata = {
    title: "CMMC | SP NIST 800-171 Rev 3",
    description:
        "This application simplifies achieving NIST SP 800-171 Revision 3 compliance by providing a user-friendly interface to manage security controls, store data locally, and generate compliance summaries. ",
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
                {children}
            </body>
        </html>
    );
}
