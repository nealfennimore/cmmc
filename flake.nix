{
  description = "Offline CMMC / NIST 800-171 compliance app (Tauri + Next.js)";

  inputs = {
    # Pinned via flake.lock — this is what makes the toolchain reproducible.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
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
          wrapGAppsHook3
        ];

        # rustToolchain provides cargo + rustc; cargo-tauri orchestrates them.
        buildTools = [
          pkgs.nodejs
          pkgs.cargo-tauri
          rustToolchain
        ];

        # WebKitGTK on NixOS: avoid GPU-compositing crashes and make TLS modules
        # resolvable so the Tauri webview can render and reach the network.
        linuxEnv = ''
          export WEBKIT_DISABLE_COMPOSITING_MODE=1
          export WEBKIT_DISABLE_DMABUF_RENDERER=1
          export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
          export NO_STRIP=true
        '';
      in
      {
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
