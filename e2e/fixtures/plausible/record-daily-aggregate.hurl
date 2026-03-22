# Record Plausible site-wide daily aggregate stats
# Last 90 days for ottawabybike.ca
# Run: hurl --variable plausible_api_key=$PLAUSIBLE_API_KEY --report-json /dev/null e2e/fixtures/plausible/record-daily-aggregate.hurl
POST https://plausible.io/api/v2/query
Authorization: Bearer {{plausible_api_key}}
Content-Type: application/json
{
  "site_id": "ottawabybike.ca",
  "metrics": ["pageviews", "visitors", "bounce_rate"],
  "date_range": "90d",
  "dimensions": ["time:day"]
}

HTTP 200
[Asserts]
jsonpath "$.results" count > 0
