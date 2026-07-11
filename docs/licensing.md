# Desktop licensing (keygen.sh)

The desktop (Tauri) builds support software licensing through
[keygen.sh](https://keygen.sh). The web app is never license-gated — licensing
code no-ops entirely outside the Tauri shell, and the static export contains
no license logic beyond the inert UI components.

## Free web tier (CMMC Level 1)

Separately from Keygen licensing, the public web build is limited at **build
time** to the 17 CMMC Level 1 practices (FAR 52.204-21) plus their Rev 3
equivalents; all other requirements render locked-but-visible with an upgrade
CTA. This is controlled by `NEXT_PUBLIC_TIER=free`, set only in the web deploy
job (`deploy.yml`) — desktop builds and local dev are always full-tier.

- Source of truth: `client/src/app/utils/tier.ts` (the 17 Rev 2 IDs are
  hardcoded — the vendored assessment-guide data misflags `03.01.02`, so no
  data-driven rule is reliable; a dev-mode check warns on drift). The Rev 3
  set is derived from `values.json`'s withdrawn-mapping.
- Locked requirements: listed with a 🔒 badge, detail pages show saved data
  **read-only** (grandfathering) with an upgrade banner; all writes and
  evidence attach/paste/delete are disabled.
- **Reports and exports are never gated**: the SSP markdown, POA&M CSV,
  evidence map, evidence download, and database export/import are always
  complete on both tiers — users can always get all of their information
  out. The free tier gates interactive editing only.
- The SPRS tile becomes "Level 1: X of N implemented" (N = 17 on Rev 2, 12 on
  Rev 3 — the derived set).
- Preview locally with `npm run dev:free`.
- This is positioning/friction, not security: the gating is client-side in a
  public static export. Circumventing it in distributed form is restricted by
  the project license (ELv2), like the desktop license gate.

Licensing is **disabled by default**: until the Keygen account constants are
filled in, every build (including forks) runs ungated. To turn it on, populate
`client/src-tauri/src/license/config.rs` and ship a release.

## How it works

- **Online activation, offline verification.** The user enters a license key
  once. The app validates it against the Keygen API, registers this machine
  (node-locked, fingerprint = SHA-256 of the OS machine id salted with the app
  identifier), and checks out a **machine file** — a certificate signed with
  the account's Ed25519 key, valid for up to 30 days but never longer than
  the license itself (a shorter trial gets a correspondingly shorter
  certificate; an annual license in its final month too). Every subsequent
  launch verifies that file locally; no network needed. When online and the
  file is older than 7 days, the app silently checks out a fresh one, so it
  never approaches the expiry cliff. The 30-day ceiling also bounds how long a
  copied license file can keep working on another machine; air-gapped devices,
  which can't refresh, trade that off with a longer manual TTL (below).
- **No local trial — the app gates immediately.** A fresh install shows a
  blocking activation screen until a key is entered. There is deliberately no
  client-side trial clock: anything tracked only in local files can be reset
  by deleting them, so evaluations run on trial license keys instead (below),
  whose expiry is enforced server-side at activation and inside the signed
  machine file. The trade-off: first launch requires a key and a one-time
  internet connection — except air-gapped devices, which import a machine
  file checked out elsewhere (see below).
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
  `license_activate`, `license_import`, `license_refresh`,
  `license_deactivate`) and renders UI
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

## Air-gapped devices (manual license files)

A device that can never go online is licensed by importing a machine file
that was checked out on a connected machine. The imported file goes through
exactly the same Ed25519 verification and fingerprint binding as an online
checkout — nothing about the trust model is relaxed.

1. On the air-gapped device, open the activation screen → **"This device
   can't go online?"** → copy the **device fingerprint**.
