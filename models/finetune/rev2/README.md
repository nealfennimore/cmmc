# CMMC Level 2 SFT dataset

Fine-tuning data built from `client/public/data/sp_800_171_2_0_0` in
[nealfennimore/cmmc](https://github.com/nealfennimore/cmmc) (CMMC Assessment Guide – Level 2 v2.13,
NIST SP 800-171 Rev. 2). Every answer is assembled from the source JSON by `generate.py` —
no LLM-written content — so answers are verbatim-faithful to the guide.

## Files (`out/`)

| File | Rows | Use |
|---|---|---|
| `train.jsonl` | 5,387 | SFT training (~850k tokens incl. system prompt) |
| `valid.jsonl` | 283 | eval loss during training (same phrasings as train) |
| `test.jsonl` | 775 | **held-out question phrasings** — same facts, wording never seen in training |
| `mcq_eval.jsonl` | 440 | 4-option multiple choice with gold `answer` letter, for exact-match scoring |
| `corpus.jsonl` | 110 | one full-text document per requirement (continued pretraining or RAG) |
| `stats.json` | | counts per task and split |

Rows are chat format: `{"messages": [system, user, assistant, ...], "meta": {"task", "id"}}`.
Drop `meta` before training (the script does). `--no-system` strips the system prompt if you'd rather not bake it in.

## Task mix

Requirement statement lookup (by CMMC ID, NIST number, name), statement → ID, NIST ↔ CMMC ID mapping,
family / basic-vs-derived, all assessment objectives, single objective (`AC.L2-3.1.1[c]`), objective → requirement,
MET rule, examine / interview / test objects, NIST discussion, CMMC further discussion, implementation examples,
scenario → requirement + objectives, potential assessment considerations (and which objectives each one checks),
FAR 52.204-21 / Level 1 overlap, cross-referenced requirements, examine artifact → requirements (287 artifacts),
Appendix A acronyms, 14-family / global counts, short two-turn conversations, and **negatives** (nonexistent IDs like
`AC.L2-3.1.25`, `3.15.1`, wrong family prefixes) so the model learns to say "that doesn't exist" instead of inventing one.

## Data fixes applied

- PDF artefacts: mid-sentence paragraph breaks re-joined; lowercase list fragments turned into bullets; `[sic]` removed.
- `SI.L2-3.14.7` key_references contained the entire Appendix A acronym list — split out (and reused as acronym data).
- `IA.L2-3.5.2` was missing its FAR 52.204-21 b.1.vi mapping — patched (`FAR_PATCH` in `generate.py`).
- Examples whose "Example" header was inline (8 requirements) are now split correctly; 120 examples total.
- Worth fixing upstream in the repo too.

## Run it

```bash
python3 generate.py /path/to/cmmc/client/public/data/sp_800_171_2_0_0 out   # regenerate (stdlib only)

pip install "trl>=0.20" peft datasets transformers accelerate
python eval_mcq.py --model Qwen/Qwen2.5-0.5B-Instruct                       # 1. baseline score
python train_sft.py --model Qwen/Qwen2.5-0.5B-Instruct --data out           # 2. LoRA fine-tune
python eval_mcq.py --model Qwen/Qwen2.5-0.5B-Instruct --adapter cmmc-lora   # 3. compare
```

The train/eval scripts are starters — they were syntax-checked but not run on a GPU here.

## Things to try

1. Baseline vs. fine-tuned on `mcq_eval` — `mcq_statement_to_id` and `mcq_objective_count` show memorization; `mcq_scenario` shows understanding.
2. Generate on `test.jsonl` prompts and diff against the reference answers to see whether the model generalizes to new phrasings or only memorized templates.
3. Change `n_train` per task in `generate.py` (more phrasings per fact) and watch how test performance moves.
4. Compare SFT alone vs. a pass of continued pretraining on `corpus.jsonl` first.
5. Try with and without `--no-system`, and with 1 vs. 3 epochs, to see where it starts overfitting (`valid` loss).
