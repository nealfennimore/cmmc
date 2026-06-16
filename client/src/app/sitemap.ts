import * as Framework from "@/api/entities/Framework";
import type { MetadataRoute } from "next";
export const dynamic = "force-static";
const URL = "https://app.getcmmc.consulting";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const manifestV3 = Framework.manifestV3;
    const manifestV2 = Framework.manifestV2;

    return [
        {
            url: URL,
            lastModified: new Date().toISOString(),
            priority: 1,
        },
        {
            url: `${URL}/r3`,
            lastModified: new Date().toISOString(),
            priority: 1,
        },
        {
            url: `${URL}/r3/evidence`,
            lastModified: new Date().toISOString(),
            priority: 0.5,
        },
        ...manifestV3.families.elements.map((element) => ({
            url: `${URL}/r3/family/${element.element_identifier}`,
            lastModified: new Date().toISOString(),
            priority: 0.9,
        })),
        ...manifestV3.requirements.elements.map((element) => ({
            url: `${URL}/r3/requirement/${element.element_identifier}`,
            lastModified: new Date().toISOString(),
            priority: 0.7,
        })),
        {
            url: `${URL}/r2`,
            lastModified: new Date().toISOString(),
            priority: 1,
        },
        {
            url: `${URL}/r2/evidence`,
            lastModified: new Date().toISOString(),
            priority: 0.5,
        },
        ...manifestV2.families.elements.map((element) => ({
            url: `${URL}/r2/family/${element.element_identifier}`,
            lastModified: new Date().toISOString(),
            priority: 0.9,
        })),
        ...manifestV2.requirements.elements.map((element) => ({
            url: `${URL}/r2/requirement/${element.element_identifier}`,
            lastModified: new Date().toISOString(),
            priority: 0.7,
        })),
    ];
}
