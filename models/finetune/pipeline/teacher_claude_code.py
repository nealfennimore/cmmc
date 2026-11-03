"""
Claude Code teacher backend for gen_drafts.py (--backend claude-code).

Each call runs the Claude Code CLI headless:
    claude -p --bare --tools "" --system-prompt <system> --output-format json
--bare skips hooks, CLAUDE.md, and MCP servers, and --tools "" disables all
tools, so the request carries only our system prompt and the user turn (a
probe call used 50 input tokens). The CLI uses its own credentials, for
example ANTHROPIC_BASE_URL plus ANTHROPIC_AUTH_TOKEN for the GoModel gateway.
No Python dependency: the CLI must be on PATH, or set CLAUDE_BIN.

-p takes one user turn, so a rewrite request folds the earlier draft and the
problems into a single user message.
"""
import json
import os
import shutil
import subprocess
import threading

from teacher_claude import EXCERPTS_SCHEMA


class ClaudeCodeTeacher:
    def __init__(self, model, effort):
        self.bin = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
        if not self.bin:
            raise SystemExit("claude CLI not found: put it on PATH or set CLAUDE_BIN")
        self.model, self.effort = model, effort
        self.lock = threading.Lock()
        self.usage = {"input_tokens": 0, "output_tokens": 0, "requests": 0, "cost_usd": 0.0}

    @staticmethod
    def flatten(messages):
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        turns = [m for m in messages if m["role"] != "system"]
        if len(turns) == 1:
            return system, turns[0]["content"]
        parts = [turns[0]["content"]]
        for m in turns[1:]:
            label = "Your previous response:" if m["role"] == "assistant" else "Feedback:"
            parts.append(f"{label}\n{m['content']}")
        return system, "\n\n".join(parts)

    def chat(self, messages, json_mode=False):
        system, prompt = self.flatten(messages)
        cmd = [self.bin, "-p", "--bare", "--model", self.model, "--effort", self.effort, "--tools", "",
               "--system-prompt", system, "--output-format", "json", "--no-session-persistence"]
        if json_mode:
            cmd += ["--json-schema", json.dumps(EXCERPTS_SCHEMA)]
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=900, cwd="/tmp")
        try:
            out = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise RuntimeError(f"claude exited {proc.returncode}: {(proc.stderr or proc.stdout)[:300]}")
        with self.lock:
            self.usage["requests"] += 1
            self.usage["cost_usd"] += out.get("total_cost_usd") or 0.0
            for k in ("input_tokens", "output_tokens"):
                self.usage[k] += (out.get("usage") or {}).get(k, 0)
        if out.get("is_error") or out.get("stop_reason") == "refusal":
            raise RuntimeError(f"claude error: {out.get('subtype')} {str(out.get('result'))[:300]}")
        if json_mode:
            if not isinstance(out.get("structured_output"), dict):
                raise RuntimeError("no structured_output in claude result")
            return json.dumps(out["structured_output"])
        return (out.get("result") or "").strip()
