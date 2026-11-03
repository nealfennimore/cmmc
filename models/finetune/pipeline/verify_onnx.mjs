#!/usr/bin/env node
// Gate for export_onnx.sh: load runs/<model>/onnx with the app's own
// transformers.js (client/node_modules, the version the worker ships) and
// generate one answer. A file that fails here would fail in the app.
//
//   node verify_onnx.mjs llama-3.2-1b-instruct
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const client = join(here, "../../../client/node_modules/@huggingface/transformers");
const { env, AutoTokenizer, AutoModelForCausalLM } = await import(join(client, "dist/transformers.node.mjs"));

const id = process.argv[2];
const dtypes = { "gemma-3-270m-it": "q8", "llama-3.2-1b-instruct": "q4f16", "llama-3.2-3b-instruct": "q4f16" };
if (!dtypes[id]) throw new Error(`usage: node verify_onnx.mjs <${Object.keys(dtypes).join("|")}>`);

if (!existsSync(join(here, "runs", id, "onnx", "config.json"))) {
    console.error(`FAIL: runs/${id}/onnx is missing. Run ./export_onnx.sh ${id} first.`);
    process.exit(1);
}
env.allowRemoteModels = false;
env.localModelPath = join(here, "runs", id) + "/";
const opts = { dtype: dtypes[id], use_external_data_format: 1 };
const tokenizer = await AutoTokenizer.from_pretrained("onnx");
const model = await AutoModelForCausalLM.from_pretrained("onnx", opts);

const messages = [{ role: "user", content: "What is the NIST SP 800-171 Rev. 2 number for AC.L2-3.1.1?" }];
const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
const out = await model.generate({ ...inputs, max_new_tokens: 48, do_sample: false });
const text = tokenizer.batch_decode(out.slice(null, [inputs.input_ids.dims[1], null]), { skip_special_tokens: true })[0];
console.log(`${id} (${dtypes[id]}): ${JSON.stringify(text)}`);
if (!text.trim()) { console.error("FAIL: empty output"); process.exit(1); }
if (!text.includes("3.1.1")) console.warn("WARN: answer does not contain 3.1.1 (check the tuning, not the export)");
console.log("OK: the app runtime loads and runs the export");
