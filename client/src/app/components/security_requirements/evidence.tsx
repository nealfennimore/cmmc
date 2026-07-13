import { examineItemId, examineItemName } from "@/api/entities/ExamineItemIds";
import {
    examineItemsForRequirement,
    requirementsSharingExamineItem,
} from "@/api/entities/ExamineItems";
import { FileBadge, LinkBadge } from "@/app/components/evidence";
import { SearchDropdown } from "@/app/components/search_dropdown";
import { toBuffer } from "@/app/components/security_requirements/utils";
import { useNotification } from "@/app/context/notification";
import { toNum, useRevisionContext } from "@/app/context/revision";
import {
    copyEvidenceExamineTags,
    evidenceExamineTags,
    IDB,
    IDBEvidenceV2,
    removeEvidenceExamineTags,
    TABLE_CHANGED_EVENT,
} from "@/app/db";
import { isImage } from "@/app/utils/file";
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
import { createPortal } from "react-dom";
import { confirm, ModalShell } from "../confirm";
import {
    badgeClasses,
    Button,
    buttonClasses,
    Heading,
    Input,
    Select,
} from "../ui";

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

// Swap the underlying file/URL of an existing evidence item while keeping the
// requirement links intact. Evidence ids are content hashes, so new data means
// a new id; we re-point the affected links from the old id to the new one and
// drop the old artifact once nothing references it anymore.
const replaceEvidence = async ({
    oldArtifact,
    name,
    type,
    data,
    requirementId,
}: {
    oldArtifact: IDBEvidenceV2;
    name?: string;
    type: string;
    data: ArrayBuffer;
    /** Without a requirement context, shared evidence is replaced everywhere
     *  with no scope prompt. */
    requirementId?: string;
}): Promise<void> => {
    const newEvidence = await deriveEvidence({ name, type, data });

    // Identical content hashes to the same id; only the name can change.
    if (newEvidence.id === oldArtifact.id) {
        if (newEvidence.filename !== oldArtifact.filename) {
            await IDB.evidence.put(newEvidence);
        }
        return;
    }

    const links = await IDB.evidenceRequirements.getAll(
        IDBKeyRange.only(oldArtifact.id),
        "evidence_id",
    );

    // When the artifact is shared across requirements, let the user keep the
    // replacement scoped to this one (mirrors the delete flow's prompt).
    let scoped = links;
    if (links.length > 1 && requirementId) {
        const replaceEverywhere = await confirm({
            title: "Replace shared evidence",
            message:
                "This evidence is attached to more than one requirement. Replace it everywhere, or only for this requirement?",
            confirmLabel: "Replace everywhere",
            cancelLabel: "Only here",
        });
        // Closing the dialog (X / Escape / backdrop) aborts the replacement.
        if (replaceEverywhere === null) {
            return;
        }
        if (!replaceEverywhere) {
            scoped = links.filter(
                (link) => link.requirement_id === requirementId,
            );
        }
    }

    await IDB.evidence.put(newEvidence);
    // The replacement is the same logical document, so it inherits the old
    // artifact's examine tags (e.g. "this is our System security plan").
    await copyEvidenceExamineTags(oldArtifact.id, newEvidence.id);
    for (const link of scoped) {
        await IDB.evidenceRequirements.put({
            evidence_id: newEvidence.id,
            requirement_id: link.requirement_id,
        });
        await IDB.evidenceRequirements.delete([
            oldArtifact.id,
            link.requirement_id,
        ]);
    }

    // Drop the old artifact once nothing references it anymore.
    const remaining = await IDB.evidenceRequirements.getAll(
        IDBKeyRange.only(oldArtifact.id),
        "evidence_id",
    );
    if (!remaining.length) {
        await IDB.evidence.delete(IDBKeyRange.only(oldArtifact.id));
        await removeEvidenceExamineTags(oldArtifact.id);
    }
};

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

// "report.pdf" -> ["report", ".pdf"]; names without a real extension (no dot,
// or only a leading dot) keep the whole name editable.
const splitSuffix = (filename: string): [string, string] => {
    const idx = filename.lastIndexOf(".");
    return idx > 0
        ? [filename.slice(0, idx), filename.slice(idx)]
        : [filename, ""];
};

