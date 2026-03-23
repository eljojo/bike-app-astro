# Record Plausible per-page daily breakdown (page + day dimensions)
# Last 90 days for ottawabybike.ca
# Run: make record-plausible
POST https://plausible.io/api/v2/query
Authorization: Bearer {{plausible_api_key}}
Content-Type: application/json
{
  "site_id": "ottawabybike.ca",
  "metrics": ["pageviews", "visitors", "visit_duration", "bounce_rate"],
  "date_range": "90d",
  "dimensions": ["time:day", "event:page"],
  "pagination": {"limit": 10000}
}

HTTP 200
[Asserts]
jsonpath "$.results" count > 0
