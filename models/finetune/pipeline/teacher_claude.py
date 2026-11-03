"""
Claude teacher backend for gen_drafts.py (--backend claude), through the
official Anthropic Python SDK.

Credentials and endpoint come from the environment, as for Claude Code:
ANTHROPIC_BASE_URL plus ANTHROPIC_AUTH_TOKEN (the GoModel gateway), or
ANTHROPIC_API_KEY for the Anthropic API directly.

Claude Opus 5.5 notes:
- Thinking is always on. Effort (output_config.effort) is the only control,
  and its default is "medium". gen_drafts.py sets it explicitly.
- No temperature: sampling parameters return a 400 on current models.
- Server-side refusal fallback ("default" form) is on unless --no-fallback.
  If the gateway rejects the beta header, run with --no-fallback.
"""
import json
import threading

FALLBACK_BETA = "server-side-fallback-2026-07-01"

EXCERPTS_SCHEMA = {
    "type": "object",
    "properties": {
        "excerpts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"filename": {"type": "string"}, "text": {"type": "string"}},
                "required": ["filename", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["excerpts"],
    "additionalProperties": False,
}


class ClaudeTeacher:
    def __init__(self, model, effort, fallback=True):
        import anthropic  # here, so that teacher_claude_code can import the schema without the SDK

        self.client = anthropic.Anthropic(max_retries=4)
        self.model, self.effort, self.fallback = model, effort, fallback
        self.lock = threading.Lock()
        self.usage = {"input_tokens": 0, "output_tokens": 0, "requests": 0}

    def chat(self, messages, max_tokens, json_mode=False):
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        convo = [m for m in messages if m["role"] != "system"]
        output_config = {"effort": self.effort}
        if json_mode:
            output_config["format"] = {"type": "json_schema", "schema": EXCERPTS_SCHEMA}
        kwargs = dict(model=self.model, max_tokens=max_tokens, system=system, messages=convo,
                      output_config=output_config)
        if self.fallback:
            response = self.client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
        else:
            response = self.client.messages.create(**kwargs)

        with self.lock:
            self.usage["input_tokens"] += response.usage.input_tokens
            self.usage["output_tokens"] += response.usage.output_tokens
            self.usage["requests"] += 1
        if response.stop_reason == "refusal":
            raise RuntimeError(f"refusal: {response.stop_details}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("hit max_tokens")
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if json_mode:
            json.loads(text)  # structured output guarantees valid JSON; fail loudly if not
        return text
