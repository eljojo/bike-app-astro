export interface City {
  id: string;
  name: string;
  url: string;
}

export const cities: City[] = [
  { id: 'ottawa', name: 'Ottawa', url: 'https://ottawabybike.ca' },
  { id: 'demo', name: 'Demo', url: 'https://demo.whereto.bike' },
];

export const defaultCity = cities[0];
