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
        request.onsuccess = (event) => {
            const db = event.target?.result as IDBDatabase;
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