// Modal editor for a single evidence artifact: rename it, switch its type
// between file and URL, and swap the underlying content, all in one place.
// Rendered through a portal so the fixed overlay (and its inputs) escapes any
// surrounding <form> — otherwise Enter and button clicks inside the modal
// would trigger the form's submit action.
export const EditEvidenceModal = ({
    artifact,
    requirementId,
    onChanged,
    onDelete,
    onClose,
}: {
    artifact: IDBEvidenceV2;
    /** When set, replacing shared evidence prompts for scope (this requirement
     *  vs everywhere); without it, changes apply everywhere. */
    requirementId?: string;
    /** Called after a save mutates the store so the host can refresh. */
    onChanged: () => void | Promise<void>;
    /** Resolves true when the artifact was deleted, false on an aborted prompt. */
    onDelete: () => Promise<boolean>;
    onClose: () => void;
}) => {
    const isUrl = artifact.type === "url";
    const currentUrl = isUrl ? new TextDecoder().decode(artifact.data) : "";
    const [currentBase, currentSuffix] = isUrl
        ? [artifact.filename, ""]
        : splitSuffix(artifact.filename);

    const [kind, setKind] = useState<"file" | "url">(isUrl ? "url" : "file");
    const [name, setName] = useState(currentBase);
    // Once the user edits the name, stop auto-filling it from a picked file.
    const [nameDirty, setNameDirty] = useState(false);
    const [url, setUrl] = useState(currentUrl);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const nameInput = useRef<HTMLInputElement>(null);

    // Names of the shared documents this artifact is recorded as (the same
    // "Attached as" chips the evidence table shows).
    const [attachedAs, setAttachedAs] = useState<string[]>([]);
    const loadAttachedAs = async () => {
        const tags = await evidenceExamineTags(artifact.id);
        setAttachedAs(
            tags
                .map((tag) => examineItemName(tag.examine_id) ?? tag.examine_id)
                .sort(),
        );
    };
    useEffect(() => {
        loadAttachedAs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artifact.id]);

    // Assessment guidance lists the same Examine evidence (e.g. "System
    // security plan") on many controls, so an artifact attached here can be
    // linked to every control sharing the selected item in one step. Only
    // offered with a requirement context; items unique to this control are
    // skipped (nothing to propagate to), as are items the artifact is
    // already tagged as (shown as chips above the select instead).
    const revision = toNum(useRevisionContext());
    const sharedItems = (
        requirementId ? examineItemsForRequirement(revision, requirementId) : []
    ).filter(
        (item) =>
            requirementsSharingExamineItem(revision, item).length > 1 &&
            !attachedAs.includes(item),
    );
    const [sharedItem, setSharedItem] = useState("");
    const [sharedCount, setSharedCount] = useState(0);
    const sharedTargets = sharedItem
        ? requirementsSharingExamineItem(revision, sharedItem)
        : [];

    const onAttachShared = async () => {
        if (!sharedItem) {
            return;
        }
        setBusy(true);
        // put() upserts on the composite key, so existing links (including
        // this control's own) are left as-is.
        for (const target of sharedTargets) {
            await IDB.evidenceRequirements.put({
                evidence_id: artifact.id,
                requirement_id: target,
            });
        }
        // Record which shared document this artifact is (the identity claim
        // behind the fan-out); the per-control links above stay the editable
        // truth of where it appears.
        const examineId = examineItemId(sharedItem);
        if (examineId) {
            await IDB.evidenceExamineItems.put({
                evidence_id: artifact.id,
                examine_id: examineId,
            });
        }
        await loadAttachedAs();
        await onChanged();
        setSharedCount(sharedTargets.length);
        // The attached item leaves the options (it renders as a chip now), so
        // the select can't keep holding it as its value.
        setSharedItem("");
        setBusy(false);
    };

    // Removing a tag drops the identity claim; the per-control links it
    // fanned out survive unless the user opts to detach them too. Links are
    // kept when another tag on this artifact also justifies them, or when
    // they belong to the requirement this modal was opened from.
    const onRemoveTag = async (name: string) => {
        // Foreign tags (no mapping entry) store the raw string as their id.
        const examineId = examineItemId(name) ?? name;

        const links = await IDB.evidenceRequirements.getAll(
            IDBKeyRange.only(artifact.id),
            "evidence_id",
        );
        const linked = new Set(links.map((link) => link.requirement_id));
        const keep = new Set(requirementId ? [requirementId] : []);
        for (const other of attachedAs) {
            if (other === name) {
                continue;
            }
            for (const target of requirementsSharingExamineItem(
                revision,
                other,
            )) {
                keep.add(target);
            }
        }
        const prunable = requirementsSharingExamineItem(revision, name).filter(
            (target) => linked.has(target) && !keep.has(target),
        );

        let detach = false;
        if (prunable.length) {
            const choice = await confirm({
                title: "Remove shared tag",
                message: `This evidence is attached to ${prunable.length} controls that list "${name}". Detach it from those controls as well, or only remove the tag?`,
                confirmLabel: `Detach from ${prunable.length} controls`,
                cancelLabel: "Only remove tag",
            });
            // Closing the dialog (X / Escape / backdrop) aborts the removal.
            if (choice === null) {
                return;
            }
            detach = choice;
        }

        setBusy(true);
        await IDB.evidenceExamineItems.delete([artifact.id, examineId]);
        if (detach) {
            for (const target of prunable) {
                await IDB.evidenceRequirements.delete([artifact.id, target]);
            }
        }
        await loadAttachedAs();
        await onChanged();
        // The attach button may reference the removed tag's fan-out; let the
        // user attach again.
        setSharedCount(0);
        setBusy(false);
    };

    // The file extension is not editable: it is shown as an adornment on the
    // name input and re-appended on save, following the picked replacement
    // file when there is one.
    const suffix =
        kind !== "file" ? "" : file ? splitSuffix(file.name)[1] : currentSuffix;

    let urlValid = false;
    try {
        new URL(url.trim());
        urlValid = true;
    } catch {}

    const canSave =
        !busy &&
        !!name.trim() &&
        (kind === "url"
            ? urlValid
            : // A file artifact can keep its current content, but converting
              // a URL to a file needs an upload.
              !!file || !isUrl);

    const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files?.[0];
        if (!picked) {
            return;
        }
        setFile(picked);
        if (!nameDirty) {
            setName(splitSuffix(picked.name)[0]);
        }
    };

    const onSave = async (finish: (action: () => void) => void) => {
        if (!canSave) {
            return;
        }
        setBusy(true);
        const filename = name.trim() + suffix;
        if (kind === "url") {
            await replaceEvidence({
                oldArtifact: artifact,
                name: filename,
                type: "url",
                data: new TextEncoder().encode(url.trim()).buffer,
                requirementId,
            });
        } else if (file) {
            await replaceEvidence({
                oldArtifact: artifact,
                name: filename,
                type: file.type,
                data: await toBuffer(file),
                requirementId,
            });
        } else if (filename !== artifact.filename) {
            await IDB.evidence.put({ ...artifact, filename });
        }
        await onChanged();
        finish(onClose);
    };

    const onDeleteClick = async (finish: (action: () => void) => void) => {
        setBusy(true);
        // Stay open when the shared-evidence prompt is dismissed.
        if (await onDelete()) {
            finish(onClose);
            return;
        }
        setBusy(false);
    };

    return createPortal(
        <ModalShell
            ariaLabel="Edit evidence"
            onDismiss={onClose}
            initialFocusRef={nameInput}
        >
            {(finish) => (
                <>
                    <div className="px-6 py-5">
                        <h2 className="pr-8 text-lg font-semibold tracking-tight">
                            Edit evidence
                        </h2>
                        <div className="mt-4 flex flex-col gap-4 text-sm">
                            <label className="flex flex-col gap-1 font-medium">
                                Name
                                <span className="relative block">
                                    <Input
                                        ref={nameInput}
                                        type="text"
                                        value={name}
                                        disabled={busy}
                                        style={
                                            suffix
                                                ? {
                                                      paddingRight: `${suffix.length + 2}ch`,
                                                  }
                                                : undefined
                                        }
                                        onChange={(e) => {
                                            setName(e.target.value);
                                            setNameDirty(true);
                                        }}
                                    />
                                    {suffix && (
                                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                            {suffix}
                                        </span>
                                    )}
                                </span>
                            </label>

                            <div className="flex flex-col gap-1 font-medium">
                                Type
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            kind === "file"
                                                ? "primary"
                                                : "outline"
                                        }
                                        disabled={busy}
                                        onClick={() => setKind("file")}
                                    >
                                        File
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            kind === "url"
                                                ? "primary"
                                                : "outline"
                                        }
                                        disabled={busy}
                                        onClick={() => setKind("url")}
                                    >
                                        URL
                                    </Button>
                                </div>
                            </div>

                            {kind === "url" ? (
                                <label className="flex flex-col gap-1 font-medium">
                                    URL
                                    <Input
                                        type="url"
                                        value={url}
                                        placeholder="https://"
                                        disabled={busy}
                                        onChange={(e) => setUrl(e.target.value)}
                                    />
                                </label>
                            ) : (
                                <div className="flex flex-col gap-1 font-medium">
                                    File
                                    <label
                                        className={`${buttonClasses({
                                            variant: "outline",
                                            size: "sm",
                                        })} cursor-pointer`}
                                    >
                                        {file
                                            ? file.name
                                            : isUrl
                                              ? "Choose a file"
                                              : "Replace current file"}
                                        <input
                                            type="file"
                                            className="hidden"
                                            disabled={busy}
                                            onChange={onPickFile}
                                        />
                                    </label>
                                    {!file && (
                                        <span className="text-xs font-normal text-muted-foreground">
                                            {isUrl
                                                ? "Choose a file to convert this link into a stored file."
                                                : "Leave as is to keep the current file contents."}
                                        </span>
                                    )}
                                </div>
                            )}

                            {!!attachedAs.length && (
                                <div className="flex flex-col gap-1 border-t border-border pt-4 font-medium">
                                    Attached as
                                    <div className="flex flex-wrap font-normal">
                                        {attachedAs.map((name) => (
                                            <span
                                                key={name}
                                                className="mb-1 mr-1 inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
                                            >
                                                {name}
                                                <button
                                                    type="button"
                                                    aria-label={`Remove tag "${name}"`}
                                                    disabled={busy}
                                                    onClick={() =>
                                                        onRemoveTag(name)
                                                    }
                                                    className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed"
                                                >
                                                    &times;
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <span className="text-xs font-normal text-muted-foreground">
                                        Shared evidence documents this artifact
                                        is recorded as. Removing a tag keeps the
                                        control links unless you choose to
                                        detach them.
                                    </span>
                                </div>
                            )}

                            {!!sharedItems.length && (
                                <div className="flex flex-col gap-1 border-t border-border pt-4 font-medium">
                                    Attach across controls
                                    <Select
                                        aria-label="Shared evidence requirement"
                                        value={sharedItem}
                                        disabled={busy}
                                        onChange={(e) => {
                                            setSharedItem(e.target.value);
                                            setSharedCount(0);
                                        }}
                                    >
                                        <option value="">
                                            Select a shared evidence
                                            requirement…
                                        </option>
                                        {sharedItems.map((item) => (
                                            <option key={item} value={item}>
                                                {item} (
                                                {
                                                    requirementsSharingExamineItem(
                                                        revision,
                                                        item,
                                                    ).length
                                                }{" "}
                                                controls)
                                            </option>
                                        ))}
                                    </Select>
                                    <span className="text-xs font-normal text-muted-foreground">
                                        Other controls list the same evidence in
                                        their assessment guidance. Attach this
                                        evidence to every control that shares
                                        the selected item.
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={
                                            !sharedItem || busy || !!sharedCount
                                        }
                                        onClick={onAttachShared}
                                    >
                                        {sharedCount
                                            ? `Attached to ${sharedCount} controls`
                                            : sharedItem
                                              ? `Attach to ${sharedTargets.length} controls`
                                              : "Attach"}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary px-6 py-4">
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => onDeleteClick(finish)}
                        >
                            Delete
                        </Button>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => finish(onClose)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={!canSave}
                                onClick={() => onSave(finish)}
                            >
                                {busy ? "Saving…" : "Save"}
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </ModalShell>,
        document.body,
    );
};

// Names of the shared documents an artifact is tagged as, kept live via the
// table-changed event so tagging/untagging in the edit modal (a child of the
// badge) is reflected without a page refresh.
const useEvidenceTagNames = (evidenceId: string): string[] => {
    const [names, setNames] = useState<string[]>([]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            const tags = await evidenceExamineTags(evidenceId);
            if (active) {
                setNames(
                    tags
                        .map(
                            (tag) =>
                                examineItemName(tag.examine_id) ??
                                tag.examine_id,
                        )
                        .sort(),
                );
            }
        };
        load();
        const onTableChanged = (event: Event) => {
            const table = (event as CustomEvent<{ table: string }>).detail
                ?.table;
            if (table === IDB.evidenceExamineItems.table) {
                load();
            }
        };
        window.addEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        return () => {
            active = false;
            window.removeEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        };
    }, [evidenceId]);

    return names;
};

// Every tagged artifact's id, kept live like useEvidenceTagNames. Used by the
// badge list to float tagged evidence onto its own leading row.
const useTaggedEvidenceIds = (): Set<string> => {
    const [ids, setIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        let active = true;
        const load = async () => {
            const tags = await IDB.evidenceExamineItems.getAll();
            if (active) {
                setIds(new Set(tags.map((tag) => tag.evidence_id)));
            }
        };
        load();
        const onTableChanged = (event: Event) => {
            const table = (event as CustomEvent<{ table: string }>).detail
                ?.table;
            if (table === IDB.evidenceExamineItems.table) {
                load();
            }
        };
        window.addEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        return () => {
            active = false;
            window.removeEventListener(TABLE_CHANGED_EVENT, onTableChanged);
        };
    }, []);

    return ids;
};

