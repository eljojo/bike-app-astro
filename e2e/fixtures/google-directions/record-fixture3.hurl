# Record Google Directions API response for Fixture 3
# Waypoints: Royal Oak → shaping points → via → Eaton St → Whiprsnapr Brewing
# Mode: bicycling (with dragged shaping points)
GET https://maps.googleapis.com/maps/api/directions/json
    ?origin=45.3430556,-75.7625
    &destination=45.3301965,-75.819541
    &waypoints=via:45.3304549,-75.776827|via:45.3270734,-75.793438|via:45.315746,-75.794774|via:45.3268492,-75.8054197|45.3264109,-75.8173974
    &mode=bicycling
    &key={{google_api_key}}

HTTP 200
[Asserts]
jsonpath "$.status" == "OK"
jsonpath "$.routes" count > 0
