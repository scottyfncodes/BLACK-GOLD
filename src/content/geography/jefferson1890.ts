/**
 * Jefferson County, Southeast Texas, as it stood in 1890: persistent real-world geography.
 *
 * Coordinates are WGS84 latitude/longitude, hand-traced at roughly 1 km accuracy from
 * modern maps and simplified. Only surface geography lives here. Geology is seeded per
 * campaign and is not part of this file.
 */
export type LatLon = readonly [lat: number, lon: number];

export interface LineFeature {
  id: string;
  kind: "river" | "bayou" | "railroad" | "road";
  name: string;
  points: readonly LatLon[];
  /** Where along the line (0–1) to place the label, or omit for no label. */
  labelAt?: number;
}

export interface AreaFeature {
  id: string;
  kind: "marsh";
  name: string;
  points: readonly LatLon[];
}

export interface PlaceFeature {
  id: string;
  kind: "town" | "settlement";
  name: string;
  at: LatLon;
  labelSide: "left" | "right";
}

export interface RegionGeography {
  id: string;
  name: string;
  /** South-west and north-east corners. */
  bounds: { south: number; west: number; north: number; east: number };
  areas: readonly AreaFeature[];
  lines: readonly LineFeature[];
  places: readonly PlaceFeature[];
}

export const JEFFERSON_1890: RegionGeography = {
  id: "tx-jefferson",
  name: "Jefferson County, Texas",
  // About 25 × 25 km, Beaumont in the north-west quarter, the coastal marsh to the south.
  bounds: { south: 29.925, west: -94.215, north: 30.15, east: -93.955 },
  areas: [
    {
      id: "coastal-marsh",
      kind: "marsh",
      name: "Coastal marsh",
      points: [
        [29.925, -94.215], [29.952, -94.215], [29.962, -94.17], [29.968, -94.11], [29.974, -94.06],
        [29.985, -94.02], [30.0, -93.985], [30.012, -93.955], [29.925, -93.955],
      ],
    },
    {
      id: "neches-bottoms",
      kind: "marsh",
      name: "Neches bottomland",
      points: [
        [30.07, -94.07], [30.058, -94.048], [30.042, -94.02], [30.022, -93.995], [30.03, -93.985],
        [30.05, -94.01], [30.066, -94.04], [30.078, -94.065],
      ],
    },
  ],
  lines: [
    {
      id: "neches",
      kind: "river",
      name: "Neches River",
      labelAt: 0.62,
      points: [
        [30.15, -94.122], [30.135, -94.112], [30.118, -94.104], [30.103, -94.097], [30.09, -94.089],
        [30.078, -94.079], [30.066, -94.062], [30.055, -94.045], [30.042, -94.028], [30.03, -94.012],
        [30.016, -93.99], [30.004, -93.972], [29.996, -93.955],
      ],
    },
    {
      id: "pine-island-bayou",
      kind: "bayou",
      name: "Pine Island Bayou",
      labelAt: 0.3,
      points: [[30.128, -94.215], [30.124, -94.19], [30.13, -94.165], [30.126, -94.14], [30.118, -94.104]],
    },
    {
      id: "hillebrandt-bayou",
      kind: "bayou",
      name: "Hillebrandt Bayou",
      labelAt: 0.35,
      points: [[30.045, -94.215], [30.03, -94.195], [30.008, -94.18], [29.985, -94.165], [29.962, -94.15]],
    },
    {
      id: "tnorr",
      kind: "railroad",
      name: "Texas & New Orleans Railroad",
      labelAt: 0.8,
      points: [[30.078, -94.215], [30.081, -94.16], [30.084, -94.12], [30.086, -94.1], [30.092, -94.075], [30.102, -94.03], [30.11, -93.955]],
    },
    {
      id: "bluff-road",
      kind: "road",
      name: "Road to Grigsby's Bluff",
      points: [[30.084, -94.1], [30.06, -94.088], [30.035, -94.07], [30.012, -94.035], [29.995, -93.99], [29.99, -93.965]],
    },
  ],
  places: [
    { id: "beaumont", kind: "town", name: "Beaumont", at: [30.086, -94.102], labelSide: "left" },
    { id: "grigsbys-bluff", kind: "settlement", name: "Grigsby's Bluff", at: [29.99, -93.965], labelSide: "left" },
  ],
};

/** Local equirectangular projection to kilometres from the north-west corner (y grows south). */
export function projectKm(region: RegionGeography, [lat, lon]: LatLon): { x: number; y: number } {
  const midLat = ((region.bounds.north + region.bounds.south) / 2) * (Math.PI / 180);
  const kmPerDegLat = 111.13;
  const kmPerDegLon = 111.32 * Math.cos(midLat);
  return { x: (lon - region.bounds.west) * kmPerDegLon, y: (region.bounds.north - lat) * kmPerDegLat };
}

export function regionSizeKm(region: RegionGeography): { width: number; height: number } {
  const ne = projectKm(region, [region.bounds.south, region.bounds.east]);
  return { width: ne.x, height: ne.y };
}