2. On any machine with internet access (only the license key is needed —
   no account tokens):

   ```bash
   ACCOUNT=<account-id> KEY=<license-key> FP=<device-fingerprint>

   # Look up the license id
   LICENSE_ID=$(curl -s -X POST "https://api.keygen.sh/v1/accounts/$ACCOUNT/licenses/actions/validate-key" \
     -H 'Content-Type: application/vnd.api+json' -H 'Accept: application/vnd.api+json' \
     -d "{\"meta\":{\"key\":\"$KEY\"}}" | jq -r '.data.id')

   # Register the device (consumes a seat, like any activation).
   # Skip this step when renewing — the machine is already registered.
   curl -s -X POST "https://api.keygen.sh/v1/accounts/$ACCOUNT/machines" \
     -H "Authorization: License $KEY" \
     -H 'Content-Type: application/vnd.api+json' -H 'Accept: application/vnd.api+json' \
     -d "{\"data\":{\"type\":\"machines\",\"attributes\":{\"fingerprint\":\"$FP\",\"platform\":\"offline\",\"name\":\"air-gapped\"},\"relationships\":{\"license\":{\"data\":{\"type\":\"licenses\",\"id\":\"$LICENSE_ID\"}}}}}" >/dev/null

   # Check out the machine file (machines are addressable by fingerprint).
   # ttl: validity in seconds — 31536000 = 1 year; Keygen's minimum is 1 hour.
   # include=license is REQUIRED: the app rejects files without the embedded
   # license (it needs the key and ids inside for refresh/deactivation).
   curl -s -X POST "https://api.keygen.sh/v1/accounts/$ACCOUNT/machines/$FP/actions/check-out?ttl=31536000&include=license,license.entitlements" \
     -H "Authorization: License $KEY" -H 'Accept: application/vnd.api+json' \
     | jq -r '.data.attributes.certificate' > machine.lic
   ```

3. Move `machine.lic` to the device (USB etc.) and import it from the same
   **"This device can't go online?"** panel. The app verifies the signature,
   the fingerprint binding, and the validity window before trusting it.
4. **Renewal:** before "Works offline until" passes, re-run just the check-out
   step and import the fresh file — from the License modal, or from the gate
   if the old file already lapsed. Nothing is lost when a file lapses;
   the app simply gates until a fresh file is imported (or the device gets
   online once).

Notes:

- **Pick the TTL to match your risk tolerance.** Revocations, suspensions and
  seat changes only reach an air-gapped device when it imports a fresh file,
  so a 1-year TTL means up to a year of exposure. (Online devices refresh
  weekly.) The TTL is also capped by the license's own expiry.
- **The device clock matters.** Files "issued in the future" beyond a 24-hour
  tolerance are rejected (rollback protection), so a badly wrong clock on the
  air-gapped device surfaces as a stale-file error at import.
- **Freeing the seat** must be done from the Keygen dashboard (delete the
  machine) — in-app deactivation needs the network.
- If the device later does get connectivity, everything behaves like a normal
  activation from then on (background refresh, updates, deactivation).



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
7. Air-gapped import: from a fresh install, copy the fingerprint from the
   gate's "This device can't go online?" panel, run the checkout steps above
   on another machine, and import the resulting `machine.lic` → state becomes
   Licensed without the app ever touching the network. Importing a file made
   for a different fingerprint must fail with wrong-device copy.
8. Trial licenses: activate a key whose license metadata has
   `{ "trial": true }` → banner shows "Trial license — N days remaining" and
   the License modal shows the upgrade form; activate a paid key from there →
   state flips to Licensed and the trial license's machine seat is freed in
   the dashboard. After the trial key expires, deleting the app-data
   `license/` dir and re-activating it fails with expired-license copy.

Rust unit tests cover the certificate parsing/signature verification
(including trial-license detection), the API response-signature verification,
and the machine-file import validation: `cd client/src-tauri && cargo test`.

## Auto-updates (Keygen tauri engine)

