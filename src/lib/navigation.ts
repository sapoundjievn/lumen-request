/**
 * Lumen navigation — geocode, OSRM route geometry, native maps fallback
 */

export type Coords = { lat: number; lon: number };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Common airport codes → exact coordinates (no Florida bias) */
const AIRPORTS: Record<string, Coords & { name: string }> = {
  TPA: { lat: 27.9755, lon: -82.5332, name: "Tampa International Airport" },
  PIE: { lat: 27.9106, lon: -82.6874, name: "St. Pete–Clearwater International" },
  MCO: { lat: 28.4312, lon: -81.3081, name: "Orlando International Airport" },
  FLL: { lat: 26.0726, lon: -80.1527, name: "Fort Lauderdale–Hollywood International" },
  MIA: { lat: 25.7959, lon: -80.2870, name: "Miami International Airport" },
  JAX: { lat: 30.4941, lon: -81.6879, name: "Jacksonville International Airport" },
  RSW: { lat: 26.5362, lon: -81.7552, name: "Southwest Florida International" },
  PBI: { lat: 26.6832, lon: -80.0956, name: "Palm Beach International" },
  SFB: { lat: 28.7776, lon: -81.2375, name: "Orlando Sanford International" },
  LAX: { lat: 33.9425, lon: -118.4081, name: "Los Angeles International Airport" },
  JFK: { lat: 40.6413, lon: -73.7781, name: "John F. Kennedy International" },
  LGA: { lat: 40.7769, lon: -73.8740, name: "LaGuardia Airport" },
  EWR: { lat: 40.6895, lon: -74.1745, name: "Newark Liberty International" },
  ORD: { lat: 41.9742, lon: -87.9073, name: "Chicago O'Hare International" },
  ATL: { lat: 33.6407, lon: -84.4277, name: "Hartsfield–Jackson Atlanta International" },
  DFW: { lat: 32.8998, lon: -97.0403, name: "Dallas/Fort Worth International" },
  DEN: { lat: 39.8561, lon: -104.6737, name: "Denver International Airport" },
  SFO: { lat: 37.6213, lon: -122.3790, name: "San Francisco International" },
  SEA: { lat: 47.4502, lon: -122.3088, name: "Seattle–Tacoma International" },
  BOS: { lat: 42.3656, lon: -71.0096, name: "Boston Logan International" },
  LAS: { lat: 36.0840, lon: -115.1537, name: "Harry Reid International (Las Vegas)" },
  PHX: { lat: 33.4373, lon: -112.0078, name: "Phoenix Sky Harbor International" },
  IAH: { lat: 29.9902, lon: -95.3368, name: "Houston George Bush Intercontinental" },
  CLT: { lat: 35.2140, lon: -80.9431, name: "Charlotte Douglas International" },
};

function airportMatch(q: string): (Coords & { name: string }) | null {
  const raw = q.trim().toUpperCase();
  // pure code: TPA, LAX
  if (/^[A-Z]{3}$/.test(raw) && AIRPORTS[raw]) return AIRPORTS[raw];
  // "TPA airport", "fly to LAX", "LAX International"
  const m = raw.match(/\b([A-Z]{3})\b/);
  if (m && AIRPORTS[m[1]]) return AIRPORTS[m[1]];
  // name fragments
  if (/tampa\s+int/i.test(q) || /tampa\s+airport/i.test(q)) return AIRPORTS.TPA;
  if (/los\s+angeles\s+int/i.test(q) || /\blax\b/i.test(q)) return AIRPORTS.LAX;
  return null;
}

function knownPlace(q: string): Coords | null {
  if (/1830/i.test(q) && /mlk|martin\s+luther|king/i.test(q)) {
    return { lat: 27.7915, lon: -82.6405 };
  }
  if (/montecito/i.test(q)) return { lat: 34.4366, lon: -119.632 };
  if (/santa\s+barbara/i.test(q)) return { lat: 34.4208, lon: -119.6982 };
  if (/st\.?\s*petersburg/i.test(q) && !/russia|petersburg,\s*ru/i.test(q) && !/1830|mlk/i.test(q)) {
    return { lat: 27.7676, lon: -82.6403 };
  }
  return null;
}

function inUSA(c: Coords): boolean {
  return c.lat > 24.4 && c.lat < 49.5 && c.lon > -125 && c.lon < -66.8;
}