const IconTag = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-3 w-3"
        aria-hidden="true"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7.5 7.5h.01"
        />
    </svg>
);

const Badge = ({
    children,
    onDelete,
    artifact,
    tagNames,
    requirementId,
    setEvidence,
    readOnly,
}: {
    children: ReactNode;
    onDelete: () => Promise<boolean>;
    artifact: IDBEvidenceV2;
    tagNames: string[];
    requirementId: string;
    setEvidence: Dispatch<SetStateAction<IDBEvidenceV2[]>>;
    readOnly?: boolean;
}) => {
    const [editing, setEditing] = useState(false);

    function onContextMenu(e: MouseEvent) {
        if (readOnly) {
            return;
        }
        e.preventDefault();
        setEditing(true);
    }

    // Tagged evidence (a shared Examine document) reads orange; otherwise URL
    // evidence stays blue (info) and file evidence a subtle gray (neutral) so
    // the groups read differently at a glance.
    const variant = tagNames.length
        ? "tagged"
        : artifact.type === "url"
          ? "info"
          : "warning";

    return (
        <span
            className={badgeClasses(variant, "me-2 mb-2 shrink")}
            onContextMenu={onContextMenu}
        >
            {children}
            {!!tagNames.length && (
                <span
                    className="flex cursor-help items-center gap-0.5 pl-2 text-xs"
                    title={`Attached as: ${tagNames.join(", ")}`}
                >
                    <IconTag />
                    {tagNames.length}
                </span>
            )}
            {!readOnly && (
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="pl-2 transition-opacity hover:opacity-70"
                    aria-label="Edit evidence"
                >
                    <svg
                        className="w-3 h-3"
                        aria-hidden="true"
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
                </button>
            )}
            {editing && !readOnly && (
                <EditEvidenceModal
                    artifact={artifact}
                    requirementId={requirementId}
                    onChanged={() => fetchEvidence(requirementId, setEvidence)}
                    onDelete={onDelete}
                    onClose={() => setEditing(false)}
                />
            )}
        </span>
    );
};

