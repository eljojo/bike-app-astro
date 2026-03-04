declare module '@mapbox/polyline' {
  /**
   * Decode an encoded polyline string into an array of [lat, lng] pairs.
   */
  function decode(encoded: string, precision?: number): [number, number][];

  /**
   * Encode an array of [lat, lng] pairs into an encoded polyline string.
   */
  function encode(coordinates: [number, number][], precision?: number): string;
}
