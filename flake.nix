{
  description = "bike-a-zine astro site";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils, ... }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg:
            builtins.elem (pkgs.lib.getName pkg) [ "corefonts" ];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            nodePackages.npm
            vips  # needed by sharp for image processing
            noto-fonts-color-emoji
            corefonts  # Arial Black (site title)
          ];

          shellHook = ''
            echo "bike-a-zine dev shell (node $(node -v))"
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
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