export const EvidenceBadge = ({
    artifact,
    setEvidence,
    evidence,
    requirementId,
    readOnly,
}: {
    artifact: IDBEvidenceV2;
    evidence: IDBEvidenceV2[];
    setEvidence: Dispatch<SetStateAction<IDBEvidenceV2[]>>;
    requirementId: string;
    readOnly?: boolean;
}) => {
    const onDelete = async (): Promise<boolean> => {
        const evidenceRequirementRecords =
            await IDB.evidenceRequirements.getAll(
                IDBKeyRange.only(artifact.id),
                "evidence_id",
            );

        if (evidenceRequirementRecords.length > 1) {
            const shouldDeleteAll = await confirm({
                title: "Delete shared evidence",
                message:
                    "This evidence is attached to more than one requirement. Delete it from all requirements, or only from this one?",
                confirmLabel: "Delete from all",
                cancelLabel: "Only here",
                variant: "destructive",
            });
            // Closing the dialog (X / Escape / backdrop) aborts the delete.
            if (shouldDeleteAll === null) {
                return false;
            }
            if (shouldDeleteAll) {
                for (const record of evidenceRequirementRecords) {
                    await IDB.evidenceRequirements.delete([
                        record.evidence_id,
                        record.requirement_id,
                    ]);
                }
                await IDB.evidence.delete(IDBKeyRange.only(artifact.id));
                await removeEvidenceExamineTags(artifact.id);
            } else {
                await IDB.evidenceRequirements.delete([
                    artifact.id,
                    requirementId,
                ]);
            }
        } else {
            const shouldDelete = await confirm({
                title: "Delete evidence",
                message: `Delete "${artifact.filename}"? This cannot be undone.`,
                confirmLabel: "Delete",
                variant: "destructive",
            });
            if (!shouldDelete) {
                return false;
            }
            await IDB.evidence.delete(IDBKeyRange.only(artifact.id));
            await IDB.evidenceRequirements.delete([artifact.id, requirementId]);
            await removeEvidenceExamineTags(artifact.id);
        }

        setEvidence(evidence.filter((e) => e.id !== artifact.id));
        return true;
    };

    const tagNames = useEvidenceTagNames(artifact.id);

    return (
        <Badge
            onDelete={onDelete}
            artifact={artifact}
            tagNames={tagNames}
            requirementId={requirementId}
            setEvidence={setEvidence}
            readOnly={readOnly}
        >
            {artifact.type === "url" ? (
                <LinkBadge
                    artifact={artifact}
                    className={`border-r ${tagNames.length ? "border-orange-200" : "border-blue-200"}`}
                />
            ) : (
                <FileBadge
                    artifact={artifact}
                    siblings={evidence}
                    className={`border-r ${tagNames.length ? "border-orange-200" : "border-yellow-200"}`}
                />
            )}
        </Badge>
    );
};
export const EvidenceBadges = ({
    evidence,
    setEvidence,
    requirementId,
    readOnly,
}: {
    evidence: IDBEvidenceV2[];
    setEvidence: Dispatch<SetStateAction<IDBEvidenceV2[]>>;
    requirementId: string;
    readOnly?: boolean;
}) => {
    // Tagged evidence (orange) leads on its own row, then URL evidence, then
    // files — each group pushed onto its own line via a full-width flex break
    // so the three groups read separately. Sort is stable, so order within a
    // group is preserved.
    const taggedIds = useTaggedEvidenceIds();
    const rank = (artifact: IDBEvidenceV2) =>
        taggedIds.has(artifact.id) ? 0 : artifact.type === "url" ? 1 : 2;
    const sorted = [...(evidence ?? [])].sort((a, b) => rank(a) - rank(b));

    return sorted.map((artifact, index) => (
        <Fragment key={artifact.id}>
            {index > 0 && rank(sorted[index - 1]) !== rank(artifact) && (
                <span className="basis-full" aria-hidden="true" />
            )}
            <EvidenceBadge
                artifact={artifact}
                evidence={evidence}
                setEvidence={setEvidence}
                requirementId={requirementId}
                readOnly={readOnly}
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

export const Evidence = ({
    requirementId,
    locked,
}: {
    requirementId: string;
    locked?: boolean;
}) => {
    const [evidence, setEvidence] = useState<IDBEvidenceV2[]>([]);
    const [uploading, setUploading] = useState(false);
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

    // Renaming/replacing existing evidence lives in EditEvidenceModal; the
    // form action only adds new URL evidence.
    const action = async (prevState, formData: FormData) => {
        const href = formData.get("url") as string;
        if (!href) {
            return;
        }
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
        formRef.current?.reset();
    };

    const [_, formAction, isPending] = useActionState(action, null);

    useEffect(() => {
        if (!uploading && !isPending) {
            fetchEvidence(requirementId, setEvidence);
        }
    }, [requirementId, uploading, isPending]);

    useEffect(() => {
        // Free-tier locked requirements are read-only: no pasted evidence.
        if (locked) {
            return;
        }
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
    }, [requirementId, setEvidence, setUploading, locked]);

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

    let className = "mb-4 mt-4 flex items-center";
    if (!locked) {
        className += "mb-0 mt-0 -translate-y-full";
    }

    return (
        <>
            <Heading level={3} as="h4" className={className}>
                Evidence
            </Heading>
            <form
                className="flex flex-col md:flex-row shrink mb-16"
                action={formAction}
                ref={formRef}
                data-tour="evidence"
            >
                {!locked && (
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
                )}
                <div className="flex flex-wrap shrink basis-full md:basis-2/3 content-center">
                    <EvidenceBadges
                        evidence={evidence}
                        setEvidence={setEvidence}
                        requirementId={requirementId}
                        readOnly={locked}
                    />
                </div>
            </form>
        </>
    );
};
