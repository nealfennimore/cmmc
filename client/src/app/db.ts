"use client";
import { Status } from "@/app/components/status";
export const version = 5;
let loader: Promise<IDBDatabase> | undefined;

enum Table {
    SECURITY_REQUIREMENTS = "security_requirements",
    REQUIREMENTS = "requirements",
    EVIDENCE = "evidence",
    EVIDENCE_REQUIREMENTS = "evidence_requirements",
    EXAMINE_EVIDENCE = "examine_evidence",
}

const migrations = {
    "1": async (event: IDBVersionChangeEvent) => {
        const db = event.target.result as IDBDatabase;
        const securityRequirementsStore = db.createObjectStore(
            Table.SECURITY_REQUIREMENTS,
            {
                keyPath: "id",
            },
        );

        securityRequirementsStore.createIndex("status", "status", {
            unique: false,
        });
        securityRequirementsStore.createIndex("description", "description", {
            unique: false,
        });

        const requirementsStore = db.createObjectStore(Table.REQUIREMENTS, {
            keyPath: "id",
        });

        requirementsStore.createIndex(
            "security_requirements",
            "security_requirements",
            {
                unique: false,
            },
        );
    },
    "2": async (event: IDBVersionChangeEvent) => {
        const db = event.target.result as IDBDatabase;
        const evidence = db.createObjectStore(Table.EVIDENCE, {
            keyPath: "uuid",
        });
        evidence.createIndex("requirement_id", "requirement_id", {
            unique: false,
        });
        evidence.createIndex("filename", "filename", {
            unique: false,
        });
        evidence.createIndex("data", "data", {
            unique: false,
        });
        return evidence;
    },
    "3": async (event: IDBVersionChangeEvent) => {
        const db = event.target.result as IDBDatabase;
        db.deleteObjectStore(Table.EVIDENCE);

        const evidence = await migrations["2"](event);

        evidence.createIndex("type", "type", {
            unique: false,
        });
    },
    "4": async (event: IDBVersionChangeEvent) => {
        const db = event.target.result as IDBDatabase;
        const tx = event.target.transaction as IDBTransaction;

        const evidenceSecReqs = db.createObjectStore(
            Table.EVIDENCE_REQUIREMENTS,
            {
                keyPath: ["evidence_id", "requirement_id"],
            },
        );

        evidenceSecReqs.createIndex("evidence_id", "evidence_id", {
            unique: false,
        });
        evidenceSecReqs.createIndex("requirement_id", "requirement_id", {
            unique: false,
        });

        const evidenceTemp = db.createObjectStore("evidence_temp", {
            keyPath: "id",
        });
        evidenceTemp.createIndex("filename", "filename", {
            unique: false,
        });
        evidenceTemp.createIndex("type", "type", {
            unique: false,
        });
        evidenceTemp.createIndex("data", "data", {
            unique: false,
        });

        const addToIntermediary = put<IDBEvidenceRequirement>(
            Table.EVIDENCE_REQUIREMENTS,
            tx,
        );

        const addToTemp = put<IDBEvidenceV2>("evidence_temp", tx);
        const evidenceRecords = await getAll<IDBEvidence>(Table.EVIDENCE, tx)();

        for (const e of evidenceRecords) {
            await addToIntermediary({
                evidence_id: e.uuid,
                requirement_id: e.requirement_id,
            });
            await addToTemp({
                id: e.uuid,
                filename: e.filename,
                data: e.data.slice(0, e.data.byteLength),
                type: e.type,
            });
        }

        db.deleteObjectStore(Table.EVIDENCE);

        const evidence = db.createObjectStore(Table.EVIDENCE, {
            keyPath: "id",
        });
        evidence.createIndex("filename", "filename", {
            unique: false,
        });
        evidence.createIndex("data", "data", {
            unique: false,
        });
        evidence.createIndex("type", "type", {
            unique: false,
        });

        const tempRecords = await getAll<IDBEvidenceV2>("evidence_temp", tx)();
        const addToEvidence = put<IDBEvidenceV2>(Table.EVIDENCE, tx);

        for (const e of tempRecords) {
            await addToEvidence({
                id: e.id,
                filename: e.filename,
                data: e.data.slice(0, e.data.byteLength),
                type: e.type,
            });
        }

        db.deleteObjectStore("evidence_temp");
    },
    "5": async (event: IDBVersionChangeEvent) => {
        const db = event.target.result as IDBDatabase;

        // Manual checklist of which "Examine" evidence types an organization
        // has collected for a requirement. One record per checked item.
        const examineEvidence = db.createObjectStore(Table.EXAMINE_EVIDENCE, {
            keyPath: ["requirement_id", "item"],
        });

        examineEvidence.createIndex("requirement_id", "requirement_id", {
            unique: false,
        });
    },
};

