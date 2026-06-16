import * as Framework from "@/api/entities/Framework";
import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { Requirements } from "@/app/components/requirements";
import { ToastContainer } from "@/app/components/toast";
import { ManifestV2Component } from "@/app/context/manifest";
import { ToastNotificationProvider } from "@/app/context/notification";
import { RevisionV2Component } from "@/app/context/revision";
import { social } from "@/app/seo";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateStaticParams() {
    const manifest = await Framework.manifestV2;
    const families = manifest.families.elements;

    return families.map((family) => ({
        family_id: family.element_identifier,
    }));
}

type Props = {
    params: Promise<{ family_id: string }>;
};

export async function generateMetadata(
    { params }: Props,
    parent: ResolvingMetadata,
): Promise<Metadata> {
    const { family_id } = await params;
    const manifest = await Framework.manifestV2;
    const family = manifest.families.byId[family_id];
    const familyTitle = family?.title ? `${family.title} (${family_id})` : family_id;
    const title = `Family ${familyTitle} | CMMC | SP NIST 800-171 Rev 2`;
    const description = `NIST SP 800-171 Rev 2 ${family?.title ?? `family ${family_id}`} (${family_id}) security requirements.`;

    return {
        title,
        description,
        creator: "NIST",
        publisher: "NIST",
        keywords: ["CMMC", family_id, family?.title].filter(Boolean) as string[],
        applicationName: "CMMC",
        ...social({ title, description, path: `/r2/family/${family_id}` }),
    };
}

export default async function Page({ params }) {
    const { family_id } = await params;
    return (
        <ManifestV2Component>
            <RevisionV2Component>
                <ToastNotificationProvider>
                    <ToastContainer />
                    <Navigation />
                    <Main>
                        <Requirements familyId={family_id} />
                    </Main>
                    <Footer />
                </ToastNotificationProvider>
            </RevisionV2Component>
        </ManifestV2Component>
    );
}
