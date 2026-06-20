import { SearchDropdown } from "@/app/components/search_dropdown";
import {
    toBuffer,
    viewFile,
} from "@/app/components/security_requirements/utils";
import { useNotification } from "@/app/context/notification";
import { IDB, IDBEvidenceV2 } from "@/app/db";
import { isImage } from "@/app/utils/file";
import { openExternal } from "@/app/utils/tauri";
import {
    ChangeEvent,
    Dispatch,
    DragEvent,
    Fragment,
    ReactNode,
    SetStateAction,
    useActionState,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { badgeClasses, Button, Heading, Input } from "../ui";

const deriveEvidence = async ({
    type,
    name,
    data,
}: {
    type: string;
    name?: string;
    data: ArrayBuffer;
}): Promise<IDBEvidenceV2> => {
    const id = [
        ...new Uint8Array(await window.crypto.subtle.digest("SHA-256", data)),
    ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

    const suffix = type.includes("image/")
        ? `.${type.replace("image/", "")}`
        : "";

    const filename = name || `${id.slice(0, 8)}${suffix}`;

    return {
        id,
        filename,
        type: type,
        data,
    };
};

const IconFileDownload = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20 12.5V6.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C17.72 2 16.88 2 15.2 2H8.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C4 4.28 4 5.12 4 6.8v10.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C6.28 22 7.12 22 8.8 22h3.7m2.5-3 3 3m0 0 3-3m-3 3v-6"
        />
    </svg>
);
const IconLink = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        />
    </svg>
);
const IconExternal = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 9V3m0 0h-6m6 0-8 8m-3-6H7.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C3 7.28 3 8.12 3 9.8v6.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C5.28 21 6.12 21 7.8 21h6.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C19 18.72 19 17.88 19 16.2V14"
        />
    </svg>
);

