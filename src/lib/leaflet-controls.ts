import L from 'leaflet';

/**
 * Add a GPS "Find my location" button to a Leaflet map.
 * Drops a marker at the user's position and pans the map there.
 * No-op if the browser does not support geolocation.
 */
export function addGpsControl(map: L.Map) {
  if (!('geolocation' in navigator)) return;

  const GpsControl = L.Control.extend({
    options: { position: 'topleft' as L.ControlPosition },
    onAdd() {
      const container = L.DomUtil.create('div', 'map-gps-icon');
      const button = L.DomUtil.create('button', 'custom-button', container);
      button.innerHTML = '<span class="custom-icon">\u{1F4CD}</span>';
      L.DomEvent.on(button, 'click', () => {
        navigator.geolocation.getCurrentPosition((pos) => {
          const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
          const icon = L.divIcon({ className: 'emoji-icon', html: '\u{1F4CD}', iconSize: [25, 25] });
          L.marker(latlng, { icon }).addTo(map);
          map.panTo(latlng);
          (window as any).BikeApp?.tE?.('Find my Location in Map');
        });
      });
      return container;
    },
  });
  new GpsControl().addTo(map);
}
