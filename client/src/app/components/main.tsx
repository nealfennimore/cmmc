export function Main({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="main-wrapper mx-auto w-full max-w-screen-xl px-4 pb-16 pt-24 font-[family-name:var(--font-geist-sans)] sm:px-6 lg:px-8">
            <main className="flex w-full flex-col items-start gap-8">
                {children}
            </main>
        </div>
    );
}