if (typeof window !== "undefined") {
    const request = window?.indexedDB?.open("800_171_r3", version);

    loader = new Promise((resolve, reject) => {
        request.onerror = (event) => {
            console.error("Can't use IndexDB");
            reject(event);
        };
        request.onsuccess = async (event) => {
            const db = event.target?.result as IDBDatabase;
            try {
                await migrateEvidenceIdsToSha256(db);
            } catch (error) {
                // A failed normalization shouldn't brick the app: legacy ids
                // stay internally consistent (links still point at them), so we
                // log and continue rather than reject the open.
                console.error("Evidence id migration failed", error);
            }
            resolve(db);
        };

        request.onupgradeneeded = async function (
            event: IDBVersionChangeEvent,
        ) {
            for (let v = event.oldVersion + 1; v <= event.newVersion; v++) {
                await migrations?.[`${v}`]?.(event);
            }
        };
    });
}

export const getDB = function () {
    return loader || Promise.reject("Can't use IndexDB");
};

export interface IDBSecurityRequirement {
    id: string;
    status: string;
    description: string;
}

export interface IDBRequirement {
    id: string;
    bySecurityRequirementId: Record<string, Status>;
}

export interface IDBEvidence {
    uuid: string;
    requirement_id: string;
    filename: string;
    type: string;
    data: ArrayBuffer;
}

export interface IDBEvidenceV2 {
    id: string;
    filename: string;
    type: string;
    data: ArrayBuffer;
}

export interface IDBEvidenceRequirement {
    requirement_id: string;
    evidence_id: string;
}

export interface IDBExamineEvidence {
    requirement_id: string;
    item: string;
}

enum Permission {
    READONLY = "readonly",
    READWRITE = "readwrite",
}

export const getStore = async (
    table: string,
    permission: Permission,
    tx?: IDBTransaction,
) => {
    if (tx) {
        return tx.objectStore(table);
    }
    const db = await getDB();
    return db.transaction(table, permission).objectStore(table);
};

export const getAll =
    <T>(table: string, tx?: IDBTransaction) =>
    async (
        query: IDBKeyRange | IDBValidKey | null = null,
        index?: string,
        count?: number,
    ): Promise<T[]> => {
        let store: IDBObjectStore | IDBIndex = await getStore(
            table,
            Permission.READONLY,
            tx,
        );

        if (index) {
            store = store.index(index) as IDBIndex;
        }

        const request = store.getAll(query, count);

        return new Promise<T[]>((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result as T[]);
            };
            request.onerror = () => {
                reject();
            };
        });
    };

export const remove =
    (table: string, tx?: IDBTransaction) =>
    async (query: IDBKeyRange | IDBValidKey): Promise<boolean> => {
        const store: IDBObjectStore = await getStore(
            table,
            Permission.READWRITE,
            tx,
        );

        const request = store.delete(query);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(true);
            };
            request.onerror = () => {
                reject();
            };
        });
    };

