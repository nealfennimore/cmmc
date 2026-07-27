import { EvidenceTable } from "@/app/components/evidence_table";
import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { ToastContainer } from "@/app/components/toast";
import { ManifestV2Component } from "@/app/context/manifest";
import { ToastNotificationProvider } from "@/app/context/notification";
import { RevisionV2Component } from "@/app/context/revision";
import { social } from "@/app/seo";
import { Suspense } from "react";

import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
    const title = "Evidence | CMMC | SP NIST 800-171 Rev 2";
    const description = "Evidence for SP NIST 800-171 Rev 2";
    return {
        title,
        description,
        ...social({ title, description, path: "/r2/evidence" }),
    };
}

export default async function Page() {
    return (
        <ManifestV2Component>
            <RevisionV2Component>
                <ToastNotificationProvider>
                    <ToastContainer />
                    <Navigation />
                    <Main>
                        {/* Suspense for useSearchParams (?q= content filter)
                            under static export. */}
                        <Suspense>
                            <EvidenceTable />
                        </Suspense>
                    </Main>
                    <Footer />
                </ToastNotificationProvider>
            </RevisionV2Component>
        </ManifestV2Component>
    );
}
