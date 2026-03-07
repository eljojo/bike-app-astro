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
          '';
        };
      });
}
