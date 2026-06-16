import { EvidenceTable } from "@/app/components/evidence_table";
import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { ToastContainer } from "@/app/components/toast";
import { ManifestV3Component } from "@/app/context/manifest";
import { ToastNotificationProvider } from "@/app/context/notification";
import { RevisionV3Component } from "@/app/context/revision";
import { social } from "@/app/seo";

import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
    const title = "Evidence | CMMC | SP NIST 800-171 Rev 3";
    const description = "Evidence for SP NIST 800-171 Rev 3";
    return {
        title,
        description,
        ...social({ title, description, path: "/r3/evidence" }),
    };
}

export default async function Page() {
    return (
        <ManifestV3Component>
            <RevisionV3Component>
                <ToastNotificationProvider>
                    <ToastContainer />
                    <Navigation />
                    <Main>
                        <EvidenceTable />
                    </Main>
                    <Footer />
                </ToastNotificationProvider>
            </RevisionV3Component>
        </ManifestV3Component>
    );
}
