# CMMC

> [!IMPORTANT]
> CMMC assessments currently use **NIST 800-171 Revision 2**. This application supports **both Revision 2 and Revision 3**, so you can document compliance today and get ahead of the eventual move to Rev 3. Toggle between revisions at any time with the revision switch in the navigation bar. NIST provides a [change analysis](https://csrc.nist.gov/files/pubs/sp/800/171/r3/final/docs/sp800-171r2-to-r3-analysis.xlsx) describing what's different between the two.

It was challenging to find resources for [NIST 800-171](https://csrc.nist.gov/publications/detail/sp/800-171/rev-3/final) and [CMMC](https://dodcio.defense.gov/cmmc/About/) compliance, so this application was created to make writing SSP's a bit easier, without having to stare at an Excel spreadsheet.

By working through the 800-171 controls, you can record an implementation status and notes for each security requirement, attach supporting evidence, follow the assessor's guidance for Rev 2, track your estimated SPRS score, and generate a markdown System Security Plan and a POA&M — all from the browser, with your data never leaving your device.

![Demo](screenshots/demo.gif)

## Features

- Covers **both NIST 800-171 Rev 2 and Rev 3**, with a one-click revision toggle
- Stores all data client-side using [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) — no servers, no accounts
- Record an **implementation status** (implemented, partially implemented, not applicable, not implemented, not started) and **markdown notes** for every security requirement
- Live **SPRS score** as you work, including an estimated Rev 3 score that maps withdrawn Rev 2 control values into their Rev 3 replacements
- Attach **evidence** to any requirement — uploaded files, pasted images, or external URLs — and review it all from one place
- **Assessment Guidance for Rev 2** — built-in assessor guidance for each requirement, including an interactive checklist of the evidence types you've collected (see below)
- Generates a markdown report of every status and note (great for a System Security Plan)
- Generates a POA&M in CSV for unimplemented requirements
- Exports an evidence map and lets you export/import the entire database for archival or transfer
- Status icons and per-family/requirement rollups so you can see progress at a glance
- Works offline as an installable PWA via service workers, or as a native desktop app for macOS, Windows, and Linux (see [Download](#download))

### Assessment Guidance (Rev 2)

Each Rev 2 requirement page includes a collapsible **Assessment Guidance** panel, sourced from the CMMC Level 2 Assessment Guide, that explains how an assessor determines the requirement is met:

- **Discussion & examples** — plain-language explanation and worked scenarios for the requirement
- **Assessment methods** — Examine, Interview, and Test, each with an info popover giving its definition and a concrete example
- **Examine checklist** — tick off the evidence types your organization has actually collected; an at-a-glance count (e.g. `Examine 3/15`) shows on the panel header, and a note reminds you that not every listed item is required to meet the control. These selections are saved locally and are included in database export/import.
- **Potential assessment considerations** — the kinds of questions an assessor may ask
- **Key references** — the underlying NIST 800-171 and FAR citations

## Download

There are three ways to run the app. They each keep their own local data, so use **Export / Import Database** (upper-right menu) to move your work between them.

### Web — no install

Open [**app.getcmmc.consulting**](https://app.getcmmc.consulting/) in any modern browser. It works fully offline and can be **installed as a PWA** (use the install icon in the address bar) for an app-like experience.

### Desktop — native, fully offline

Signed installers are published on the [**Releases**](https://github.com/nealfennimore/cmmc/releases/latest) page. Grab the file for your platform:

| Platform                    | File                                     |
| --------------------------- | ---------------------------------------- |
| **macOS — Apple Silicon**   | `CMMC_<version>_aarch64.dmg`             |
| **macOS — Intel**           | `CMMC_<version>_x64.dmg`                 |
| **Windows**                 | `CMMC_<version>_x64-setup.exe` or `.msi` |
| **Linux — Debian / Ubuntu** | `CMMC_<version>_amd64.deb`               |
| **Linux — Fedora / RHEL**   | `CMMC-<version>-1.x86_64.rpm`            |

> [!NOTE]
> The desktop app stores its data separately from the browser/PWA version — moving between them is a manual **Export / Import Database**.

## Usage

1. Go to the [CMMC app](https://app.getcmmc.consulting/)
2. (Optional) Use the revision switch in the top navigation to pick **Rev 2** or **Rev 3**
3. Work through the security requirements for a family
4. Set whether each requirement is implemented, and add any notes
5. Attach evidence — drag in a file, paste an image, or add a URL — to back up your statuses
6. On a Rev 2 requirement, expand **Assessment Guidance** to review the assessor's discussion, methods, and considerations, and check off the evidence you've collected
7. Open the upper-right menu to:
   - **Generate Report** — download a markdown document of all statuses and notes
   - **Generate POAM** — download a CSV of gap items
   - **Export / Import Database** — save or restore your full dataset

![Evidence menu](screenshots/evidence-menu.png)

### Icon Meanings

- 🟢 A family, requirement, or security requirement is implemented.
- 🔴 A family, requirement, or security requirement is not implemented (e.g. any security requirement within a family/requirement is not implemented).
- 🟡 A family or requirement is partially implemented (e.g. any security requirement within a family/requirement is partially implemented).
- ⚫ A family, requirement, or security requirement is not applicable.
- ⚪ A family, requirement, or security requirement has not been started (default).
- 🚧 A family or requirement has remaining work.

## Privacy

All data is stored locally on your device using [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). There are no privacy concerns — no third-party tracking, no analytics, and no external servers are used by this application other than Github hosting the static assets.

## Development

The app is a statically-exported [Next.js](https://nextjs.org) project. The source lives in [`client/`](client/).

```bash
cd client
npm install
npm run dev    # start the dev server at http://localhost:3000
npm run build  # produce the static export in client/out
```

The 800-171 framework data in [`client/public/data`](client/public/data) is sourced from NIST (see [Resources](#resources)). The Rev 2 assessment guidance lives alongside it in [`assessment-guide-requirements.json`](client/public/data/sp_800_171_2_0_0/assessment-guide-requirements.json).

### Desktop app (Tauri)

The same static frontend can be packaged as a fully-offline native desktop app via [Tauri](https://tauri.app), producing small installers (`.dmg`, `.msi`, `.deb`, `.AppImage`) that bundle the entire 800-171 dataset — no network access required. The Tauri project lives in [`client/src-tauri/`](client/src-tauri/).

Prerequisites: the Tauri CLI, a [Rust toolchain](https://www.rust-lang.org/tools/install), and the WebKit/GTK system libraries for your platform (see Tauri's [prerequisites](https://tauri.app/start/prerequisites/)). On NixOS, `nix-shell` provides everything — Rust, WebKitGTK, and the `cargo-tauri` CLI are wired into [`shell.nix`](shell.nix). The `npm run tauri` script forwards to that CLI.

```bash
cd client
npm install

npm run tauri dev            # run the desktop app against the dev server
npm run tauri build          # produce native installers in src-tauri/target/release/bundle

# Regenerate the multi-platform icon set from the source PNG (optional):
npm run tauri icon public/web-app-manifest-512x512.png
```

External links (evidence URLs, citations, the consulting link) open in the system browser via [`tauri-plugin-opener`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/opener) rather than navigating the in-app webview.

Notes:

- **Storage is per-app.** The desktop app keeps its own IndexedDB store, separate from the browser/PWA. Use **Export / Import Database** to move data between them.
- **Routing.** When building under Tauri, `next.config.ts` switches to `trailingSlash` so routes resolve as `…/index.html` under Tauri's asset protocol; the web build keeps its clean URLs.
- **Distribution.** Tagged releases are built and signed by GitHub Actions ([`deploy.yml`](.github/workflows/deploy.yml)) and attached to the [Releases](https://github.com/nealfennimore/cmmc/releases) page.

## Resources

- [NIST 800-171 Revision 3 Final](https://csrc.nist.gov/publications/detail/sp/800-171/rev-3/final)
- Framework JSON used by the application, from [csrc.nist.gov](https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/sp_800_171_3_0_0/export/json?element=all)
- [CMMC Level 2 Assessment Guide](https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL2v2.pdf)
- [CMMC COA](https://cmmc-coa.com/) — another great CMMC resource

## License

This project is licensed under the MIT License and has no affiliation with NIST.

## Need help with CMMC?

This app is free and self-serve, but CMMC compliance can get involved. [**GetCMMC**](https://getcmmc.consulting/?utm_source=cmmc-app&utm_medium=readme) offers senior-led **CMMC 2.0 readiness and NIST 800-171 consulting** for DoD contractors — mock assessments, gap analysis with a prioritized remediation roadmap, SSP and POA&M development, and more. Every engagement is led directly by a Lead Certified CMMC Assessor (LCCA).

[Learn more at getcmmc.consulting →](https://getcmmc.consulting/?utm_source=cmmc-app&utm_medium=readme)
