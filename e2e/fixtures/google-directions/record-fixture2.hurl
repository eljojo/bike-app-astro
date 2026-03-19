# Record Google Directions API response for Fixture 2
# Waypoints: Royal Oak → 45.3268/-75.8054 (via) → Eaton St → Whiprsnapr Brewing
# Mode: bicycling
GET https://maps.googleapis.com/maps/api/directions/json
    ?origin=45.3430556,-75.7625
    &destination=45.3301965,-75.819541
    &waypoints=via:45.3268492,-75.8054197|45.3264109,-75.8173974
    &mode=bicycling
    &key={{google_api_key}}

HTTP 200
[Asserts]
jsonpath "$.status" == "OK"
jsonpath "$.routes" count > 0
