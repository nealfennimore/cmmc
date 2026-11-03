#!/usr/bin/env python3
"""
Copy the chat template into tokenizer_config.json of an ONNX export.

transformers 5 saves the template as a separate chat_template.jinja file.
The app reads it from tokenizer_config.json: the manifest pins only
config.json, generation_config.json, tokenizer.json, and
tokenizer_config.json, the same layout as the onnx-community repos.
Without this step, apply_chat_template() fails in the app.

    python inline_chat_template.py runs/<model>/merged runs/<model>/onnx
"""
import json
import sys
from pathlib import Path

merged, dst = Path(sys.argv[1]), Path(sys.argv[2])
cfg_path = dst / "tokenizer_config.json"
cfg = json.loads(cfg_path.read_text())

if not cfg.get("chat_template"):
    jinja = merged / "chat_template.jinja"
    if jinja.exists():
        cfg["chat_template"] = jinja.read_text()
    else:
        merged_cfg = json.loads((merged / "tokenizer_config.json").read_text())
        cfg["chat_template"] = merged_cfg.get("chat_template")
    if not cfg["chat_template"]:
        raise SystemExit(f"no chat template in {merged}")
    cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    print(f"inlined the chat template into {cfg_path}")
else:
    print(f"{cfg_path} already has a chat template")

# The app never fetches this file, so do not ship it.
(dst / "chat_template.jinja").unlink(missing_ok=True)
