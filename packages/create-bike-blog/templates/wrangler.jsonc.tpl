{
  "name": "{{FOLDER}}",
  "compatibility_date": "2025-03-25",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": "./dist",
    "not_found_handling": "404-page"
  },
  "observability": { "enabled": true },
  "vars": {
    "GIT_BRANCH": "main",
    "ENVIRONMENT": "production",
    "STORAGE_KEY_PREFIX": ""
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "{{FOLDER}}-db",
      "migrations_dir": "./node_modules/bike-app-astro/drizzle/migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "{{FOLDER}}-media"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "TILE_CACHE"
    }
  ]
}
