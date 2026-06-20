{
  description = "Offline CMMC / NIST 800-171 compliance app (Tauri + Next.js)";

  inputs = {
    # Pinned via flake.lock — this is what makes the toolchain reproducible.
    # 25.05 ships Rust >= 1.86, required because Tauri's dbus/zvariant deps now
    # need the edition2024 cargo feature (Rust >= 1.85). 24.11's 1.82 is too old.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;
        isLinux = pkgs.stdenv.isLinux;

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

        buildTools = with pkgs; [
          nodejs
          cargo-tauri
          rustc
          cargo
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
