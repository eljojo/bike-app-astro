# Record Plausible Video:Play custom event breakdown
# Last 90 days for ottawabybike.ca
# Run: make record-plausible
POST https://plausible.io/api/v2/query
Authorization: Bearer {{plausible_api_key}}
Content-Type: application/json
{
  "site_id": "ottawabybike.ca",
  "metrics": ["visitors", "events"],
  "date_range": "90d",
  "dimensions": ["event:props:page"],
  "filters": [["is", "event:goal", ["Video: Play"]]]
}

HTTP 200