export async function geocode(address: string): Promise<Coords | null> {
  let q = address.trim();
  if (!q) return null;

  if (/\btpa\b|tampa\s+international|tpa\s+terminal/i.test(q)) {
    return { lat: AIRPORTS.TPA.lat, lon: AIRPORTS.TPA.lon };
  }
  if (/\bpie\b/i.test(q) && /airport|terminal|clearwater/i.test(q)) {
    return { lat: AIRPORTS.PIE.lat, lon: AIRPORTS.PIE.lon };
  }

  const ap = airportMatch(q);
  if (ap) return { lat: ap.lat, lon: ap.lon };

  const known = knownPlace(q);
  if (known) return known;

  if (/1830/i.test(q) && /mlk|martin\s+luther|king/i.test(q)) {
    q = "1830 Dr Martin Luther King Jr St N, St. Petersburg, FL 33704, USA";
  } else if (/california|\bca\b/i.test(q) && !/,\s*(CA|California)/i.test(q)) {
    q = q + ", California, USA";
  } else if (!/usa|united states|florida|\bfl\b|california|\bca\b/i.test(q)) {
    q = q + ", USA";
  }

  try {
    const url =
      `${NOMINATIM}?format=json&limit=3&addressdetails=1&countrycodes=us&q=` +
      encodeURIComponent(q);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "LumenDriver/1.0 (KenNick Technologies LLC)",
      },
    });
    if (!res.ok) return knownPlace(address);
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return knownPlace(address);
    for (const row of data) {
      const c = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
      if (inUSA(c)) return c;
    }
    return knownPlace(address);
  } catch {
    return knownPlace(address);
  }
}

export type RouteStep = { text: string; miles: number };
export type RouteResult = {
  miles: number;
  minutes: number;
  path: [number, number][];
  steps: RouteStep[];
};

const ROUTE_SERVERS = [
  "https://router.project-osrm.org/route/v1/driving",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving",
];

function stepText(step: any): string {
  const man = step?.maneuver || {};
  const type = String(man.type || "");
  const mod = String(man.modifier || "").replace(/_/g, " ");
  const name = String(step?.name || "").trim();
  const onto = name ? " onto " + name : "";
  if (type === "depart") return "Head " + (mod || "out") + onto;
  if (type === "arrive") return "Arrive at destination";
  if (type === "roundabout" || type === "rotary") return "Enter roundabout" + onto;
  if (type === "merge") return "Merge" + onto;
  if (type === "fork") return "Keep " + (mod || "straight") + onto;
  if (type === "end of road") return "At end of road, turn " + (mod || "left") + onto;
  if (type === "new name" || type === "continue") return "Continue" + (name ? " on " + name : "");
  if (type === "turn" || type === "ramp" || type === "off ramp" || type === "on ramp")
    return "Turn " + (mod || "ahead") + onto;
  if (mod) return (mod.charAt(0).toUpperCase() + mod.slice(1)) + onto;
  return name ? "Continue on " + name : "Continue";
}

export async function fetchRoute(from: Coords, to: Coords): Promise<RouteResult | null> {
  const qsList = [
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`,
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=simplified&geometries=geojson&steps=true`,
  ];
  for (const base of ROUTE_SERVERS) {
    for (const qs of qsList) {
    try {
      const res = await fetch(`${base}/${qs}`);
      if (!res.ok) continue;
      const data = await res.json();
      const route = data?.routes?.[0];
      if (!route?.geometry?.coordinates?.length) continue;
      const path: [number, number][] = route.geometry.coordinates.map(
        (c: number[]) => [c[1], c[0]] as [number, number]
      );
      const steps: RouteStep[] = [];
      for (const leg of route.legs || []) {
        for (const st of leg.steps || []) {
          const text = stepText(st);
          if (!text) continue;
          steps.push({
            text,
            miles: Math.round(((st.distance || 0) / 1609.344) * 10) / 10,
          });
        }
      }
      return {
        miles: Math.round((route.distance / 1609.344) * 10) / 10,
        minutes: Math.max(1, Math.round(route.duration / 60)),
        path,
        steps,
      };
    } catch {
      continue;
    }
    }
  }
  return null;
}

export async function routeSummary(from: Coords, to: Coords) {
  const r = await fetchRoute(from, to);
  if (!r) return null;
  return { miles: r.miles, minutes: r.minutes };
}

export function openTurnByTurn(destination: string, origin?: string) {
  const dest = encodeURIComponent(destination);
  const originQ = origin ? encodeURIComponent(origin) : "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(ua) && !/Chrome/.test(ua);
  if (isApple) {
    const url = origin
      ? `https://maps.apple.com/?saddr=${originQ}&daddr=${dest}&dirflg=d`
      : `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
    window.open(url, "_blank");
    return;
  }
  const gUrl = origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${originQ}&destination=${dest}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  window.open(gUrl, "_blank");
}

export const ST_PETE: Coords = { lat: 27.7917, lon: -82.6403 };

export function osmEmbedSrc(lat: number, lon: number, zoomDelta = 0.02): string {
  const minLon = lon - zoomDelta;
  const minLat = lat - zoomDelta * 0.7;
  const maxLon = lon + zoomDelta;
  const maxLat = lat + zoomDelta * 0.7;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat}%2C${lon}`;
}

export function osmEmbedRoute(a: Coords, b: Coords): string {
  const padLon = Math.max(0.5, Math.abs(a.lon - b.lon) * 0.15);
  const padLat = Math.max(0.4, Math.abs(a.lat - b.lat) * 0.15);
  const minLon = Math.min(a.lon, b.lon) - padLon;
  const minLat = Math.min(a.lat, b.lat) - padLat;
  const maxLon = Math.max(a.lon, b.lon) + padLon;
  const maxLat = Math.max(a.lat, b.lat) + padLat;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${b.lat}%2C${b.lon}`;
}
