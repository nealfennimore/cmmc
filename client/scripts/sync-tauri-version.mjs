// Keeps the Tauri crate's version in lock-step with package.json. Runs as the
// npm "version" lifecycle hook (scripts/version.sh -> npm version <bump>), so
// the rewritten files are staged into the same release commit. The shipped app
// version itself comes from package.json (tauri.conf.json points at it); this
// only stops Cargo.toml/Cargo.lock drifting.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
);

const cargoToml = join(root, "src-tauri", "Cargo.toml");
// Only the [package] version sits at the start of a line; dependency versions
// are all inline table entries.
writeFileSync(
    cargoToml,
    readFileSync(cargoToml, "utf8").replace(
        /^version = ".*"$/m,
        `version = "${version}"`,
    ),
);

const cargoLock = join(root, "src-tauri", "Cargo.lock");
writeFileSync(
    cargoLock,
    readFileSync(cargoLock, "utf8").replace(
        /(\[\[package\]\]\nname = "cmmc"\nversion = )"[^"]*"/,
        `$1"${version}"`,
    ),
);

console.log(`Synced src-tauri Cargo.toml/Cargo.lock to ${version}`);
