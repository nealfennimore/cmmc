import type { Metadata } from "next";

export const SITE_URL = "https://app.getcmmc.consulting";
export const SITE_NAME = "CMMC";

const OG_IMAGE = {
    url: "/web-app-manifest-512x512.png",
    width: 512,
    height: 512,
    alt: "CMMC | SP NIST 800-171",
};

type SocialOptions = {
    title?: string;
    description?: string;
    /** Site-root-relative path, e.g. "/r3/requirement/03.01.01". */
    path?: string;
};

/**
 * Build the canonical / Open Graph / Twitter block for a page.
 *
 * Next.js merges metadata shallowly, so a page that sets `openGraph` replaces
 * the layout's defaults wholesale (dropping the shared image, site name, etc.).
 * Returning the full block from one place keeps every page's social card and
 * canonical URL complete and consistent.
 */
export function social({ title, description, path }: SocialOptions): Metadata {
    const url = path ?? "/";
    return {
        alternates: {
            canonical: url,
        },
        openGraph: {
            type: "website",
            siteName: SITE_NAME,
            title,
            description,
            url,
            images: [OG_IMAGE],
        },
        twitter: {
            card: "summary",
            title,
            description,
            images: [OG_IMAGE.url],
        },
    };
}
