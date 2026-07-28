"use client";
import {
    IDB,
    IDBEvidenceRequirement,
    IDBEvidenceV3,
    IDBRequirement,
    IDBSecurityRequirement,
} from "@/app/db";
import { useEffect, useState } from "react";

export const useDBRequirements = () => {
    const [dbRequirements, setDBRequirements] = useState(
        undefined as IDBRequirement[] | undefined,
    );

    useEffect(() => {
        async function fetchInitialState() {
            const reqs = await IDB.requirements.getAll();
            setDBRequirements(reqs);
        }
        fetchInitialState();
    }, []);

    return dbRequirements;
};
export const useDBSecurityRequirements = () => {
    const [dbRequirements, setDBRequirements] = useState(
        undefined as IDBSecurityRequirement[] | undefined,
    );

    useEffect(() => {
        async function fetchInitialState() {
            const reqs = await IDB.securityRequirements.getAll();
            setDBRequirements(reqs);
        }
        fetchInitialState();
    }, []);

    return dbRequirements;
};
export const useDBEvidence = () => {
    const [dbEvidence, setDBEvidence] = useState(
        undefined as IDBEvidenceV3[] | undefined,
    );

    useEffect(() => {
        async function fetchInitialState() {
            const reqs = await IDB.evidence.getAll();
            setDBEvidence(reqs);
        }
        fetchInitialState();
    }, []);

    return dbEvidence;
};

export const useDBEvidenceRequirements = () => {
    const [dbEvidenceRequirements, setDBEvidenceRequirements] = useState(
        undefined as IDBEvidenceRequirement[] | undefined,
    );

    useEffect(() => {
        async function fetchInitialState() {
            const reqs = await IDB.evidenceRequirements.getAll();
            setDBEvidenceRequirements(reqs);
        }
        fetchInitialState();
    }, []);

    return dbEvidenceRequirements;
};
