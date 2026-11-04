{
  description = "Offline CMMC / NIST 800-171 compliance app (Tauri + Next.js)";

  inputs = {
    # Pinned via flake.lock — this is what makes the toolchain reproducible.
    # WebKitGTK is the reason the channel choice matters: 24.11's webkit 2.48.3
    # and 25.05's 2.48.x abort on current NixOS driver stacks with
    # "Could not create default EGL display: EGL_BAD_PARAMETER", while 25.11's
    # webkit 2.52.x is verified working on the same machine. (The earlier
    # "24.11 known-good" rollback was a red herring: dev builds kept loading the
    # newer webkit via RUNPATH entries cached in target/, so only clean builds
    # ever exercised 24.11's webkit — and it fails.) Rust is NOT taken from here
    # (see rust-overlay below), so the channel mainly supplies the system libs.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    agentbox.url = "github:nealfennimore/agent-sandbox";
    # Rust is pinned independently of nixpkgs: Tauri's transitive deps (zvariant,
    # darling, time, plist, ...) keep raising their MSRV, so the channel's rustc
    # is perpetually too old. The overlay lets us name an exact Rust version and
    # bump just `rustVersion` below when deps require it.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, agentbox }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        claudeCodeOverlay = final: prev: {
          claude-code = final.callPackage ./overlays/claude-code/package.nix { };
        };
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default claudeCodeOverlay ];
          config.allowUnfree = true;
        };
        inherit (pkgs) lib;
        isLinux = pkgs.stdenv.isLinux;

        # Bump this when a dependency's MSRV exceeds it (the build error names the
        # required version). Must be >= the highest MSRV in client/src-tauri/Cargo.lock.
        rustVersion = "1.88.0";
        rustToolchain = pkgs.rust-bin.stable.${rustVersion}.default;

        # System libraries WebKitGTK and the Tauri bundler link against. Linux
        # only; on macOS the webview is the system WKWebView.
        linuxLibs = with pkgs; [
          at-spi2-atk
          atkmm
          cairo
          gdk-pixbuf
          glib
          gtk3
          harfbuzz
          librsvg
          libsoup_3
          pango
          webkitgtk_4_1
          openssl
          dbus
          # Native inference (llama.cpp, src-tauri feature native-llm-vulkan):
          # the Vulkan loader links into the app; headers feed the build, and
          # ggml-vulkan's shader pipeline find_package()s the SPIR-V cmake
          # configs (SPIRV-Headers is a hard requirement, SPIRV-Tools its
          # sibling).
          vulkan-loader
          vulkan-headers
          spirv-headers
          spirv-tools
        ];

        linuxNativeTools = with pkgs; [
          pkg-config
          gobject-introspection
          wrapGAppsHook4
          # llama-cpp-sys-2 builds llama.cpp with cmake, runs bindgen for
          # the FFI (libclang via bindgenHook), and shaderc's glslc
          # compiles the Vulkan shaders.
          cmake
          shaderc
          rustPlatform.bindgenHook
        ];

        # rustToolchain provides cargo + rustc; cargo-tauri orchestrates them.
        # git is needed by next.config.ts to stamp the build's commit SHA.
        buildTools = [
          pkgs.nodejs
          pkgs.typescript
          pkgs.cargo-tauri
          pkgs.git
          rustToolchain
        ];

        # buildRustPackage normally uses the channel's rustc; swap in the pinned
        # toolchain so the package build gets the same MSRV story as the shells.
        rustPlatform = pkgs.makeRustPlatform {
          cargo = rustToolchain;
          rustc = rustToolchain;
        };

        # Single source of truth for the app version (release tags track this).
        appVersion =
          (builtins.fromJSON (builtins.readFile ./client/package.json)).version;

        # Local-AI model weights, pinned in the same manifest the runtime
        # downloader verifies against (single source of truth; regenerate an
        # entry with scripts/update-model-manifest.mjs). Each file is a
        # fixed-output fetch, so the build fails loudly if upstream content
        # ever changes. Entries without hashes are placeholders and are
        # skipped — the app then falls back to its verified runtime download.
        modelManifest = builtins.fromJSON
          (builtins.readFile ./client/src/app/llm/models.manifest.json);
        isPinnedEntry = model:
          model.revision != "" && model.files != [ ]
          && builtins.all (file: file.sha256 != "") model.files;
        pinnedModels = builtins.filter isPinnedEntry modelManifest.models;
        # The retrieval embedder (manifest "embedders",
        # docs/embedding-retrieval-plan.md). About 50 MB, so every desktop
        # bundle ships it: no bundlePlatforms filter applies.
        pinnedEmbedders =
          builtins.filter isPinnedEntry (modelManifest.embedders or [ ]);

        # Laid out as {repo}/{path} — exactly what transformers.js requests
        # under env.localModelPath ("/models/") in the bundled desktop app.
        weightsTree = name: models: pkgs.runCommand name { } ''
          mkdir -p $out
          ${lib.concatMapStrings (model:
            lib.concatMapStrings (file: ''
              install -D -m 444 ${
                pkgs.fetchurl {
                  url = file.url;
                  sha256 = file.sha256;
                }
              } "$out/${model.repo}/${file.path}"
            '') model.files) models}
        '';
        # Every pinned model: the .#model-weights cache that CI and
        # fetch-model-weights.mjs copy from — deliberately unfiltered, so a
        # macOS machine with Nix still gets its files from the store.
        modelWeights = weightsTree "cmmc-model-weights-${appVersion}"
          (pinnedModels ++ pinnedEmbedders);
        # What the Linux desktop package actually bundles: bundlePlatforms
        # absent or containing "linux". Every entry carries an empty list:
        # installers ship no LLM weights (GitHub caps release assets below
        # 2 GiB), and users add a model through the verified download/import
        # (docs/model-download-plan.md). The tree then holds only the
        # embedder.
        linuxBundledModels = builtins.filter
          (model:
            !(model ? bundlePlatforms)
            || builtins.elem "linux" model.bundlePlatforms)
          pinnedModels;
        linuxModelWeights =
          weightsTree "cmmc-model-weights-linux-${appVersion}"
            (linuxBundledModels ++ pinnedEmbedders);

        # WebKitGTK on NixOS: avoid GPU-compositing crashes and make TLS modules
        # resolvable so the Tauri webview can render and reach the network.
        # XDG_DATA_DIRS is *prefixed*, not replaced: children the app spawns
        # (xdg-open/gio via tauri-plugin-opener) resolve .desktop handlers
        # through it, and clobbering it blinded them to every installed app —
        # evidence files and URLs silently failed to open. Prefixing keeps our
        # schemas first for glib while the host's application database stays
        # visible. If the EGL_BAD_PARAMETER abort ever returns, suspect this
        # first — but the GIO module pinning below is what actually fixed it.
        linuxEnv = ''
          export WEBKIT_DISABLE_COMPOSITING_MODE=1
          export WEBKIT_DISABLE_DMABUF_RENDERER=1
          # WebKitGTK's memory-pressure monitor kills the web process at
          # conservative thresholds; loading local-AI model weights (hundreds
          # of MB in the worker + ONNX Runtime heap) trips it even with
          # plenty of free RAM.
          export WEBKIT_DISABLE_MEMORY_PRESSURE_MONITOR=1
          export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
          export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
          # onnxruntime-node (transformers.js dependency, Linux x64 only)
          # downloads CUDA binaries from GitHub in its install script. The app
          # only uses onnxruntime-web in the browser, so skip it — it would
          # also fail in any sandboxed/offline npm ci.
          export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
        '';

        # pkg-config with the Tauri system libraries' search path baked in.
        # The Claude sandbox launches without mkShell's setup hooks, so no
        # PKG_CONFIG_PATH is ever exported there; this wrapper is built *with*
        # those hooks, capturing the fully-resolved path — including
        # propagated deps like atk that a hand-written list would miss — at
        # build time. The baked store paths also keep the libraries (and
        # their .so files, for linking and running tests) in the closure.
        sandboxPkgConfig = pkgs.runCommand "sandbox-pkg-config"
          {
            nativeBuildInputs = [ pkgs.makeWrapper pkgs.pkg-config ];
            buildInputs = linuxLibs;
          } ''
          test -n "$PKG_CONFIG_PATH" # hooks must have populated it
          mkdir -p $out/bin
          makeWrapper ${pkgs.pkg-config}/bin/pkg-config $out/bin/pkg-config \
            --prefix PKG_CONFIG_PATH : "$PKG_CONFIG_PATH"
        '';

        claude = agentbox.lib.${system}.mkClaudeSandbox {
          pkg = pkgs.claude-code;
          extraPackages = [
            pkgs.ripgrep
            pkgs.jq
            pkgs.curl
            # models/finetune/pipeline runs through uv.
            pkgs.uv
          ] ++ buildTools
          # Let the sandbox compile and test the full src-tauri crate: a C
          # toolchain (cc/ld; its wrapper also rpaths -L dirs so test
          # binaries run) and the pre-wired pkg-config above.
          ++ lib.optionals isLinux [
            pkgs.stdenv.cc
            sandboxPkgConfig
          ];
          allowedDomains = agentbox.lib.${system}.agentDomains // {
            "crates.io" = "*";
            "keygen.sh" = "*";
            "defense.gov" = "*";
            "huggingface.co" = "*";        
            "buzz.54rockybrook.house" = "*";
            "fwdesktop.54rockybrook.house" = "*";
            "gomodel.54rockybrook.house" = "*";
            # Hindsight agent memory over MCP (modules/linux/machines/x86_64/hindsight).
            "hindsight.54rockybrook.house" = "*";
            "opencode.ai" = "*";

          };
          extraEnv = {
          ANTHROPIC_BASE_URL = "https://gomodel.54rockybrook.house";
          ANTHROPIC_AUTH_TOKEN = "$(/run/wrappers/bin/op read -n op://Private/GoModel/credential)";
          HINDSIGHT_MCP_TOKEN = "$(/run/wrappers/bin/op read -n op://Private/Hindsight/credential)";
          CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
          };
        };
      in
      {
        # `nix build` / `nix run` — the installable desktop app. Linux-only:
        # macOS builds go through the normal `cargo tauri build` .app/.dmg path.
        # `nix build .#model-weights` works on every system — CI and non-Nix
        # desktop builds use it to prefetch verified weights.
        packages = {
          model-weights = modelWeights;
        } // lib.optionalAttrs isLinux rec {
          default = cmmc;

          cmmc = rustPlatform.buildRustPackage {
            pname = "cmmc";
            version = appVersion;

            # The flake source is already git-filtered, so out/, .next/ and
            # node_modules/ never leak into the build.
            src = ./client;

            cargoRoot = "src-tauri";
            buildAndTestSubdir = "src-tauri";
            cargoLock.lockFile = ./client/src-tauri/Cargo.lock;

            # node_modules assembled from package-lock.json's own integrity
            # hashes — no fixed-output hash to keep in sync here.
            npmDeps = pkgs.importNpmLock { npmRoot = ./client; };

            nativeBuildInputs = [
              # Must come before cargo-tauri.hook: the hook propagates the
              # channel's cargo, and PATH follows input order — without this the
              # channel's older cargo/rustc would win and MSRV breaks again.
              rustToolchain
              # Runs `cargo tauri build` (deb bundle) and installs the bundle's
              # usr/ tree — binary, .desktop entry, and icons — into $out.
              pkgs.cargo-tauri.hook
              pkgs.nodejs
              pkgs.importNpmLock.npmConfigHook
              pkgs.pkg-config
              pkgs.gobject-introspection
              pkgs.wrapGAppsHook3 # webkitgtk_4_1 is GTK3-based
              # llama.cpp (native-llm-vulkan) builds through cmake, runs
              # bindgen (libclang via bindgenHook), and glslc compiles its
              # Vulkan shaders.
              pkgs.cmake
              pkgs.shaderc
              pkgs.rustPlatform.bindgenHook
            ];

            buildInputs = linuxLibs ++ [ pkgs.glib-networking ];

            # The native inference engine (src-tauri native.rs) is opt-in at
            # compile time; the Linux package is exactly the build that wants
            # it. cargo-tauri.hook forwards these to `cargo tauri build`.
            tauriBuildFlags = [ "--features" "native-llm-vulkan" ];

            env = {
              NEXT_TELEMETRY_DISABLED = "1";
              # next.config.ts footer stamps: no .git in the sandbox, so feed it
              # the version and (when the tree is clean enough to know) the rev.
              APP_VERSION = appVersion;
              # onnxruntime-node's install script downloads CUDA binaries from
              # GitHub — impossible in the build sandbox and unused anyway
              # (inference runs on onnxruntime-web in the webview).
              ONNXRUNTIME_NODE_INSTALL_CUDA = "skip";
            } // lib.optionalAttrs (self ? rev || self ? dirtyRev) {
              GITHUB_SHA = self.rev or self.dirtyRev;
            };

            # Stage the pinned model weights at public/models — the source
            # tauri.conf.json maps into the bundle's resources
            # (resource_dir()/models, read over IPC at runtime). They do NOT
            # ship inside the frontend export: npm postbuild strips
            # out/models (scripts/strip-model-assets.mjs) because embedding
            # gigabytes via generate_context! OOM-kills rustc. Plain copies,
            # not store symlinks, so the tree stays writable.
            # The hook may have entered src-tauri/ by preBuild time, so find
            # the frontend root (where public/ lives) relative to either cwd.
            # The condition counts the embedder too: every LLM entry has an
            # empty bundlePlatforms, so linuxBundledModels alone is empty.
            preBuild = lib.optionalString
              ((linuxBundledModels ++ pinnedEmbedders) != [ ]) ''
              frontend=.
              if [ ! -d "$frontend/public" ] && [ -d ../public ]; then
                frontend=..
              fi
              mkdir -p "$frontend/public/models"
              cp -r ${linuxModelWeights}/. "$frontend/public/models/"
              chmod -R u+w "$frontend/public/models"
            '';

            # No Rust tests, and `cargo test` would recompile the app with the
            # embedded frontend a second time for nothing.
            doCheck = false;

            # Mirror linuxEnv (the dev shell's known-good WebKitGTK setup).
            # Host GIO modules are dropped: the host session's newer-glib
            # modules (gvfs etc.) don't load against this app's older glib, and
            # that pollution is what the EGL_BAD_PARAMETER abort traced back
            # to. XDG_DATA_DIRS is left to wrapGAppsHook's own --prefix
            # handling (schemas first, host dirs kept): children the app
            # spawns (xdg-open/gio via tauri-plugin-opener) need the host's
            # .desktop database to open evidence files and URLs, and the old
            # --set override blinded them to it. (Launch-time env repair can't
            # live here: the hook emits a compiled binary wrapper that has no
            # --run support — the opener in src-tauri appends any missing
            # standard host data dirs instead.) These come after
            # wrapGAppsHook's own args, so the --set/--unset win over its
            # --prefix defaults.
            preFixup = ''
              gappsWrapperArgs+=(
                --set WEBKIT_DISABLE_COMPOSITING_MODE 1
                --set WEBKIT_DISABLE_DMABUF_RENDERER 1
                # Model loading trips webkit's memory-pressure kill threshold
                # (see linuxEnv above).
                --set WEBKIT_DISABLE_MEMORY_PRESSURE_MONITOR 1
                --set GIO_MODULE_DIR "${pkgs.glib-networking}/lib/gio/modules/"
                --unset GIO_EXTRA_MODULES
              )
            '';

            meta = {
              description = "Offline CMMC / NIST 800-171 compliance app";
              homepage = "https://github.com/nealfennimore/cmmc";
              mainProgram = "cmmc";
              platforms = lib.platforms.linux;
            };
          };
        };

        devShells = {
          # Lean shell for CI: just the pinned Tauri build toolchain.
          ci = pkgs.mkShell {
            buildInputs = buildTools ++ lib.optionals isLinux linuxLibs;
            nativeBuildInputs = lib.optionals isLinux linuxNativeTools;
            shellHook = lib.optionalString isLinux linuxEnv;
          };

          # Full local-dev shell: build toolchain + Python/Jupyter for notebooks.
          default = pkgs.mkShell {
            buildInputs = buildTools
              ++ lib.optionals isLinux linuxLibs
              ++ [ (pkgs.python312.withPackages (pp: [ pp.jupyter ])) ];
            nativeBuildInputs = lib.optionals isLinux linuxNativeTools;
            packages = [claude pkgs.uv];
            shellHook = lib.optionalString isLinux (linuxEnv + ''
              # PyPI wheels (torch in models/finetune/pipeline) need the C++
              # runtime and zlib, which NixOS does not expose globally.
              export LD_LIBRARY_PATH=${lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
              # The NVIDIA driver library (libcuda.so) lives here on NixOS.
              if [ -d /run/opengl-driver/lib ]; then
                export LD_LIBRARY_PATH=/run/opengl-driver/lib:$LD_LIBRARY_PATH
              fi
              # PyTorch needs /dev/nvidia-uvm, which does not load on its own after an eGPU hot-plug.
              if [ -e /dev/nvidia0 ] && [ ! -e /dev/nvidia-uvm ]; then
                echo "GPU attached but /dev/nvidia-uvm is missing. Run: sudo modprobe nvidia_uvm" >&2
              fi
            '') + ''
              [[ ! -d .venv ]] && python -m venv .venv
              source .venv/bin/activate
              if [[ -f requirements.txt ]]; then
                pip install -r requirements.txt --require-virtualenv
              fi
            '';
          };
        };
      });
}