The desktop app self-updates through [Keygen's Tauri distribution
engine](https://keygen.sh/docs/api/engines/#engines-tauri): CI mirrors each
release into a Keygen **package**, and the app checks
`/v1/accounts/<account>/engines/tauri/<package>` with
`Authorization: License <key>`. Update checks therefore require an **active
license** — lapsed annual licenses stop receiving updates, and the LICENSED
distribution strategy enforces the same on downloads.

Platform behavior:

- **macOS / Windows** — full in-place updates via `tauri-plugin-updater`
  (`.app.tar.gz` per arch; NSIS `-setup.exe`). Updater artifacts are signed
  with a dedicated Tauri signing key, independent of OS code signing.
- **Linux** — notify-only (`.deb`/`.rpm` can't self-update; AppImage is
  disabled). The app queries the engine directly and the banner links to
  `UPDATE_DOWNLOAD_URL` (config.rs). The `.deb`/`.rpm` files are uploaded to
  Keygen as unsigned "version beacons" so the check has something to find.

The app checks silently ~8s after launch when licensed, and manually via
**License → Check for updates**. Config: `KEYGEN_PACKAGE` in
`client/src-tauri/src/license/config.rs` (empty string disables update checks
entirely) and `plugins.updater.pubkey` in `tauri.conf.json`.

### One-time setup

1. Dashboard → **Packages** → new package under the product: key `cmmc`,
   engine **tauri**. (Product `distributionStrategy` stays `LICENSED`, the
   default.)
2. Dashboard → **Tokens** → create a **product token** → repo secret
   `KEYGEN_TOKEN`. Add repo variable `KEYGEN_PRODUCT_ID` (the product's id).
3. Generate the updater signing keypair once:
   `npm run tauri signer generate -- -w ~/.tauri/cmmc-updater.key`
   - Public key → `plugins.updater.pubkey` in `tauri.conf.json` (currently an
     empty placeholder — updates won't verify until this is set).
   - Private key → repo secret `TAURI_SIGNING_PRIVATE_KEY`; its password →
     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - **Back up the private key.** Losing it permanently strands existing
     installs (they'd reject anything signed with a new key) — recovery means
     asking every user to manually reinstall.

| CI credential | Kind | Purpose |
| --- | --- | --- |
| `KEYGEN_TOKEN` | secret | product token; `keygen-upload` job no-ops without it |
| `KEYGEN_PRODUCT_ID` | variable | keygen CLI product scope |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | signs updater artifacts; also switches `createUpdaterArtifacts` on |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | password for the key above |

### How releases flow

Tag push → desktop jobs build (with updater artifacts when the signing key is
set) → `keygen-upload` creates Keygen release `<tag minus v>`, uploads the
artifacts **with their signatures** (Keygen does not read `.sig` files
automatically), publishes it → only then does `publish-release` make the
GitHub release public.

**Important:** the engine resolves the *client's current version* as a Keygen
release — a version that was never uploaded gets `204 No Content` (silently
"no update") forever. If a shipped tag ever misses its Keygen upload, backfill
a bare release so that cohort can update again:

```bash
KEYGEN_TOKEN=... KEYGEN_ACCOUNT_ID=... KEYGEN_PRODUCT_ID=... \
  keygen new --version <shipped-version> --channel stable --package cmmc
keygen publish --release <shipped-version> --package cmmc
```

The app version comes from `client/package.json` (`tauri.conf.json` points its
`version` at it); CI overrides it with the release tag. A dev build's version
usually has no published Keygen release yet → checks return "up to date".
That's expected.

## Threat model notes

- The repo is source-available under the Elastic License 2.0 (see
  `LICENSE.md`), whose terms forbid removing or circumventing the license-key
  functionality — so building an ungated binary from source is a license
  violation, not just a technical exercise. (Versions ≤ 1.0.0 were MIT and
  remain so; the ELv2 protection applies to code from the switch onward.)
- The machine file is signature-verified before being trusted or persisted, so
  spoofing `api.keygen.sh` at activation time cannot mint a working license.
- Every Keygen API response consumed during activation is additionally
  verified against the account's Ed25519 key using Keygen's [signed-response
  scheme](https://keygen.sh/docs/api/signatures/) (`license/sig.rs`): the
  `Keygen-Signature` header binds the response body (via its SHA-256 digest),
  the exact endpoint including query string, and the response date, and
  responses older than 5 minutes are rejected as replays. So a spoofed
  `api.keygen.sh` can't alter or replay validation/activation responses
  either. Two consequences: activation needs a roughly correct system clock
  (±5 minutes), and since Keygen leaves a few error payloads unsigned
  (malformed requests, internal errors), a *missing* signature is tolerated
  only on error responses — which grant nothing — while an invalid one is
  always fatal (surfaced as the `SIGNATURE` error code).
- The license key is stored in plaintext in the app data dir. It grants
  nothing beyond what the (already-present) machine file grants, so OS
  keychain storage was skipped for simplicity.
