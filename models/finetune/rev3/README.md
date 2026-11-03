# CMMC / NIST SP 800-171 SFT datasets

Fine-tuning data built from [nealfennimore/cmmc](https://github.com/nealfennimore/cmmc) `client/public/data/`.
Every answer is assembled from the source JSON by the generator scripts — no LLM-written content — so answers
are verbatim-faithful to the source documents.

| Dir | Source | train | valid | test | mcq_eval | corpus |
|---|---|---|---|---|---|---|
| `out/` | Rev. 2 + CMMC Assessment Guide L2 v2.13 (`sp_800_171_2_0_0`) | 5,387 | 283 | 775 | 440 | 110 |
| `out_r3/` | Rev. 3 + SP 800-171A Rev. 3 + DoD ODPs (`sp_800_171_3_0_0`) | 4,402 | 231 | 792 | 384 | 130 |
| `out_combined/` | both, one shared system prompt, `meta.rev` = 2 or 3 | 9,789 | 514 | 1,567 | 824 | 240 |

- `train` — SFT training. `valid` — eval loss (same phrasings as train). `test` — **held-out question
  phrasings**: same facts, wording never seen in training. `mcq_eval` — 4-option multiple choice with a gold
  `answer` letter for exact-match scoring. `corpus` — one full-text document per requirement (continued
  pretraining or RAG). `stats.json` — counts per task.
- Rows are chat format: `{"messages": [system, user, assistant, ...], "meta": {"task", "id"}}`. Drop `meta`
  before training (the script does). `--no-system` strips the system prompt.
- Train ≈ 850k tokens (Rev 2) / 780k (Rev 3), including the system prompt.

## Rev 2 tasks (`generate.py`)

Requirement statement lookup (CMMC ID, NIST number, name), statement → ID, NIST ↔ CMMC ID, family,
basic vs. derived, assessment objectives (all / single `AC.L2-3.1.1[c]` / reverse lookup), MET rule,
examine / interview / test objects, NIST discussion, CMMC further discussion, implementation examples,
scenario → requirement + objectives, potential assessment considerations (and which objectives each checks),
FAR 52.204-21 / Level 1 overlap, cross-references, examine artifact → requirements, Appendix A acronyms,
family / global counts, two-turn conversations, and negatives (`AC.L2-3.1.25`, `3.15.1`, wrong family prefixes).

## Rev 3 tasks (`generate_r3.py`)

Full requirement text (with nested items and `[Assignment: …]` placeholders), title ↔ ID, text → ID, family,
SP 800-171A determination statements (all / single `A.03.01.01.f.02` / count / reverse lookup), ODPs
(`A.03.01.01.ODP[01]`), **DoD ODP values** per parameter and per requirement, examine / interview / test objects,
discussion, SP 800-53 Rev. 5 source controls (both directions), NIST references (both directions),
**Rev 2 → Rev 3 transition** (same-number counterparts with both texts, 20 new requirements, 3 new families,
33 withdrawn requirements with reason and where they went, what each surviving requirement absorbed),
family / global facts, two-turn conversations, and negatives (`03.18.01`, out-of-range numbers, fake
determination IDs). Rev 3 prompts always say "Rev 3"/"800-171r3" or use the `03.xx.xx` ID format, so the
combined set doesn't contradict itself.

Deliberately **not** used: `values.json` SPRS scores. The Rev 2 values match the DoD Assessment Methodology,
but the Rev 3 values are this project's estimates (no official Rev 3 scoring exists), so training them in as
facts would teach the model unofficial numbers.

## Data issues found

Rev 2 (fixed in the generator; worth fixing upstream):
- PDF artefacts — mid-sentence paragraph breaks re-joined; lowercase list fragments turned into bullets; `[sic]` removed.
- `SI.L2-3.14.7` key_references contains the entire Appendix A acronym list — split out and reused as acronym data.
- `IA.L2-3.5.2` is missing its FAR 52.204-21 b.1.vi mapping — patched (`FAR_PATCH`).
- 8 requirements had the "Example" header inline — now split correctly (120 examples).

Rev 3 (not patched — no source to patch from):
- `03.01.22` and `03.14.03` have no examine / interview / test elements in `framework.json`, so those method
  questions are simply absent for them rather than answered with "none".

## Run it

```bash
python3 generate.py    /path/to/cmmc/client/public/data/sp_800_171_2_0_0 out      # stdlib only
python3 generate_r3.py /path/to/cmmc/client/public/data out_r3                    # reads Rev 2 too, for transition Qs
python3 combine.py out out_r3 out_combined

pip install "trl>=0.20" peft datasets transformers accelerate
python eval_mcq.py  --model Qwen/Qwen2.5-0.5B-Instruct --data out_combined/mcq_eval.jsonl                        # baseline
python train_sft.py --model Qwen/Qwen2.5-0.5B-Instruct --data out_combined                                       # LoRA
python eval_mcq.py  --model Qwen/Qwen2.5-0.5B-Instruct --adapter cmmc-lora --data out_combined/mcq_eval.jsonl    # compare
```

The train/eval scripts are starters — syntax-checked, not run on a GPU here.

## Things to try

1. Baseline vs. fine-tuned on `mcq_eval`. Memorization: `mcq_statement_to_id`, `mcq_title_to_id`,
   `mcq_*_count`, `mcq_dod_odp`. Understanding: `mcq_scenario` (Rev 2).
2. Train on Rev 2 only, then score Rev 3 `mcq_eval` (and vice versa) to see how much transfers vs. gets confused.
   Then train on `out_combined` and check whether `rev2_to_rev3` / `withdrawn` answers stay correct.
3. Generate on `test.jsonl` prompts and diff against the references to see whether the model generalizes to new
   phrasings or only memorized templates.
4. Change `n_train` per task (more phrasings per fact) and watch test performance move.
5. Compare SFT alone vs. a pass of continued pretraining on `corpus.jsonl` first.
6. Try with and without `--no-system`, and 1 vs. 3 epochs, to see where it starts overfitting (`valid` loss).
