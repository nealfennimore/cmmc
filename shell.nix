{ pkgs ? import <nixpkgs> { } }:
with pkgs;
mkShell {
  # System libraries WebKitGTK and the Tauri bundler link against.
  buildInputs = [
    python312Packages.virtualenv

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

  nativeBuildInputs = [
    pkg-config
    gobject-introspection
    wrapGAppsHook3
    rustc
    cargo
  ];

  shellHook = ''
    [[ ! -d .venv ]] && python -m venv .venv
    source .venv/bin/activate
    if [[ -f requirements.txt ]]; then
      pip install -r requirements.txt --require-virtualenv
    fi

    # WebKitGTK on NixOS: avoid GPU-compositing crashes and make TLS modules
    # resolvable so the Tauri webview can render and reach the network.
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
    export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"

    export NO_STRIP=true 
  '';

  packages = [
    nodejs
    cargo-tauri
    (python312.withPackages
      (
        pp: [
          pp.jupyter
        ]
      ))
  ];
}
