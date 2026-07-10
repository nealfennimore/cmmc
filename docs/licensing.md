# Desktop licensing (keygen.sh)

The desktop (Tauri) builds support software licensing through
[keygen.sh](https://keygen.sh). The web app is never gated — licensing code
no-ops entirely outside the Tauri shell, and the static export contains no
license logic beyond the inert UI components.

Licensing is **disabled by default**: until the Keygen account constants are
filled in, every build (including forks) runs ungated. To turn it on, populate
`client/src-tauri/src/license/config.rs` and ship a release.

## How it works

- **Online activation, offline verification.** The user enters a license key
  once. The app validates it against the Keygen API, registers this machine
  (node-locked, fingerprint = SHA-256 of the OS machine id salted with the app
  identifier), and checks out a **machine file** — a certificate signed with
  the account's Ed25519 key, valid for up to 90 days but never longer than
  the license itself (a 30-day trial gets a ≤30-day certificate; an annual
  license in its final months gets correspondingly shorter ones). Every
  subsequent launch verifies that file locally; no network needed. When
  online and the file is older than 7 days, the app silently checks out a
  fresh one, so it never approaches the expiry cliff.
- **No local trial — the app gates immediately.** A fresh install shows a
  blocking activation screen until a key is entered. There is deliberately no
  client-side trial clock: anything tracked only in local files can be reset
  by deleting them, so evaluations run on trial license keys instead (below),
  whose expiry is enforced server-side at activation and inside the signed
  machine file. The trade-off: first launch requires a key and a one-time
  internet connection.
- **Trial licenses.** The trial mechanism is a Keygen-issued, time-limited
  key. A trial license is an ordinary license whose metadata contains
  `{ "trial": true }` (set per-license, or via a trial policy's default
  metadata) and whose policy sets an expiry (e.g. a 30-day `duration`). The
  app detects the flag inside the signed machine file and treats the key as a
  trial: a banner shows a countdown to the license expiry, the License modal
  labels it "Trial license" with an upgrade form, and when it lapses the gate
  shows trial-ended copy instead of renewal copy. Deleting local app data
  cannot restart a trial — an expired trial key stays expired. Activating a
  different (purchased) key at any point upgrades in place — the app frees
  the trial license's seat automatically.
- **All enforcement lives in Rust** (`client/src-tauri/src/license/`). The
  webview only receives a status summary over IPC (`license_status`,
  `license_activate`, `license_refresh`, `license_deactivate`) and renders UI
  accordingly (`client/src/app/components/license_gate.tsx`, the License entry
  in the navigation menu, and `client/src/app/context/license.tsx`).

State machine reported to the frontend: `disabled`, `unlicensed`, `licensed`,
`stale` (signed file lapsed — reconnect to refresh), `licenseExpired`,
`invalid` (file unreadable or for another machine).

License data lives in the Tauri app data dir under `license/`
(e.g. `~/.local/share/consulting.getcmmc.app/license/`): `license.json`
(key + Keygen ids) and `machine.lic` (the signed certificate).

## Keygen dashboard setup

1. Create a Keygen account (Cloud or self-hosted CE/EE).
2. From **Settings**, copy:
   - the **Account ID**
   - the **Ed25519 verify key** (hex)

   and paste them into `client/src-tauri/src/license/config.rs`
   (`KEYGEN_ACCOUNT_ID`, `KEYGEN_VERIFY_KEY_HEX`). These are public
   identifiers, not secrets — the verify key can only check signatures.
3. Create a **Product** (e.g. "CMMC Desktop").
4. Create a **Policy** under that product:
   - `authenticationStrategy`: **LICENSE** (activation authenticates with the
     license key itself — no tokens ship with the app)
   - `maxMachines`: number of devices per license (e.g. **3**), floating off
   - `machineUniquenessStrategy`: `UNIQUE_PER_LICENSE`
   - expiration to taste (perpetual or annual). If licenses expire, the app
     shows the renewal gate after expiry.
5. Issue licenses from the dashboard (or Keygen's hosted checkout / API) —
   the code has no dependency on policy or product ids, only the key.
6. **Trial licenses:** create a second policy (e.g. "Trial") under the same
   product with a `duration` (say 30 days, so licenses expire 30 days after
   creation) and the same LICENSE authentication / node-locked settings, and
   give it default license metadata of `{ "trial": true }` (or set that
   metadata on each trial license you issue). Keys issued from this policy
   activate exactly like paid keys but display as a trial with a countdown,
   and show upgrade copy when they lapse. Since the app has no built-in
   trial, these keys are how prospects evaluate it.

No CI changes are needed: the constants compile into the desktop binaries, the
web build never compiles the Rust side, and the browser bundle's license UI is
dormant without the Tauri IPC bridge.

## Verifying end-to-end

1. `cd client && npm run tauri:dev` (or `cargo tauri dev`) with the constants
   filled in.
2. Fresh install (delete the app-data `license/` dir) → blocking activation
   screen immediately; the app content stays inaccessible behind it.
3. Activate with a real key → state becomes Licensed (see the **License**
   entry in the navigation menu); the machine appears in the Keygen dashboard.
4. Kill networking (e.g. point `api.keygen.sh` at `127.0.0.1` in `/etc/hosts`)
   and relaunch → still licensed, fully offline.
5. Machine-limit and duplicate-fingerprint recovery can be exercised in dev
   builds with the `CMMC_FINGERPRINT_OVERRIDE` env var (debug builds only).
6. Deactivate from the License menu → seat freed in the dashboard, app returns
   to the activation screen.
7. Trial licenses: activate a key whose license metadata has
   `{ "trial": true }` → banner shows "Trial license — N days remaining" and
   the License modal shows the upgrade form; activate a paid key from there →
   state flips to Licensed and the trial license's machine seat is freed in
   the dashboard. After the trial key expires, deleting the app-data
   `license/` dir and re-activating it fails with expired-license copy.

Rust unit tests cover the certificate parsing/signature verification,
including trial-license detection: `cd client/src-tauri && cargo test`.

## Threat model notes

- This repo is open source: anyone can build an ungated binary. The gate
  protects the *distributed installers*, not the source.
- The machine file is signature-verified before being trusted or persisted, so
  spoofing `api.keygen.sh` at activation time cannot mint a working license.
  Verifying Keygen's signed API responses as well would harden activation
  further and is a possible follow-up.
- The license key is stored in plaintext in the app data dir. It grants
  nothing beyond what the (already-present) machine file grants, so OS
  keychain storage was skipped for simplicity.
