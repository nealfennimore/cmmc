"use client";

// pdf.js is ~1MB, so it loads on demand the first time a PDF preview renders
// or a PDF's text is extracted for search. The worker is emitted by the
// bundler as a local asset (never a CDN fetch — evidence must not leave the
// machine).
let pdfjsLoader: Promise<typeof import("pdfjs-dist")> | undefined;
export const loadPdfjs = () => {
    if (!pdfjsLoader) {
        pdfjsLoader = import("pdfjs-dist").then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url,
            ).toString();
            return pdfjs;
        });
    }
    return pdfjsLoader;
};
