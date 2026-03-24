# Record Plausible page breakdown: pageviews, visitors, visit_duration, bounce_rate per page
# Last 90 days of data for ottawabybike.ca
# Run: make record-plausible
POST https://plausible.io/api/v2/query
Authorization: Bearer {{plausible_api_key}}
Content-Type: application/json
{
  "site_id": "ottawabybike.ca",
  "metrics": ["pageviews", "visitors", "visit_duration", "bounce_rate"],
  "date_range": "90d",
  "dimensions": ["event:page"],
  "pagination": {"limit": 500}
}

HTTP 200
[Asserts]
jsonpath "$.results" count > 0
