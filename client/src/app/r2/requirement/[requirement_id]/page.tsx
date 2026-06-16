import * as Framework from "@/api/entities/Framework";
import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { SecurityRequirements } from "@/app/components/security_requirements";
import { ToastContainer } from "@/app/components/toast";
import { ToastNotificationProvider } from "@/app/context/notification";
import { ManifestV2Component } from "@/app/context/manifest";
import { RevisionV2Component } from "@/app/context/revision";
import { social } from "@/app/seo";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateStaticParams() {
    const manifest = await Framework.manifestV2;
    const requirements = manifest.requirements.elements;

    return requirements.map((requirement) => ({
        requirement_id: requirement.element_identifier,
    }));
}

type Props = {
    params: Promise<{ requirement_id: string }>;
};

export async function generateMetadata(
    { params }: Props,
    parent: ResolvingMetadata,
): Promise<Metadata> {
    const { requirement_id } = await params;
    const manifest = await Framework.manifestV2;
    const requirement = manifest.requirements.byId[requirement_id];
    const title = `${requirement_id}: ${requirement.title}`;
    const description = Framework.getRequirementDescription(
        manifest,
        requirement_id,
    );
    return {
        title,
        description,
        creator: "NIST",
        publisher: "NIST",
        keywords: [
            "CMMC",
            requirement_id,
            requirement.family,
            requirement.type,
        ],
        applicationName: "CMMC",
        ...social({
            title,
            description,
            path: `/r2/requirement/${requirement_id}`,
        }),
    };
}

export default async function Page({ params }) {
    const { requirement_id } = await params;
    return (
        <ManifestV2Component>
            <RevisionV2Component>
                <ToastNotificationProvider>
                    <ToastContainer />
                    <Navigation />
                    <Main>
                        <SecurityRequirements requirementId={requirement_id} />
                    </Main>
                    <Footer />
                </ToastNotificationProvider>
            </RevisionV2Component>
        </ManifestV2Component>
    );
}
