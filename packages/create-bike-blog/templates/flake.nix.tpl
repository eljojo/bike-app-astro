{
  description = "{{DOMAIN}} — personal cycling blog";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils, ... }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            nodePackages.npm
            vips
          ];

          shellHook = ''
            echo "{{DOMAIN}} dev shell (node $(node -v))"

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
