export const Footer = () => (
    <footer>
        <div className="mx-auto w-full max-w-screen-xl p-4 md:py-8">
            <p className="mb-4 text-center text-xs text-muted-foreground">
                Need a hand?{" "}
                <a
                    href="https://getcmmc.consulting/?utm_source=cmmc-app&utm_medium=footer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground hover:underline"
                    tabIndex={71}
                >
                    GetCMMC
                </a>{" "}
                offers senior-led CMMC 2.0 readiness &amp; NIST 800-171
                consulting — mock assessments, gap analysis, and SSP/POA&amp;M
                development.
            </p>
            <div className="flex flex-row items-center justify-center text-sm text-muted-foreground">
                <p>
                    © 2026{" "}
                    <a
                        href="https://getcmmc.consulting"
                        className="font-medium text-foreground hover:underline"
                        tabIndex={70}
                    >
                        GetCMMC
                    </a>
                    . All Rights Reserved.
                </p>
                <a
                    href="https://github.com/nealfennimore/cmmc"
                    className="ml-4 text-muted-foreground transition-colors hover:text-foreground"
                    tabIndex={100}
                    aria-label="View source on GitHub"
                >
                    <svg
                        className="h-5 w-5"
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path
                            fillRule="evenodd"
                            d="M10 .333A9.911 9.911 0 0 0 6.866 19.65c.5.092.678-.215.678-.477 0-.237-.01-1.017-.014-1.845-2.757.6-3.338-1.169-3.338-1.169a2.627 2.627 0 0 0-1.1-1.451c-.9-.615.07-.6.07-.6a2.084 2.084 0 0 1 1.518 1.021 2.11 2.11 0 0 0 2.884.823c.044-.503.268-.973.63-1.325-2.2-.25-4.516-1.1-4.516-4.9A3.832 3.832 0 0 1 4.7 7.068a3.56 3.56 0 0 1 .095-2.623s.832-.266 2.726 1.016a9.409 9.409 0 0 1 4.962 0c1.89-1.282 2.717-1.016 2.717-1.016.366.83.402 1.768.1 2.623a3.827 3.827 0 0 1 1.02 2.659c0 3.807-2.319 4.644-4.525 4.889a2.366 2.366 0 0 1 .673 1.834c0 1.326-.012 2.394-.012 2.72 0 .263.18.572.681.475A9.911 9.911 0 0 0 10 .333Z"
                            clipRule="evenodd"
                        ></path>
                    </svg>
                </a>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
                v{process.env.NEXT_PUBLIC_APP_VERSION}
                {" · "}
                <a
                    href={`https://github.com/nealfennimore/cmmc/commit/${process.env.NEXT_PUBLIC_GIT_SHA}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono hover:underline"
                    tabIndex={101}
                >
                    {process.env.NEXT_PUBLIC_GIT_SHA}
                </a>
            </p>
        </div>
    </footer>
);
