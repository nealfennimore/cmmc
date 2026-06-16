import { Families } from "@/app/components/families";
import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { ToastContainer } from "@/app/components/toast";
import { ManifestV2Component } from "@/app/context/manifest";
import { ToastNotificationProvider } from "@/app/context/notification";
import { RevisionV2Component } from "@/app/context/revision";
import { social } from "@/app/seo";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
    const title = "CMMC | SP NIST 800-171 Rev 2";
    const description =
        "This application simplifies achieving NIST SP 800-171 Revision 2 compliance by providing a user-friendly interface to manage security controls, store data locally, and generate compliance summaries. ";
    return {
        title,
        description,
        ...social({ title, description, path: "/" }),
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
                        <Families />
                    </Main>
                    <Footer />
                </ToastNotificationProvider>
            </RevisionV2Component>
        </ManifestV2Component>
    );
}
