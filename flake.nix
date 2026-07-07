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
    # Rust is pinned independently of nixpkgs: Tauri's transitive deps (zvariant,
    # darling, time, plist, ...) keep raising their MSRV, so the channel's rustc
    # is perpetually too old. The overlay lets us name an exact Rust version and
    # bump just `rustVersion` below when deps require it.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
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
        ];

        linuxNativeTools = with pkgs; [
          pkg-config
          gobject-introspection
          wrapGAppsHook4
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

        # WebKitGTK on NixOS: avoid GPU-compositing crashes and make TLS modules
        # resolvable so the Tauri webview can render and reach the network.
        linuxEnv = ''
          export WEBKIT_DISABLE_COMPOSITING_MODE=1
          export WEBKIT_DISABLE_DMABUF_RENDERER=1
          export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH"
          export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
        '';
      in
      {
        # `nix build` / `nix run` — the installable desktop app. Linux-only:
        # macOS builds go through the normal `cargo tauri build` .app/.dmg path.
        packages = lib.optionalAttrs isLinux rec {
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
            ];

            buildInputs = linuxLibs ++ [ pkgs.glib-networking ];

            env = {
              NEXT_TELEMETRY_DISABLED = "1";
              # next.config.ts footer stamps: no .git in the sandbox, so feed it
              # the version and (when the tree is clean enough to know) the rev.
              APP_VERSION = appVersion;
            } // lib.optionalAttrs (self ? rev || self ? dirtyRev) {
              GITHUB_SHA = self.rev or self.dirtyRev;
            };

            # No Rust tests, and `cargo test` would recompile the app with the
            # embedded frontend a second time for nothing.
            doCheck = false;

            # Mirror linuxEnv (the dev shell's known-good WebKitGTK setup)
            # exactly. Notably XDG_DATA_DIRS is *replaced*, not prefixed, and
            # host GIO modules are dropped: the host session's newer-glib
            # modules (gvfs etc.) don't load against this app's older glib, and
            # a host-polluted environment is what the EGL_BAD_PARAMETER abort
            # traced back to. These come after wrapGAppsHook's own args, so the
            # --set/--unset win over its --prefix defaults.
            preFixup = ''
              gappsWrapperArgs+=(
                --set WEBKIT_DISABLE_COMPOSITING_MODE 1
                --set WEBKIT_DISABLE_DMABUF_RENDERER 1
                --set XDG_DATA_DIRS "$GSETTINGS_SCHEMAS_PATH"
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
            shellHook = lib.optionalString isLinux linuxEnv + ''
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
