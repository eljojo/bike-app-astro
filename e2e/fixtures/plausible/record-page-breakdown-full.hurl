# Record Plausible page breakdown: full history (all time)
# This captures old numbered-slug URLs that are no longer in the 90-day window
# Run: make record-plausible
POST https://plausible.io/api/v2/query
Authorization: Bearer {{plausible_api_key}}
Content-Type: application/json
{
  "site_id": "ottawabybike.ca",
  "metrics": ["pageviews", "visitors", "visit_duration", "bounce_rate"],
  "date_range": "all",
  "dimensions": ["event:page"],
  "pagination": {"limit": 1000}
}

HTTP 200
[Asserts]
jsonpath "$.results" count > 0
