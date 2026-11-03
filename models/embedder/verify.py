#!/usr/bin/env python3
"""
Gate for the q8 export: the CLS vectors of the int8 ONNX model must stay
close to the fp32 PyTorch reference, and the ranking of a small query set
must not change.

    uv run --project ../finetune/pipeline/onnx python verify.py --src runs/X/source --onnx runs/X/onnx/onnx/model_quantized.onnx
"""
import argparse
from pathlib import Path

import numpy as np
import onnxruntime
import torch
from transformers import AutoModel, AutoTokenizer

ap = argparse.ArgumentParser()
ap.add_argument("--src", type=Path, required=True)
ap.add_argument("--onnx", type=Path, required=True)
ap.add_argument("--min-cosine", type=float, default=0.98)
args = ap.parse_args()

QUERIES = [
    "Limit system access to authorized users, processes acting on behalf of authorized users, and devices.",
    "Use multifactor authentication for local and network access to privileged accounts.",
    "Protect the confidentiality of CUI at rest.",
]
PASSAGES = [
    "All remote VPN logins require a Duo push in addition to the user password. Administrators also use a hardware token.",
    "Laptops use BitLocker full-disk encryption with XTS-AES 256. Recovery keys are escrowed in Entra ID.",
    "Accounts are provisioned through a ServiceNow request that the system owner approves. HR offboarding disables the account the same day.",
    "The cafeteria is open from 7 a.m. to 3 p.m. on weekdays.",
]

tok = AutoTokenizer.from_pretrained(args.src)
ref_model = AutoModel.from_pretrained(args.src, torch_dtype=torch.float32).eval()
session = onnxruntime.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
input_names = {i.name for i in session.get_inputs()}


def normalize(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def reference(texts):
    batch = tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
    with torch.no_grad():
        return normalize(ref_model(**batch).last_hidden_state[:, 0].numpy())


def quantized(texts):
    batch = tok(texts, padding=True, truncation=True, max_length=512, return_tensors="np")
    feeds = {k: v.astype(np.int64) for k, v in batch.items() if k in input_names}
    return normalize(session.run(None, feeds)[0][:, 0])


texts = QUERIES + PASSAGES
ref, q8 = reference(texts), quantized(texts)
cos = (ref * q8).sum(axis=1)
print("cosine(fp32, q8) per text:", np.round(cos, 4).tolist())
failed = cos.min() < args.min_cosine

n = len(QUERIES)
ref_rank = np.argsort(-(ref[:n] @ ref[n:].T), axis=1)
q8_rank = np.argsort(-(q8[:n] @ q8[n:].T), axis=1)
print("fp32 top passage per query:", ref_rank[:, 0].tolist())
print("q8   top passage per query:", q8_rank[:, 0].tolist())
# Query i is about passage i (access, MFA, encryption) — a sanity check
# that the model itself retrieves, not only that q8 matches fp32.
if ref_rank[:, 0].tolist() != [2, 0, 1]:
    print("WARN: the fp32 reference ranks an unexpected passage first")
if not np.array_equal(ref_rank[:, 0], q8_rank[:, 0]):
    print("FAIL: q8 changes the top passage")
    failed = True
if failed:
    raise SystemExit(f"FAIL: q8 export diverges from fp32 (min cosine {cos.min():.4f})")
print(f"OK: min cosine {cos.min():.4f} >= {args.min_cosine}")
