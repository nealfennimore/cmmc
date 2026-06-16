import type { MetadataRoute } from "next";
export const dynamic = "force-static";
const URL = "https://app.getcmmc.consulting";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
        },
        sitemap: `${URL}/sitemap.xml`,
        host: URL,
    };
}
