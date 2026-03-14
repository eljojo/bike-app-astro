{
  description = "{{DOMAIN}} — personal cycling blog";

  inputs.bike-app.url = "github:eljojo/bike-app-astro";

  outputs = { bike-app, ... }:
    bike-app.outputs;
}
