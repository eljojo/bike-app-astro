{
  description = "bike-a-zine astro site";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
    playwright.url = "github:pietdevries94/playwright-web-flake/1.61.0";
  };

  outputs = { self, nixpkgs, utils, playwright, ... }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg:
            builtins.elem (pkgs.lib.getName pkg) [ "corefonts" "codeql" ];
        };
        pw = playwright.packages.${system};

        # Every e2e project runs chromium (e2e/playwright.config.ts, e2e/*/fixture.ts),
        # so drop firefox and webkit from the browser set. Not just weight: webkit's
        # auto-patchelf step is broken upstream (missing libenchant-2), and building
        # it is a prerequisite of entering the shell — one broken browser we never
        # launch took `nix develop` down entirely. Chromium keeps its headless shell,
        # which is what playwright actually spawns in headless mode.
        pwBrowsers = pw.playwright-driver.browsers.override {
          withFirefox = false;
          withWebkit = false;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            vips  # needed by sharp for image processing
            imagemagick  # needed for HEIC dhash in match-photo-coords
            noto-fonts-color-emoji
            corefonts  # Arial Black (site title)
            awscli2  # needed by scripts/setup-aws-video.js
            hurl     # needed for recording API response fixtures
            codeql   # static analysis (mirrors GitHub CodeQL checks)
          ];

          shellHook = ''
            export NODE_ENV=development
            echo "bike-a-zine dev shell (node $(node -v))"
            export PLAYWRIGHT_BROWSERS_PATH="${pwBrowsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export FONTCONFIG_FILE=${pkgs.makeFontsConf { fontDirectories = [ pkgs.noto-fonts-color-emoji pkgs.corefonts ]; }}

            # Patch npm-installed native binaries (workerd, esbuild) so they can run on NixOS.
            # These ship with a hardcoded /lib64/ld-linux-x86-64.so.2 interpreter which doesn't
            # work on NixOS. patchelf rewrites it to point at the nix glibc dynamic linker.
            _nix_ld=$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)
            for bin in node_modules/@cloudflare/workerd-linux-64/bin/workerd; do
              if [ -f "$bin" ] && [ "$(patchelf --print-interpreter "$bin" 2>/dev/null)" != "$_nix_ld" ]; then
                patchelf --set-interpreter "$_nix_ld" "$bin" 2>/dev/null || true
              fi
            done
          '';
        };
      });
}