export const Files = ({
    requirementId,
    setUploading,
    uploading,
}: {
    requirementId: string;
    setUploading: Dispatch<SetStateAction<boolean>>;
    uploading: boolean;
}) => {
    const [isDragging, setIsDragging] = useState(false);

    const processFiles = async (files: FileList | null) => {
        if (!files?.length) {
            return;
        }
        setUploading(true);
        for (const file of files) {
            const data = await toBuffer(file);
            const evidence: IDBEvidenceV2 = await deriveEvidence({
                name: file.name,
                type: file.type,
                data,
            });
            await IDB.evidenceRequirements.put({
                evidence_id: evidence.id,
                requirement_id: requirementId,
            });
            await IDB.evidence.put(evidence);
        }
        setUploading(false);
    };

    const onChange = (e: ChangeEvent<HTMLInputElement>) =>
        processFiles(e.target.files);

    // A hidden file input can't be a drop target and a <label> doesn't forward
    // drop events to its input, so handle drag-and-drop on the label directly.
    const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };
    const onDrop = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (!uploading) {
            processFiles(e.dataTransfer.files);
        }
    };

    return (
        <label
            htmlFor="evidence"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed transition-colors hover:bg-secondary ${
                isDragging
                    ? "border-primary bg-secondary"
                    : "border-input bg-card"
            }`}
        >
            <div className="flex flex-col items-center justify-center pb-6 pt-5">
                <svg
                    className="mb-4 h-8 w-8 text-muted-foreground"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 20 16"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                    />
                </svg>

                <p className="p-2 text-sm text-muted-foreground">
                    Click or drop file evidence
                </p>
            </div>
            <input
                id="evidence"
                type="file"
                className="hidden"
                multiple={true}
                onChange={onChange}
                disabled={uploading}
            />
        </label>
    );
};

const NameChange = ({ artifact }: { artifact: IDBEvidenceV2 }) => {
    const suffixIdx =
        artifact.type !== "url" ? artifact.filename.lastIndexOf(".") : -1;
    const nameWithoutSuffix =
        artifact.type !== "url"
            ? artifact.filename.slice(0, suffixIdx)
            : artifact.filename;

    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, [input?.current]);

    return (
        <label className="me-2 flex items-center gap-1">
            <Input
                type="text"
                className="h-7 w-36 text-xs"
                id={`name.${artifact.id}`}
                name={`name.${artifact.id}`}
                placeholder={nameWithoutSuffix}
                defaultValue={nameWithoutSuffix}
                ref={input}
            />
            <Button type="submit" size="sm" className="h-7 px-2" aria-label="Save name">
                <svg
                    className="w-4 h-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m18 10-4-4M2.5 21.5l3.384-.376c.414-.046.62-.069.814-.131a2 2 0 0 0 .485-.234c.17-.111.317-.259.61-.553L21 7a2.828 2.828 0 1 0-4-4L3.794 16.206c-.294.294-.442.442-.553.611a2 2 0 0 0-.234.485c-.062.193-.085.4-.131.814z"
                    />
                </svg>
            </Button>
        </label>
    );
};

const Badge = ({
    children,
    onDelete,
    artifact,
    lastResetAt,
}: {
    children: ReactNode;
    onDelete: CallableFunction;
    artifact: IDBEvidenceV2;
    lastResetAt: null | number;
}) => {
    const [isShowing, setShowing] = useState(false);
    const [prevLastResetAt, setPrevLastResetAt] = useState(lastResetAt);

    useEffect(() => {
        if (lastResetAt !== prevLastResetAt) {
            setShowing(false);
            setPrevLastResetAt(lastResetAt);
        }
    }, [lastResetAt, prevLastResetAt]);

    function onContextMenu(e: MouseEvent) {
        e.preventDefault();
        setShowing(!isShowing);
    }

    if (isShowing) {
        return <NameChange artifact={artifact} />;
    }

    // URL evidence stays blue (info); file evidence is a subtle gray (neutral)
    // so the two groups read differently at a glance.
    const variant = artifact.type === "url" ? "info" : "neutral";

    return (
        <span
            className={badgeClasses(variant, "me-2 mb-2 shrink")}
            onContextMenu={onContextMenu}
        >
            {children}
            <button
                onClick={onDelete}
                className="pl-2 transition-opacity hover:opacity-70"
                aria-label="Remove evidence"
            >
                <svg
                    className="w-2 h-2"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 14 14"
                >
                    <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
                    />
                </svg>
            </button>
        </span>
    );
};

export const FileBadge = ({ artifact }: { artifact: IDBEvidenceV2 }) => {
    return (
        <button
            className="flex items-center border-r border-border pr-2"
            title={`${artifact.data.byteLength} bytes | ${artifact.type}`}
            onClick={() => viewFile(artifact)}
        >
            <IconFileDownload />
            <span>{artifact.filename}</span>
        </button>
    );
};
export const LinkBadge = ({ artifact }: { artifact: IDBEvidenceV2 }) => {
    const url = new TextDecoder().decode(artifact.data);

    const onClick = async () => {
        // In the desktop shell this opens the system browser; the detached
        // anchor below is the browser fallback.
        if (await openExternal(url)) {
            return;
        }
        Object.assign(document.createElement("a"), {
            target: "_blank",
            rel: "noopener noreferrer",
            href: url,
        }).click();
    };

    return (
        <button
            className="flex items-center border-r border-blue-200 pr-2"
            title={`${url}`}
            onClick={onClick}
        >
            <IconExternal />
            <span>{artifact.filename}</span>
        </button>
    );
};

export const EvidenceBadge = ({
    artifact,
    setEvidence,
    evidence,
    lastResetAt,
    requirementId,
}: {
    artifact: IDBEvidenceV2;
    evidence: IDBEvidenceV2[];
    setEvidence: Dispatch<SetStateAction<IDBEvidenceV2[]>>;
    lastResetAt: null | number;
    requirementId: string;
}) => {
    const onDelete = async () => {
        const evidenceRequirementRecords =
            await IDB.evidenceRequirements.getAll(
                IDBKeyRange.only(artifact.id),
                "evidence_id",
            );

        if (evidenceRequirementRecords.length > 1) {
            const shouldDeleteAll = window.confirm(
                "The same evidence is attached to more than one requirement. Delete from all?",
            );
            if (shouldDeleteAll) {
                for (const record of evidenceRequirementRecords) {
                    await IDB.evidenceRequirements.delete([
                        record.evidence_id,
                        record.requirement_id,
                    ]);
                }
                await IDB.evidence.delete(IDBKeyRange.only(artifact.id));
            } else {
                await IDB.evidenceRequirements.delete([
                    artifact.id,
                    requirementId,
                ]);
            }
        } else {
            await IDB.evidence.delete(IDBKeyRange.only(artifact.id));
            await IDB.evidenceRequirements.delete([artifact.id, requirementId]);
        }

        setEvidence(evidence.filter((e) => e.id !== artifact.id));
    };

    return (
        <Badge
            onDelete={onDelete}
            artifact={artifact}
            lastResetAt={lastResetAt}
        >
            {artifact.type === "url" ? (
                <LinkBadge artifact={artifact} />
            ) : (
                <FileBadge artifact={artifact} />
            )}
        </Badge>
    );
};
export const EvidenceBadges = ({
    evidence,
    setEvidence,
    lastResetAt,
    requirementId,
}: {
    evidence: IDBEvidenceV2[];
    setEvidence: Dispatch<SetStateAction<IDBEvidenceV2[]>>;
    lastResetAt: null | number;
    requirementId: string;
}) => {
    // Show URL evidence first, then files. Files are pushed onto their own
    // line via a full-width flex break so links and files read as two groups.
    const isUrl = (artifact: IDBEvidenceV2) => artifact.type === "url";
    const sorted = [...(evidence ?? [])].sort(
        (a, b) => Number(isUrl(b)) - Number(isUrl(a)),
    );
    const firstFileIndex = sorted.findIndex((artifact) => !isUrl(artifact));

    return sorted.map((artifact, index) => (
        <Fragment key={artifact.id}>
            {index === firstFileIndex && index > 0 && (
                <span className="basis-full" aria-hidden="true" />
            )}
            <EvidenceBadge
                artifact={artifact}
                evidence={evidence}
                setEvidence={setEvidence}
                lastResetAt={lastResetAt}
                requirementId={requirementId}
            />
        </Fragment>
    ));
};

async function fetchEvidence(requirementId, setEvidence) {
    const evidenceRequirementRecords = await IDB.evidenceRequirements.getAll(
        IDBKeyRange.only(requirementId),
        "requirement_id",
    );

    const evidenceRecords = (
        await Promise.all(
            evidenceRequirementRecords.flatMap((record) =>
                IDB.evidence.getAll(IDBKeyRange.only(record.evidence_id)),
            ),
        )
    ).flat();

    setEvidence(evidenceRecords);
}

function pasteImageFromClipboard(requirementId, setEvidence, setUploading) {
    return async function handleImagePaste(event: Event): Promise<boolean> {
        try {
            if (["TEXTAREA", "INPUT"].includes(event?.target?.nodeName)) {
                return false;
            }
            // Gather pasted images. Prefer the paste event's clipboardData,
            // which works in both browsers and the Tauri (WebKitGTK) webview
            // without the async Clipboard API's read permission. WebKitGTK
            // exposes navigator.clipboard.read but it rejects without that
            // permission, which is why pasting failed inside Tauri.
            const clipboardEvent = event as ClipboardEvent;
            const blobs: Blob[] = [];

            const items = clipboardEvent.clipboardData?.items;
            for (let i = 0; i < (items?.length ?? 0); i++) {
                const item = items![i];
                if (item.kind === "file" && isImage(item.type)) {
                    const file = item.getAsFile();
                    if (file) {
                        blobs.push(file);
                    }
                }
            }

            // Fall back to the async Clipboard API (e.g. an image copied from
            // another app rather than pasted as a file).
            if (
                !blobs.length &&
                typeof navigator?.clipboard?.read === "function"
            ) {
                try {
                    const clipboardItems = await navigator.clipboard.read();
                    for (const clipboardItem of clipboardItems) {
                        const imageType = clipboardItem.types.find(isImage);
                        if (imageType) {
                            blobs.push(await clipboardItem.getType(imageType));
                        }
                    }
                } catch {
                    // read() can reject in webviews lacking clipboard-read
                    // permission; the clipboardData path above is the fallback.
                }
            }

            if (!blobs.length) {
                return false;
            }
            clipboardEvent.preventDefault();

            setUploading(true);
            for (const blob of blobs) {
                const data = await toBuffer(blob);
                const evidence: IDBEvidenceV2 = await deriveEvidence({
                    type: blob.type,
                    data,
                });
                const [existing] = await IDB.evidence.getAll(evidence.id);
                if (!existing) {
                    await IDB.evidence.put(evidence);
                }
                await IDB.evidenceRequirements.put({
                    evidence_id: evidence.id,
                    requirement_id: requirementId,
                });
            }
            setUploading(false);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };
}

export const Evidence = ({ requirementId }: { requirementId: string }) => {
    const [evidence, setEvidence] = useState<IDBEvidenceV2[]>([]);
    const [uploading, setUploading] = useState(false);
    const [formLastReset, setFormLastReset] = useState<number | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const { addNotification } = useNotification();

    const evidenceById = useMemo(() => {
        return evidence.reduce(
            (acc, artifact) => {
                acc[artifact.id] = artifact;
                return acc;
            },
            {} as Record<string, IDBEvidenceV2>,
        );
    }, [evidence]);

    const action = async (prevState, formData: FormData) => {
        let triggerReset = false;

        if (formData.get("url")) {
            const href = formData.get("url") as string;
            const url = new URL(href);
            const data = new TextEncoder().encode(href);
            const evidence: IDBEvidenceV2 = await deriveEvidence({
                name: url.host || url.href,
                type: "url",
                data: data.buffer,
            });
            await IDB.evidenceRequirements.put({
                evidence_id: evidence.id,
                requirement_id: requirementId,
            });
            await IDB.evidence.put(evidence);
            triggerReset = true;
        } else {
            for (const key of formData.keys()) {
                if (key.startsWith("name.")) {
                    const id = key.slice(5);
                    const artifact = evidenceById[id] as IDBEvidenceV2;
                    let suffix = "";
                    if (artifact.type !== "url") {
                        const suffixIdx = artifact.filename.lastIndexOf(".");
                        suffix = artifact.filename.slice(suffixIdx);
                    }
                    const value = formData.get(key);
                    if (!value) {
                        continue;
                    }
                    await IDB.evidence.put({
                        ...artifact,
                        filename: `${value}${suffix}`,
                    });
                    await IDB.evidenceRequirements.put({
                        evidence_id: artifact.id,
                        requirement_id: requirementId,
                    });
                    triggerReset = true;
                }
            }
        }

        if (triggerReset) {
            formRef.current?.reset();
        }
    };

    const [_, formAction, isPending] = useActionState(action, null);

    useEffect(() => {
        if (!uploading && !isPending) {
            fetchEvidence(requirementId, setEvidence);
        }
    }, [requirementId, uploading, isPending]);

    useEffect(() => {
        const handler = pasteImageFromClipboard(
            requirementId,
            setEvidence,
            setUploading,
        );
        const handlerWithNotifcation = async (e: Event) => {
            if (await handler(e)) {
                addNotification({ text: "Successfully pasted evidence" });
            }
        };
        document.addEventListener("paste", handlerWithNotifcation);
        return () => {
            document.removeEventListener("paste", handlerWithNotifcation);
        };
    }, [requirementId, setEvidence, setUploading]);

    useEffect(() => {
        const setTimestamp = (e: Event) => {
            setFormLastReset(e.timeStamp);
        };
        const node = formRef?.current;

        node?.addEventListener("reset", setTimestamp);

        return () => {
            node?.removeEventListener("reset", setTimestamp);
        };
    }, [formRef]);

    const evidenceOptions = useMemo(async () => {
        const evidence = await IDB.evidence.getAll();
        return evidence.reduce(
            (acc, artifact) => {
                if (!evidenceById[artifact.id]) {
                    acc.push({
                        label: artifact.filename,
                        value: artifact.id,
                    });
                }
                return acc;
            },
            [] as Record<string, string>[],
        );
    }, [evidenceById]);

    const onEvidenceSelect = useMemo(() => {
        return async (option: any, fn: CallableFunction) => {
            setUploading(true);
            await IDB.evidenceRequirements.put({
                evidence_id: option.value,
                requirement_id: requirementId,
            });
            fn("");
            setUploading(false);
        };
    }, [requirementId]);

    return (
        <>
            <Heading
                level={3}
                as="h4"
                className="mb-6 flex -translate-y-full items-center"
            >
                Evidence
            </Heading>
            <form
                className="flex flex-col md:flex-row shrink mb-4 -translate-y-[36px]"
                action={formAction}
                ref={formRef}
            >
                <div className="basis-full mb-4 md:mb-0 md:basis-1/3 md:mr-4">
                    <Files
                        requirementId={requirementId}
                        setUploading={setUploading}
                        uploading={uploading}
                    />
                    <div className="relative w-full mt-4">
                        <Input
                            type="url"
                            name="url"
                            id="url"
                            className="pe-12"
                            placeholder={`Add URL to evidence`}
                        />
                        <button
                            type="submit"
                            aria-label="Add URL evidence"
                            className="absolute end-0 top-0 inline-flex h-full items-center rounded-e-md border-l border-input bg-secondary px-3 text-muted-foreground transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <IconLink />
                        </button>
                    </div>
                    <div className="relative w-full mt-4">
                        <SearchDropdown
                            placeholder={`Attach other requirement evidence to ${requirementId}`}
                            options={evidenceOptions}
                            onSelect={onEvidenceSelect}
                        />
                    </div>
                </div>
                <div className="flex flex-wrap shrink basis-full md:basis-2/3 content-center">
                    <EvidenceBadges
                        evidence={evidence}
                        setEvidence={setEvidence}
                        lastResetAt={formLastReset}
                        requirementId={requirementId}
                    />
                </div>
            </form>
        </>
    );
};