export const put =
    <T>(table: string, tx?: IDBTransaction) =>
    async (data: T, key?: Array<string>): Promise<T[]> => {
        const store = await getStore(table, Permission.READWRITE, tx);
        return new Promise<T[]>((resolve, reject) => {
            const request = store.put(data, key);
            request.onsuccess = () => {
                resolve(request.result as T[]);
            };
            request.onerror = () => {
                reject();
            };
        });
    };

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Once every evidence id is a sha256 there is nothing left to convert (new
// evidence is always content-hashed), so a persisted flag lets us skip even the
// key scan on subsequent loads. Import clears it via resetEvidenceIdMigration()
// because an older backup can reintroduce legacy ids.
const EVIDENCE_ID_MIGRATION_KEY = "evidence_ids_migrated_to_sha256";

const evidenceIdsMigrated = (): boolean => {
    try {
        return localStorage.getItem(EVIDENCE_ID_MIGRATION_KEY) === "true";
    } catch {
        return false;
    }
};

const markEvidenceIdsMigrated = (): void => {
    try {
        localStorage.setItem(EVIDENCE_ID_MIGRATION_KEY, "true");
    } catch {
        // Storage can be unavailable (private mode); the key scan still keeps
        // the migration correct, it just won't be skipped next load.
    }
};

export const resetEvidenceIdMigration = (): void => {
    try {
        localStorage.removeItem(EVIDENCE_ID_MIGRATION_KEY);
    } catch {
        // Ignore — a stale flag only costs one key scan on the next load.
    }
};

const sha256Hex = async (data: ArrayBuffer): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

// Older databases keyed evidence by UUID (and, further back, sha1) instead of a
// content hash. Normalize any such id to sha256(data) so it matches what
// deriveEvidence() produces today, repointing the evidence_requirements links
// that reference it. Idempotent: once every id is a sha256 this is a no-op.
//
// Runs before the open promise resolves, so it can't use the helpers' implicit
// transactions (those await getDB(), which is still pending) — every read/write
// gets an explicit transaction. All hashing finishes before the write
// transaction opens: awaiting crypto.subtle inside a live IDB transaction would
// let it auto-commit and the next write would throw.
const migrateEvidenceIdsToSha256 = async (db: IDBDatabase): Promise<void> => {
    if (evidenceIdsMigrated()) {
        return;
    }

    if (
        !db.objectStoreNames.contains(Table.EVIDENCE) ||
        !db.objectStoreNames.contains(Table.EVIDENCE_REQUIREMENTS)
    ) {
        return;
    }

    // Cheap gate: read keys only, no blob payloads, and bail when nothing is
    // legacy (the common case on every load after the one-time conversion).
    const keysTx = db.transaction(Table.EVIDENCE, Permission.READONLY);
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = keysTx.objectStore(Table.EVIDENCE).getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    if (keys.every((k) => typeof k === "string" && SHA256_HEX.test(k))) {
        markEvidenceIdsMigrated();
        return;
    }

    const readTx = db.transaction(
        [Table.EVIDENCE, Table.EVIDENCE_REQUIREMENTS],
        Permission.READONLY,
    );
    const evidence = await getAll<IDBEvidenceV2>(Table.EVIDENCE, readTx)();
    const links = await getAll<IDBEvidenceRequirement>(
        Table.EVIDENCE_REQUIREMENTS,
        readTx,
    )();

    // Resolve legacy id -> sha256 up front. Done before any write opens.
    const newIdByOldId = new Map<string, string>();
    for (const artifact of evidence) {
        if (SHA256_HEX.test(artifact.id)) {
            continue;
        }
        newIdByOldId.set(artifact.id, await sha256Hex(artifact.data));
    }

    const writeTx = db.transaction(
        [Table.EVIDENCE, Table.EVIDENCE_REQUIREMENTS],
        Permission.READWRITE,
    );
    const putEvidence = put<IDBEvidenceV2>(Table.EVIDENCE, writeTx);
    const deleteEvidence = remove(Table.EVIDENCE, writeTx);
    const putLink = put<IDBEvidenceRequirement>(
        Table.EVIDENCE_REQUIREMENTS,
        writeTx,
    );
    const deleteLink = remove(Table.EVIDENCE_REQUIREMENTS, writeTx);

    // Re-key the evidence. put() then delete() of the old key; the keys always
    // differ (legacy vs sha256). Distinct records with identical content collapse
    // onto the same sha256 key, matching deriveEvidence()'s dedupe-by-content.
    for (const artifact of evidence) {
        const id = newIdByOldId.get(artifact.id);
        if (!id || id === artifact.id) {
            continue;
        }
        await putEvidence({ ...artifact, id });
        await deleteEvidence(artifact.id);
    }

    // Repoint the only foreign key. The composite [evidence_id, requirement_id]
    // primary key dedupes any links that collapse together.
    for (const link of links) {
        const id = newIdByOldId.get(link.evidence_id);
        if (!id || id === link.evidence_id) {
            continue;
        }
        await deleteLink([link.evidence_id, link.requirement_id]);
        await putLink({ evidence_id: id, requirement_id: link.requirement_id });
    }

    await new Promise<void>((resolve, reject) => {
        writeTx.oncomplete = () => resolve();
        writeTx.onerror = () => reject(writeTx.error);
        writeTx.onabort = () => reject(writeTx.error);
    });

    markEvidenceIdsMigrated();
};

export const clear = (table: string) => async (): Promise<boolean> => {
    const store = await getStore(table, Permission.READWRITE);
    return new Promise<boolean>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
            resolve(true);
        };
        request.onerror = () => {
            reject(false);
        };
    });
};

class StoreWrapper<T> {
    public table: Table;
    getAll: (
        query?: IDBKeyRange | IDBValidKey | null,
        index?: string,
        count?: number,
    ) => Promise<T[]>;
    delete: (query: IDBKeyRange | IDBValidKey) => Promise<boolean>;
    put: (data: T, key?: Array<string>) => Promise<T[]>;
    clear: () => Promise<boolean>;
    store: (permission: Permission) => Promise<IDBObjectStore>;

    constructor(table: Table) {
        this.table = table;
        this.getAll = getAll<T>(table);
        this.put = put<T>(table);
        this.clear = clear(table);
        this.delete = remove(table);
        this.store = (permission: Permission = Permission.READONLY) =>
            getStore(table, permission);
    }
}

export class IDB {
    static requirements = new StoreWrapper<IDBRequirement>(Table.REQUIREMENTS);
    static securityRequirements = new StoreWrapper<IDBSecurityRequirement>(
        Table.SECURITY_REQUIREMENTS,
    );
    static evidence = new StoreWrapper<IDBEvidenceV2>(Table.EVIDENCE);
    static evidenceRequirements = new StoreWrapper<IDBEvidenceRequirement>(
        Table.EVIDENCE_REQUIREMENTS,
    );
    static examineEvidence = new StoreWrapper<IDBExamineEvidence>(
        Table.EXAMINE_EVIDENCE,
    );

    static version = version;
}
