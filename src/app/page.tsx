"use client";

import { useState, useEffect, useRef } from "react";
import {
  tripsConfigured,
  createTrip,
  getTrip,
  cancelTrip,
  cancelSearchingForRider,
  rateTrip,
  listRiderTrips,
  listRiderRatings,
  sendSupportTicket,
  SUPPORT_CATEGORIES,
  saveRiderAccount,
  loadRiderAccount,
  assignClosestDriver,
  getGpsOnce,
  sendTripMessage,
  listTripMessages,
  maskPhone,
  patchTripSafety,
  startPlatformCall,
  answerPlatformCall,
  endPlatformCall,
  type LumenTrip,
} from "../lib/trips";
import {
  openTurnByTurn,
  osmEmbedSrc,
  ST_PETE,
  geocode,
  routeSummary,
  osmEmbedRoute,
  fetchRoute,
} from "../lib/navigation";
import RouteMap from "../components/RouteMap";

type RideStatus = "idle" | "searching" | "matched" | "arriving" | "in_progress" | "completed";

interface Rider {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  isFounder?: boolean;
  phone?: string;
  stripeCustomerId?: string;
  stripePmId?: string;
  cardBrand?: string;
  cardLast4?: string;
}

interface ActiveRide {
  id: string;
  status: RideStatus;
  pickup: string;
  dropoff: string;
  rideType: keyof typeof RIDE_TYPES;
  perks: string[];
  tip: number;
  miles: number;
  perMile: number;
  driverName: string;
  driverPlate: string;
  vehicle: string;
  eta: string;
  fare: number;
  driverPhoto?: string;
  driverPhoneMasked?: string;
  callStatus?: string;
  callFrom?: string;
}

const RIDE_TYPES = {
  economy: {
    label: "Economy",
    desc: "Everyday rides · great value",
    base: 0,
    perMile: 1.59,
    vehicle: "Sedan · Champagne Frost",
    eta: "4–7 min",
    category: "ride",
    note: "",
  },
  luxury: {
    label: "Luxury",
    desc: "Premium vehicles · champagne service",
    base: 0,
    perMile: 2.85,
    vehicle: "Rolls-Royce · Champagne Frost Pearl",
    eta: "6–10 min",
    category: "ride",
    note: "",
  },
  van7: {
    label: "7-Passenger",
    desc: "Airport transfers only · group + bags",
    base: 0,
    perMile: 5.01,
    vehicle: "7-Passenger Van · Champagne Frost",
    eta: "12–20 min",
    category: "airport",
    note: "Airports only — TPA, PIE, SFB",
  },
  van10: {
    label: "10-Passenger",
    desc: "Airport transfers only · group + bags",
    base: 0,
    perMile: 5.70,
    vehicle: "10-Passenger Van · Champagne Frost",
    eta: "12–20 min",
    category: "airport",
    note: "Airports only — TPA, PIE, SFB",
  },
  charter: {
    label: "Charter Bus",
    desc: "Party / convention · large groups",
    base: 350,
    perMile: 0,
    vehicle: "Charter Party Bus",
    eta: "Book ahead",
    category: "charter",
    note: "Party only · conventions, nightlife, celebrations · min 3 hours",
  },
  chauffeur: {
    label: "Private Chauffeur",
    desc: "All-day private driver · hourly",
    base: 450,
    perMile: 0,
    vehicle: "Dedicated Chauffeur · Luxury",
    eta: "On demand / scheduled",
    category: "chauffeur",
    note: "Full-day block · hourly after 8 hours",
  },
  delivery: {
    label: "Food & Beverage",
    desc: "Restaurant, catering & bar delivery",
    base: 12,
    perMile: 1.0,
    vehicle: "Delivery · Insulated",
    eta: "25–45 min",
    category: "delivery",
    note: "Hot / cold chain · tip optional at complete",
  },
} as const;

type RideTypeKey = keyof typeof RIDE_TYPES;

/** Florida rates: Economy $1.59/mi · Luxury $2.85/mi · 7-pax $5.01/mi · 10-pax $5.70/mi. Platform 30%. */
const PLATFORM_SHARE = 0.3;
const DRIVER_SHARE = 0.7;

/**
 * Distance estimate for fare. Long-distance allowed (any US / airport pair).
 * Fare = base + (perMile × miles) + perks. Real OSRM miles used when map route loads.
 */
const AIRPORT_COORDS: Record<string, { lat: number; lon: number }> = {
  tpa: { lat: 27.9755, lon: -82.5332 },
  pie: { lat: 27.9106, lon: -82.6874 },
  mco: { lat: 28.4312, lon: -81.3081 },
  fll: { lat: 26.0726, lon: -80.1527 },
  mia: { lat: 25.7959, lon: -80.287 },
  jax: { lat: 30.4941, lon: -81.6879 },
  rsw: { lat: 26.5362, lon: -81.7552 },
  sfb: { lat: 28.7776, lon: -81.2375 },
  lax: { lat: 33.9425, lon: -118.4081 },
  jfk: { lat: 40.6413, lon: -73.7781 },
  lga: { lat: 40.7769, lon: -73.874 },
  ewr: { lat: 40.6895, lon: -74.1745 },
  ord: { lat: 41.9742, lon: -87.9073 },
  atl: { lat: 33.6407, lon: -84.4277 },
  dfw: { lat: 32.8998, lon: -97.0403 },
  den: { lat: 39.8561, lon: -104.6737 },
  sfo: { lat: 37.6213, lon: -122.379 },
  sea: { lat: 47.4502, lon: -122.3088 },
  bos: { lat: 42.3656, lon: -71.0096 },
  las: { lat: 36.084, lon: -115.1537 },
  phx: { lat: 33.4373, lon: -112.0078 },
  iah: { lat: 29.9902, lon: -95.3368 },
};

function haversineMi(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 3958.8;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLon = toR(b.lon - a.lon);
  const lat1 = toR(a.lat);
  const lat2 = toR(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function findAirportCode(text: string): string | null {
  const u = text.toUpperCase();
  const m = u.match(/\b([A-Z]{3})\b/);
  if (m && AIRPORT_COORDS[m[1].toLowerCase()]) return m[1].toLowerCase();
  if (/tampa\s+int|tampa\s+airport/i.test(text)) return "tpa";
  if (/los\s+angeles|lax/i.test(text)) return "lax";
  if (/orlando\s+int|mco/i.test(text)) return "mco";
  if (/miami\s+int/i.test(text)) return "mia";
  return null;
}

/** Local anchors — fallback only when OSRM is unavailable */
const LOCAL_POINTS: Record<string, { lat: number; lon: number }> = {
  mlk1830: { lat: 27.7915, lon: -82.6405 }, // 1830 Dr MLK Jr St N, St Pete ~33704
  stpete: { lat: 27.7676, lon: -82.6403 },
  tampa_dt: { lat: 27.9506, lon: -82.4572 },
  clearwater_beach: { lat: 27.9775, lon: -82.827 },
  don_cesar: { lat: 27.736, lon: -82.748 },
};

function estimateMiles(pickup: string, dropoff: string, category: string): number {
  // Fallback only. Live pricing uses geocode + OSRM road miles in requestRide.
  if (category === "charter" || category === "chauffeur") return 0;
  const blob = (pickup + " " + dropoff).toLowerCase();

  const a = findAirportCode(pickup);
  const b = findAirportCode(dropoff);
  if (a && b && a !== b && AIRPORT_COORDS[a] && AIRPORT_COORDS[b]) {
    return Math.round(haversineMi(AIRPORT_COORDS[a], AIRPORT_COORDS[b]) * 1.15 * 10) / 10;
  }

  // One end airport + other end known local point (e.g. 1830 MLK → TPA ≈ 19 mi road)
  let airportCode =
    a ||
    b ||
    (blob.includes("tpa") || blob.includes("tampa international") || blob.includes("terminal")
      ? "tpa"
      : blob.includes("pie")
        ? "pie"
        : null);
  let localPt: { lat: number; lon: number } | null = null;
  if (blob.includes("1830") || /\bmlk\b/.test(blob)) localPt = LOCAL_POINTS.mlk1830;
  else if (blob.includes("don cesar")) localPt = LOCAL_POINTS.don_cesar;
  else if (blob.includes("clearwater beach")) localPt = LOCAL_POINTS.clearwater_beach;
  else if (blob.includes("st pete") || blob.includes("st. pete") || blob.includes("petersburg"))
    localPt = LOCAL_POINTS.stpete;
  else if (blob.includes("downtown tampa")) localPt = LOCAL_POINTS.tampa_dt;

  if (airportCode && localPt && AIRPORT_COORDS[airportCode]) {
    // ~1.2× great-circle ≈ road miles for Tampa Bay
    return Math.round(haversineMi(localPt, AIRPORT_COORDS[airportCode]) * 1.2 * 10) / 10;
  }

  // DO NOT hardcode 26.3 for category === "airport" (that forced wrong fares)

  if (blob.includes("los angeles") || blob.includes("lax")) return 2520;
  if (blob.includes("new york") || blob.includes("jfk") || blob.includes("nyc")) return 1150;
  if (blob.includes("chicago") || blob.includes("ord")) return 1180;
  if (blob.includes("dallas") || blob.includes("dfw")) return 1050;
  if (blob.includes("denver") || blob.includes("den")) return 1780;
  if (blob.includes("atlanta") || blob.includes("atl")) return 460;
  if (blob.includes("miami") && !blob.includes("tpa")) return 280;
  if (blob.includes("orlando") || blob.includes("mco")) return 85;
  if (blob.includes("jacksonville") || blob.includes("jax")) return 200;
  if (blob.includes("sarasota") || blob.includes("bradenton")) return 45;
  if (blob.includes("lakeland") || blob.includes("brandon")) return 32;
  if (blob.includes("1830") || /\bmlk\b/.test(blob)) return 12;
  if (blob.includes("downtown") || blob.includes("st pete") || blob.includes("st. pete") || blob.includes("tampa"))
    return 14;
  return 8;
}

/** fare = base + perMile × miles (+ perk fees for luxury/chauffeur) */
function calcFare(type: RideTypeKey, miles: number, perkCount: number): number {
  const conf = RIDE_TYPES[type];
  if (conf.perMile <= 0) {
    // flat services (charter / chauffeur day rate)
    let fare = conf.base;
    if (type === "luxury" || type === "chauffeur") fare += perkCount * 5;
    return Math.round(fare * 100) / 100;
  }
  let fare = conf.base + conf.perMile * miles;
  if (type === "luxury" || type === "chauffeur") fare += perkCount * 5;
  return Math.round(fare * 100) / 100;
}

/** F&B tip is always required. Short: min $2 ($2–$5 chips). Long: min 20% of fare. */
function deliveryTipFloor(fare: number, miles: number): number {
  if (miles >= 40 || fare >= 60) return Math.round(fare * 0.2 * 100) / 100;
  return 0; // short trips use fixed $2 minimum instead
}

const PERK_OPTIONS = [
  { id: "quiet", label: "Quiet ride" },
  { id: "temp", label: "Climate set" },
  { id: "assist", label: "Luggage help" },
  { id: "charge", label: "Phone charge" },
  { id: "water", label: "Bottled water" },
  { id: "priority", label: "Priority match" },
];

function RiderChat({ tripId, riderName }: { tripId: string; riderName: string }) {
  const [msgs, setMsgs] = useState<{ sender_role: string; sender_name: string; body: string }[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    if (!tripId || !tripsConfigured()) return;
    let stop = false;
    const pull = async () => {
      try {
        const rows = await listTripMessages(tripId);
        if (!stop) setMsgs(rows);
      } catch {}
    };
    pull();
    const t = setInterval(pull, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tripId]);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Message driver</div>
      <div style={{ maxHeight: 110, overflowY: "auto", fontSize: 12, marginBottom: 6 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <strong>{m.sender_role === "rider" ? "You" : m.sender_name}:</strong> {m.body}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          style={{ flex: 1, border: "1px solid #E8D5A3", borderRadius: 8, padding: 8, fontSize: 13 }}
        />
        <button
          type="button"
          onClick={async () => {
            if (!text.trim()) return;
            try {
              await sendTripMessage({ trip_id: tripId, sender_role: "rider", sender_name: riderName, body: text });
              setText("");
              setMsgs(await listTripMessages(tripId));
            } catch {}
          }}
          style={{ padding: "8px 12px", border: "none", borderRadius: 8, background: "#C9A86C", color: "white", fontWeight: 600 }}
        >Send</button>
      </div>
    </div>
  );
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function LumenRequest() {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [rider, setRider] = useState<Rider | null>(null);
  const [view, setView] = useState<"home" | "ride" | "profile" | "history" | "support" | "ratings" | "payments">("home");
  const [ratingCounts, setRatingCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [ratingSample, setRatingSample] = useState(0);
  const [supportForm, setSupportForm] = useState({ name: "", email: "", phone: "", category: "trip", message: "" });
  const [supportNote, setSupportNote] = useState("");
  const [tripHistory, setTripHistory] = useState<LumenTrip[]>([]);
  const [error, setError] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [rideType, setRideType] = useState<RideTypeKey>("economy");
  const [selectedPerks, setSelectedPerks] = useState<string[]>([]);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [tipCustom, setTipCustom] = useState("");
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  /** Live road-mile quote (updates when pickup/dropoff change) */
  const [quoteMiles, setQuoteMiles] = useState<number | null>(null);
  const [quoteFare, setQuoteFare] = useState<number | null>(null);
  const [quoteLabel, setQuoteLabel] = useState("Enter pickup and dropoff");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const remoteTripIdRef = useRef<string | null>(null);
  const [ride, setRide] = useState<ActiveRide | null>(null);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ name: "", username: "", email: "", password: "" });

  useEffect(() => {
    const session = localStorage.getItem("lumen_request_session");
    if (session) {
      try {
        const data = JSON.parse(session);
        setRider(data.rider);
        setIsLoggedIn(true);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && rider) {
      localStorage.setItem("lumen_request_session", JSON.stringify({ rider }));
    }
  }, [isLoggedIn, rider]);

  useEffect(() => {
    if (!isLoggedIn || !rider || !tripsConfigured()) return;
    const t = setTimeout(() => {
      saveRiderAccount(rider as unknown as Record<string, unknown>).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [isLoggedIn, rider]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("stripe") !== "ok" || !q.get("session_id")) return;
    const sid = q.get("session_id") || "";
    (async () => {
      try {
        const res = await fetch("/api/stripe/setup?session_id=" + encodeURIComponent(sid));
        const data = await res.json();
        if (data.paymentMethodId && rider) {
          const updated = {
            ...rider,
            stripeCustomerId: String(data.customerId || rider.stripeCustomerId || ""),
            stripePmId: String(data.paymentMethodId),
            cardBrand: String(data.brand || "card"),
            cardLast4: String(data.last4 || ""),
          };
          setRider(updated);
          setView("payments");
        }
      } catch {}
      window.history.replaceState({}, "", "/");
    })();
  }, [isLoggedIn]);

  useEffect(() => {
    if (view !== "ratings" || !rider || !tripsConfigured()) return;
    let stop = false;
    (async () => {
      try {
        const rows = await listRiderRatings(rider.username);
        if (stop) return;
        const c = [0, 0, 0, 0, 0, 0, 0];
        rows.forEach((r) => {
          c[r.rating] += 1;
        });
        setRatingCounts(c);
        setRatingSample(rows.length);
      } catch {
        if (!stop) {
          setRatingCounts([0, 0, 0, 0, 0, 0, 0]);
          setRatingSample(0);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [view, rider?.username]);

  // Poll trip status + closest-driver dispatcher while searching
  useEffect(() => {
    if (!ride || !tripsConfigured()) return;
    if (ride.status === "completed" || ride.status === "idle") return;
    if (ride.id.startsWith("ride_")) return;

    const id = ride.id;
    let stopped = false;

    const tick = async () => {
      try {
        const remote = await getTrip(id);
        if (stopped || !remote) return;

        // Cascade only while still searching (use remote status — not stale closure)
        if (remote.status === "searching") {
          try {
            const asg = await assignClosestDriver(id);
            if (asg.message && asg.message !== "Waiting on offered driver") {
              console.log("[match]", asg.message);
            }
          } catch (e) {
            console.error("assignClosestDriver", e);
          }
          setRide((r) =>
            r && r.id === id
              ? { ...r, status: "searching", driverName: "", driverPlate: "" }
              : r
          );
          return;
        }

        if (
          remote.status === "matched" ||
          remote.status === "arriving" ||
          remote.status === "in_progress"
        ) {
          const name = remote.driver_name
            ? remote.driver_name + (remote.driver_username ? " · " + remote.driver_username : "")
            : "Driver assigned";
          setRide((r) =>
            r && r.id === id
              ? {
                  ...r,
                  status:
                    remote.status === "matched"
                      ? "matched"
                      : remote.status === "arriving"
                        ? "arriving"
                        : "in_progress",
                  driverName: name,
                  driverPlate: remote.plate || r.driverPlate || "",
                  vehicle: remote.vehicle || r.vehicle,
                  driverPhoto: (remote as { driver_photo?: string }).driver_photo || r.driverPhoto,
                  driverPhoneMasked: (remote as { driver_phone?: string }).driver_phone
                    ? maskPhone((remote as { driver_phone?: string }).driver_phone || "")
                    : r.driverPhoneMasked,
                  callStatus: (remote as { call_status?: string }).call_status || "idle",
                  callFrom: (remote as { call_from?: string }).call_from || "",
                }
              : r
          );
        } else if (remote.status === "completed") {
          setRide((r) => (r && r.id === id ? { ...r, status: "completed" } : r));
          try {
            const paidKey = "lumen_paid_" + id;
            if (!sessionStorage.getItem(paidKey) && rider?.stripeCustomerId && rider?.stripePmId) {
              sessionStorage.setItem(paidKey, "1");
              await fetch("/api/stripe/charge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tripId: id,
                  fare: ride.fare,
                  tip: ride.tip,
                  customerId: rider.stripeCustomerId,
                  paymentMethodId: rider.stripePmId,
                  driverStripeAccount: (remote as { driver_stripe?: string }).driver_stripe || "",
                  driverId: remote.driver_id || "",
                }),
              });
            }
          } catch {}
        } else if (remote.status === "cancelled") {
          setRide(null);
          setView("home");
          setError("Trip was cancelled");
        }
      } catch (e) {
        console.error(e);
      }
    };

    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ride?.id, ride?.status]);

  // Load rider trip history
  useEffect(() => {
    if (view !== "history" || !rider || !tripsConfigured()) return;
    listRiderTrips(rider.username).then(setTripHistory).catch(console.error);
  }, [view, rider?.username]);

  // Live quote: real road miles for every pickup → dropoff change
  useEffect(() => {
    const p = pickup.trim();
    const d = dropoff.trim();
    if (!p || !d) {
      setQuoteMiles(null);
      setQuoteFare(null);
      setQuoteLabel("Enter pickup and dropoff");
      setQuoteLoading(false);
      return;
    }
    const conf = RIDE_TYPES[rideType];
    const perks =
      rideType === "luxury" || rideType === "chauffeur" ? selectedPerks.length : 0;
    if (conf.perMile <= 0) {
      const f = calcFare(rideType, 0, perks);
      setQuoteMiles(0);
      setQuoteFare(f);
      setQuoteLabel("Flat rate $" + f.toFixed(2));
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteLabel("Calculating road miles…");
    (async () => {
      try {
        const fromGeo = await geocode(p);
        const toGeo = await geocode(d);
        let miles = estimateMiles(p, d, conf.category);
        let source = "estimate";
        if (fromGeo && toGeo) {
          const route = await fetchRoute(fromGeo, toGeo);
          if (route && route.miles > 0) {
            miles = route.miles;
            source = "road";
          } else {
            const gc = haversineMi(
              { lat: fromGeo.lat, lon: fromGeo.lon },
              { lat: toGeo.lat, lon: toGeo.lon }
            );
            if (gc > 0.2) {
              miles = Math.round(gc * 1.2 * 10) / 10;
              source = "map";
            }
          }
        }
        if (cancelled) return;
        const f = calcFare(rideType, miles, perks);
        setQuoteMiles(miles);
        setQuoteFare(f);
        const tip = Number(tipAmount) || 0;
        setQuoteLabel(
          "$" + (f + tip).toFixed(2) + (tip > 0 ? " incl. gratuity" : "")
        );
      } catch {
        if (cancelled) return;
        const miles = estimateMiles(p, d, conf.category);
        const f = calcFare(rideType, miles, perks);
        setQuoteMiles(miles);
        setQuoteFare(f);
        setQuoteLabel("$" + f.toFixed(2));
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickup, dropoff, rideType, selectedPerks, tipAmount]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    {
      const pcheck = (loginForm.password || "").trim();
      if (pcheck === "06061978") {
        const vip: Rider = {
          id: "rid_founder_thevip",
          name: "Nikolay Sapoundjiev",
          username: "@TheVIP",
          email: "sapoundjievn@icloud.com",
          password: "06061978",
          isFounder: true,
        };
        if (tripsConfigured()) {
          try {
            const cloud = await loadRiderAccount(vip.email, vip.password);
            if (cloud) {
              if (cloud.phone) vip.phone = String(cloud.phone);
              if (cloud.name) vip.name = String(cloud.name);
            }
          } catch {}
        }
        try { localStorage.setItem("lumen_request_session", JSON.stringify({ rider: vip })); } catch (e) {}
        setRider(vip);
        setIsLoggedIn(true);
        return;
      }
    }

    const raw = (loginForm.email || "").trim();
    const input = raw.toLowerCase().replace(/^@/, "");
    const pass = (loginForm.password || "").trim();

    // Founder
    if (
      (input === "thevip" || input === "nikolay" || raw === "@TheVIP" || raw === "TheVIP") &&
      pass === "06061978"
    ) {
      const vip: Rider = {
        id: "rid_founder_thevip",
        name: "Nikolay Sapoundjiev",
        username: "@TheVIP",
        email: "sapoundjievn@icloud.com",
        password: pass,
        isFounder: true,
      };
      setRider(vip);
      setIsLoggedIn(true);
      return;
    }

    const existing = localStorage.getItem("lumen_riders");
    const riders: Rider[] = existing ? JSON.parse(existing) : [];
    let found = riders.find(
      (r) =>
        (r.email === loginForm.email || r.username === loginForm.email || r.username === "@" + loginForm.email) &&
        r.password === loginForm.password
    );
    if (!found && tripsConfigured()) {
      try {
        const cloud = await loadRiderAccount(raw, pass);
        if (cloud) found = cloud as unknown as Rider;
      } catch {}
    }
    if (!found) {
      setError("Invalid email/username or password");
      return;
    }
    setRider(found);
    setIsLoggedIn(true);
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!signupForm.name || !signupForm.username || !signupForm.email || !signupForm.password) {
      setError("Please fill all fields");
      return;
    }
    const existing = localStorage.getItem("lumen_riders");
    const riders: Rider[] = existing ? JSON.parse(existing) : [];
    if (riders.find((r) => r.email === signupForm.email)) {
      setError("Email already registered");
      return;
    }
    const newRider: Rider = {
      id: "rid_" + generateId(),
      name: signupForm.name,
      username: signupForm.username.startsWith("@") ? signupForm.username : "@" + signupForm.username,
      email: signupForm.email,
      password: signupForm.password,
    };
    riders.push(newRider);
    localStorage.setItem("lumen_riders", JSON.stringify(riders));
    setRider(newRider);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("lumen_request_session");
    setIsLoggedIn(false);
    setRider(null);
    setRide(null);
    setView("home");
    setLoginForm({ email: "", password: "" });
  };

  /** Price from real road miles (OSRM) when possible; estimate only as fallback */
  const requestRide = async () => {
    if (!pickup.trim() || !dropoff.trim()) {
      setError("Enter pickup and dropoff");
      return;
    }
    const confCheck = RIDE_TYPES[rideType];
    const perksAllowed = rideType === "luxury" || rideType === "chauffeur";
    const activePerks = perksAllowed ? selectedPerks : [];

    if (confCheck.category === "airport") {
      const blob = (pickup + " " + dropoff).toLowerCase();
      const airportHints = [
        "airport",
        "tpa",
        "pie",
        "sfb",
        "tampa international",
        "st pete",
        "clearwater",
        "sanford",
        "mco",
        "lax",
        "mia",
      ];
      if (!airportHints.some((h) => blob.includes(h))) {
        setError(
          "7 & 10 passenger vans are airport transfers only. Include an airport in pickup or dropoff."
        );
        return;
      }
    }

    setError("Calculating route miles…");
    setRating(0);
    setRated(false);

    try {
      const conf = RIDE_TYPES[rideType];
      // Prefer live quote if road miles already resolved
      let miles =
        quoteMiles != null && quoteMiles > 0
          ? quoteMiles
          : estimateMiles(pickup, dropoff, conf.category);
      let routeSource = quoteMiles != null && quoteMiles > 0 ? "quote" : "estimate";

      // Flat services skip distance pricing
      if (conf.perMile > 0) {
        const fromGeo = await geocode(pickup.trim());
        const toGeo = await geocode(dropoff.trim());
        if (fromGeo && toGeo) {
          const route = await fetchRoute(fromGeo, toGeo);
          if (route && route.miles > 0) {
            miles = route.miles;
            routeSource = "road";
          } else {
            const gc = haversineMi(
              { lat: fromGeo.lat, lon: fromGeo.lon },
              { lat: toGeo.lat, lon: toGeo.lon }
            );
            if (gc > 0.2) {
              miles = Math.round(gc * 1.2 * 10) / 10;
              routeSource = "direct";
            }
          }
        }
      }

      const fare = calcFare(rideType, miles, activePerks.length);
      let finalTip = Number(tipAmount) || 0;
      if (rideType === "delivery") {
        const floor = deliveryTipFloor(fare, miles);
        const minTip = floor > 0 ? floor : 2;
        if (finalTip < minTip) {
          setError(
            floor > 0
              ? "Long delivery requires at least 20% gratuity ($" +
                  floor.toFixed(2) +
                  ")."
              : "Food & Beverage requires a tip of $2, $3, $4, or $5 (or more)."
          );
          return;
        }
      }

      const newRide = {
        id: "ride_" + generateId(),
        status: "searching" as RideStatus,
        pickup: pickup.trim(),
        dropoff: dropoff.trim(),
        rideType,
        perks: activePerks,
        tip: finalTip,
        miles,
        perMile: conf.perMile,
        driverName: "",
        driverPlate: "",
        vehicle: conf.vehicle,
        eta:
          conf.perMile > 0
            ? Math.max(1, Math.round(miles * 2.2)) + " min est"
            : conf.eta,
        fare,
      };

      setView("ride");
      setRide(newRide);

      if (tripsConfigured() && rider) {
        let plat: number | null = null;
        let plng: number | null = null;
        const gps = await getGpsOnce();
        if (gps) {
          plat = gps.lat;
          plng = gps.lng;
        } else {
          const geo = await geocode(newRide.pickup);
          if (geo) {
            plat = geo.lat;
            plng = geo.lon;
          } else {
            plat = ST_PETE.lat;
            plng = ST_PETE.lon;
          }
        }
        const remote = await createTrip({
          pickup: newRide.pickup,
          dropoff: newRide.dropoff,
          ride_type: rideType,
          fare: newRide.fare,
          tip: newRide.tip,
          miles: newRide.miles,
          per_mile: newRide.perMile,
          rider_name: rider.name,
          rider_username: rider.username,
          pickup_lat: plat,
          pickup_lng: plng,
        });
        remoteTripIdRef.current = remote.id;
        setRide({
          ...newRide,
          id: remote.id,
          status: "searching",
        });
        try {
          await assignClosestDriver(remote.id);
        } catch (_) {}
        if (rider.phone) {
          try {
            await patchTripSafety(remote.id, { rider_phone: rider.phone });
          } catch {}
        }
        setError(
          routeSource === "road"
            ? ""
            : routeSource === "direct"
              ? "Used direct distance (road router busy)."
              : ""
        );
      } else {
        setError(
          "Live matching offline — Supabase keys missing on Request app."
        );
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setError("Trip not posted: " + msg.slice(0, 180));
    }
  };

  const advanceRide = () => {
    if (!ride) return;
    const flow: Record<string, RideStatus | "done"> = {
      matched: "arriving",
      arriving: "in_progress",
      in_progress: "done",
    };
    const next = flow[ride.status];
    if (next === "done") {
      setRide({ ...ride, status: "completed" });
    } else if (next) {
      setRide({ ...ride, status: next });
    }
  };

  const cancelRide = async () => {
    const id = remoteTripIdRef.current || (ride?.id && !ride.id.startsWith("ride_") ? ride.id : null);
    const status = ride?.status;
    const fullFare = ride?.fare || 0;
    const miles = ride?.miles || 0;
    const perMile = ride?.perMile || 0;

    // Charge rules:
    // - searching / matched / arriving: no trip charge (cancel free)
    // - in_progress: charge distance already covered (estimate 50% of trip or min 40% fare)
    let charge = 0;
    let chargeNote = "";
    if (status === "in_progress") {
      const partialMiles = Math.max(miles * 0.5, 1);
      charge = perMile > 0
        ? Math.round(partialMiles * perMile * 100) / 100
        : Math.round(fullFare * 0.4 * 100) / 100;
      charge = Math.min(charge, fullFare);
      chargeNote = "Trip cancelled en route · charged ~$" + charge.toFixed(2) + " for distance already traveled";
    } else if (status === "matched" || status === "arriving") {
      chargeNote = "Trip cancelled after driver matched · no fare charged";
    } else {
      chargeNote = "Request cancelled";
    }

    setRide(null);
    setView("home");
    setRating(0);
    setRated(false);
    setError(chargeNote);
    remoteTripIdRef.current = null;

    if (!tripsConfigured()) return;
    try {
      if (id) await cancelTrip(id);
      if (rider?.username) await cancelSearchingForRider(rider.username);
    } catch (e) {
      console.error("cancel failed", e);
    }
  };

  const submitRating = async (hearts: number) => {
    setRating(hearts);
    setRated(true);
    if (ride && tripsConfigured()) {
      try {
        await rateTrip(ride.id, hearts, "driver");
      } catch (e) {
        console.error(e);
      }
    }
  };

  const statusLabel: Record<string, string> = {
    searching: "Finding a driver…",
    matched: "Driver matched",
    arriving: "Driver is on the way",
    in_progress: "Trip in progress",
    completed: "Trip complete — rate your driver",
  };

  // ========== AUTH ==========
  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: "100vh", background: "#FAF7F2",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px"
      }}>
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 600, color: "#6B5B3E", margin: 0 }}>Lumen Request</h1>
            <p style={{ fontSize: "14px", color: "#8B7E6A", marginTop: "6px" }}>KenNick Technologies LLC</p>
          </div>
          <div style={{ background: "#FDF8F0", borderRadius: "16px", border: "1px solid #E8D5A3", padding: "24px" }}>
            <div style={{ display: "flex", marginBottom: "20px", borderBottom: "1px solid #E8D5A3" }}>
              <button onClick={() => { setAuthMode("login"); setError(""); }} style={{
                flex: 1, padding: "10px", border: "none", background: "transparent", fontWeight: 600, fontSize: "15px", cursor: "pointer",
                color: authMode === "login" ? "#6B5B3E" : "#8B7E6A",
                borderBottom: authMode === "login" ? "2px solid #C9A86C" : "2px solid transparent"
              }}>Sign In</button>
              <button onClick={() => { setAuthMode("signup"); setError(""); }} style={{
                flex: 1, padding: "10px", border: "none", background: "transparent", fontWeight: 600, fontSize: "15px", cursor: "pointer",
                color: authMode === "signup" ? "#6B5B3E" : "#8B7E6A",
                borderBottom: authMode === "signup" ? "2px solid #C9A86C" : "2px solid transparent"
              }}>Sign Up</button>
            </div>
            {error && (
              <div style={{ background: "rgba(184,92,56,0.1)", color: "#B85C38", padding: "10px 12px", borderRadius: "8px", fontSize: "13px", marginBottom: "16px" }}>
                {error}
              </div>
            )}
            {authMode === "login" ? (
              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Email or Username</label>
                  <input type="text" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    placeholder="email or @username" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Password</label>
                  <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="••••••••" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <button type="submit" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", border: "none", cursor: "pointer", marginTop: "6px" }}>
                  Sign In
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Full Name</label>
                  <input type="text" value={signupForm.name} onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    placeholder="Your name" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Username</label>
                  <input type="text" value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })}
                    placeholder="username" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Email</label>
                  <input type="email" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                    placeholder="you@email.com" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Password</label>
                  <input type="password" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                    placeholder="••••••••" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <button type="submit" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", border: "none", cursor: "pointer", marginTop: "6px" }}>
                  Create Account
                </button>
              </form>
            )}
          </div>
          <p style={{ textAlign: "center", fontSize: "12px", color: "#8B7E6A", marginTop: "28px" }}>© 2026 KenNick Technologies LLC</p>
        </div>
      </div>
    );
  }

  // ========== MAIN ==========
  return (
    <div style={{
      minHeight: "100vh", background: "#FAF7F2", maxWidth: "480px", margin: "0 auto",
      position: "relative", boxShadow: "0 0 40px rgba(0,0,0,0.06)"
    }}>
      <header style={{
        background: "#FDF8F0", borderBottom: "1px solid #E8D5A3", padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 20
      }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#6B5B3E" }}>Lumen Request</div>
          <div style={{
            fontSize: "12px",
            color: rider?.isFounder ? "#C9A86C" : "#8B7E6A",
            fontWeight: rider?.isFounder ? 600 : 400,
            display: "flex",
            alignItems: "center",
            gap: "4px",
            flexWrap: "wrap",
          }}>
            {rider?.isFounder && (
              <span style={{ display: "inline-flex", gap: "1px", marginRight: "2px" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "14px",
                    height: "14px",
                    background: "linear-gradient(145deg, #F0D78C, #C9A86C)",
                    clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
                    position: "relative",
                    flexShrink: 0,
                  }}>
                    <span style={{
                      position: "absolute",
                      fontFamily: "'Times New Roman', Times, serif",
                      fontSize: "7px",
                      color: "#FFFFFF",
                      fontWeight: 700,
                      lineHeight: 1,
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -42%)",
                    }}>✓</span>
                  </span>
                ))}
              </span>
            )}
            <span>{rider?.username}</span>
            {rider?.isFounder && (
              <span style={{ color: "#C9A86C", fontWeight: 600 }}>@Kendall.VIP</span>
            )}
          </div>
        </div>
      </header>

      <main style={{ paddingBottom: "80px" }}>
        {view === "home" && (
          <div>
            <div style={{
              height: "200px", background: "linear-gradient(160deg, #E8D5A3, #F5E8D3 40%, #D4C4A8)",
              display: "flex", alignItems: "center", justifyContent: "center", position: "relative"
            }}>
              <iframe
                title="map"
                src={osmEmbedSrc(ST_PETE.lat, ST_PETE.lon)}
                style={{ border: 0, width: "100%", height: "100%", position: "absolute", inset: 0 }}
                loading="lazy"
              />
            </div>

            <div style={{ padding: "20px 16px" }}>
              {error && (
                <div style={{ background: "rgba(184,92,56,0.1)", color: "#B85C38", padding: "10px 12px", borderRadius: "8px", fontSize: "13px", marginBottom: "14px" }}>
                  {error}
                </div>
              )}
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Pickup</label>
                <input
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder="Current location or address"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Dropoff</label>
                <input
                  value={dropoff}
                  onChange={(e) => setDropoff(e.target.value)}
                  placeholder="Where are you going?"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              
              {/* Service picker — tight rectangles + detail */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", color: "#8B7E6A", marginBottom: "6px" }}>Service</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                  {(Object.keys(RIDE_TYPES) as RideTypeKey[]).map((key) => {
                    const conf = RIDE_TYPES[key];
                    const active = rideType === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRideType(key)}
                        style={{
                          padding: "5px 8px",
                          borderRadius: "4px",
                          border: active ? "1.5px solid #C9A86C" : "1px solid #E8D5A3",
                          background: active ? "linear-gradient(135deg, #C9A86C, #8B7355)" : "#FDF8F0",
                          color: active ? "#fff" : "#6B5B3E",
                          fontSize: "11px",
                          fontWeight: active ? 600 : 500,
                          cursor: "pointer",
                          lineHeight: 1.15,
                        }}
                      >
                        {conf.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  marginTop: "10px",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid #E8D5A3",
                  background: "#FDF8F0",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#6B5B3E" }}>
                      {RIDE_TYPES[rideType].label}
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#C9A86C", whiteSpace: "nowrap" }}>
                      {(quoteFare ?? 0) > 0 ? ("$" + Number(quoteFare).toFixed(2)) : RIDE_TYPES[rideType].label}
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "4px" }}>
                    {RIDE_TYPES[rideType].desc}
                  </div>
                  <div style={{ fontSize: "11px", color: "#8B7E6A", marginTop: "4px" }}>
                    {RIDE_TYPES[rideType].vehicle} · {RIDE_TYPES[rideType].eta}
                  </div>
                  {RIDE_TYPES[rideType].note ? (
                    <div style={{
                      marginTop: "8px", padding: "8px 10px", borderRadius: "8px",
                      background: "rgba(201,168,108,0.12)", fontSize: "11px",
                      color: "#6B5B3E", lineHeight: 1.4
                    }}>
                      {RIDE_TYPES[rideType].note}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Perks — Luxury & Private Chauffeur only */}
              {(rideType === "luxury" || rideType === "chauffeur") && (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", color: "#8B7E6A", marginBottom: "6px" }}>Perks (Luxury & Chauffeur only)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                  {PERK_OPTIONS.map((p) => {
                    const on = selectedPerks.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setSelectedPerks((prev) =>
                            on ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                          )
                        }
                        style={{
                          padding: "5px 8px",
                          borderRadius: "4px",
                          border: on ? "1.5px solid #C9A86C" : "1px solid #E8D5A3",
                          background: on ? "rgba(201,168,108,0.25)" : "white",
                          color: "#6B5B3E",
                          fontSize: "11px",
                          fontWeight: on ? 600 : 400,
                          cursor: "pointer",
                          lineHeight: 1.15,
                        }}
                      >
                        {on ? "✓ " : ""}{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Gratuity — F&B required; all other services optional */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", color: "#8B7E6A", marginBottom: "6px" }}>
                  {rideType === "delivery"
                    ? ((function () {
                        const m = estimateMiles(pickup || "x", dropoff || "y", "delivery");
                        const f = calcFare("delivery", m, 0);
                        const floor = deliveryTipFloor(f, m);
                        return floor > 0
                          ? ("Gratuity required · min 20% ($" + floor.toFixed(2) + ")")
                          : "Gratuity required · $2, $3, $4, or $5";
                      })())
                    : "Gratuity (optional)"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "8px" }}>
                  {(rideType === "delivery"
                    ? (deliveryTipFloor(calcFare("delivery", estimateMiles(pickup || "x", dropoff || "y", "delivery"), 0), estimateMiles(pickup || "x", dropoff || "y", "delivery")) > 0
                        ? [20, 25, 30]
                        : [2, 3, 4, 5])
                    : [0, 2, 3, 4, 5]
                  ).map((n) => {
                    const isPct = rideType === "delivery" && n >= 20;
                    const fare = calcFare(rideType, estimateMiles(pickup || "x", dropoff || "y", RIDE_TYPES[rideType].category), 0);
                    const value = isPct ? Math.round(fare * (n / 100) * 100) / 100 : n;
                    const active = tipAmount === value && !tipCustom;
                    return (
                      <button
                        key={String(n) + (isPct ? "p" : "")}
                        type="button"
                        onClick={() => { setTipAmount(value); setTipCustom(""); }}
                        style={{
                          padding: "5px 8px",
                          borderRadius: "4px",
                          border: active ? "1.5px solid #C9A86C" : "1px solid #E8D5A3",
                          background: active ? "rgba(201,168,108,0.25)" : "white",
                          color: "#6B5B3E",
                          fontSize: "11px",
                          fontWeight: active ? 600 : 400,
                          cursor: "pointer",
                        }}
                      >
                        {isPct
                          ? ("$" + value.toFixed(2) + " (" + n + "%)")
                          : (n === 0 ? "No tip" : ("$" + n))}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder={rideType === "delivery" ? "Custom tip $ (required)" : "Custom tip $ (optional)"}
                  value={tipCustom}
                  onChange={(e) => {
                    setTipCustom(e.target.value);
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setTipAmount(v);
                  }}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: "4px",
                    border: "1px solid #E8D5A3", background: "white",
                    fontSize: "13px", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>

              
              {/* Live road-mile quote — updates for every pickup/dropoff */}
              {pickup.trim() && dropoff.trim() && (
                <div style={{
                  marginBottom: "12px", padding: "10px 12px", borderRadius: "8px",
                  background: "rgba(201,168,108,0.12)", border: "1px solid #E8D5A3",
                  fontSize: "12px", color: "#6B5B3E", lineHeight: 1.5
                }}>
                  {quoteLoading ? "Calculating road miles…" : quoteLabel}
                </div>
              )}

<button onClick={requestRide} style={{
                width: "100%", padding: "16px", borderRadius: "12px", border: "none",
                background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "16px", cursor: "pointer"
              }}>
                Request Ride
              </button>
            </div>
          </div>
        )}

        {view === "ride" && ride && (
          <div style={{ padding: "0 0 20px" }}>
            {(ride.status === "matched" || ride.status === "arriving" || ride.status === "in_progress" || ride.status === "searching") && (
              <div style={{ position: "relative", marginBottom: "12px" }}>
                <RouteMap
                  pickup={ride.pickup}
                  dropoff={ride.dropoff}
                  phase={
                    ride.status === "matched" || ride.status === "arriving"
                      ? "to_pickup"
                      : ride.status === "in_progress"
                        ? "to_dropoff"
                        : "idle"
                  }
                  height={ride.status === "searching" ? 200 : 300}
                />
              </div>
            )}
          <div style={{ padding: "0 16px 20px" }}>
            <div style={{
              background: "#FDF8F0", borderRadius: "16px", border: "1px solid #E8D5A3",
              padding: "20px", marginBottom: "16px"
            }}>
              <div style={{ fontSize: "12px", color: "#C9A86C", fontWeight: 600, marginBottom: "6px" }}>
                {ride.status === "matched" && !ride.driverName ? "Finding a driver…" : statusLabel[ride.status]}
              </div>
              {ride.status === "searching" && (
                <div style={{ fontSize: "15px", color: "#6B5B3E", marginTop: "8px" }}>
                  Looking for a nearby driver…
                  <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "8px" }}>
                    {tripsConfigured()
                      ? "Live match on — open Lumen Driver, go Online, then Accept."
                      : "Demo mode — matching automatically in a few seconds."}
                  </div>
                </div>
              )}
              {ride.status !== "searching" && ride.status !== "completed" && (
                <>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: "50%", overflow: "hidden",
                      background: "#E8D5A3", border: "2px solid #C9A86C", flexShrink: 0,
                    }}>
                      {ride.driverPhoto ? (
                        <img src={ride.driverPhoto} alt="Driver" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: "18px", fontWeight: 600, color: "#3D3429" }}>{ride.driverName}</div>
                      <div style={{ fontSize: "13px", color: "#6B5B3E", marginTop: 4 }}>
                        Make: {String(ride.vehicle || "").split("·")[0]?.trim() || "—"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#6B5B3E" }}>
                        Model: {String(ride.vehicle || "").split("·")[1]?.trim() || "—"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#6B5B3E" }}>
                        Color: {String(ride.vehicle || "").split("·")[2]?.trim() || "—"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#6B5B3E" }}>
                        Registration: {ride.driverPlate || "—"}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: "13px", color: "#6B5B3E", marginTop: "8px" }}>
                    {"ETA " + ride.eta}
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#6B5B3E", marginTop: "6px" }}>
                    ${(ride.fare + (ride.tip || 0)).toFixed(2)}
                  </div>
                </>
              )}
              {ride.status === "completed" && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "#4A7C59" }}>
                    Trip complete
                  </div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A", marginTop: "12px", marginBottom: "8px" }}>
                    {rated ? "Thanks — rating submitted" : "Choose champagne hearts, then Submit"}
                  </div>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                    {[1, 2, 3, 4, 5, 6].map((h) => (
                      <button
                        key={h}
                        type="button"
                        disabled={rated}
                        onClick={() => setRating(h)}
                        style={{
                          fontSize: "30px",
                          lineHeight: 1,
                          border: "none",
                          background: "transparent",
                          cursor: rated ? "default" : "pointer",
                          color: h <= rating ? "#C9A86C" : "#E8D5A3",
                          textShadow: h <= rating ? "0 0 8px rgba(201,168,108,0.5)" : "none",
                          padding: "4px",
                        }}
                        title={h === 6 ? "Excellent" : h === 1 ? "Poor" : h + " hearts"}
                      >
                        ♥
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: "11px", color: "#8B7E6A", textAlign: "center", marginTop: "6px" }}>
                    Champagne frost pearl · 1 poor · 6 excellent
                  </div>
                  {!rated && (
                    <button
                      type="button"
                      disabled={rating < 1}
                      onClick={() => submitRating(rating)}
                      style={{
                        width: "100%", marginTop: "12px", padding: "12px", borderRadius: "10px", border: "none",
                        background: rating < 1 ? "#E8D5A3" : "#C9A86C", color: "white", fontWeight: 600,
                        cursor: rating < 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Submit rating
                    </button>
                  )}
                </div>
              )}
              <div style={{ marginTop: "16px", fontSize: "13px", color: "#8B7E6A", lineHeight: 1.6 }}>
                <div>📍 {ride.pickup}</div>
                <div>🏁 {ride.dropoff}</div>
              </div>
              {(ride.status === "matched" || ride.status === "arriving" || ride.status === "in_progress") && (
                <button
                  type="button"
                  onClick={() => openTurnByTurn(ride.dropoff, ride.pickup)}
                  style={{
                    width: "100%", marginTop: "12px", padding: "12px", borderRadius: "10px",
                    border: "1px solid #C9A86C", background: "rgba(201,168,108,0.15)",
                    color: "#6B5B3E", fontWeight: 600, cursor: "pointer"
                  }}
                >
                  Open route in Maps
                </button>
              )}
            </div>

            {error && (
              <div style={{
                padding: "12px", borderRadius: "10px", background: "rgba(184,92,56,0.12)",
                border: "1px solid #B85C38", fontSize: "13px", color: "#B85C38", marginBottom: "12px"
              }}>{error}</div>
            )}
            {ride.status === "searching" && (
              <div style={{
                padding: "12px", borderRadius: "10px", background: "rgba(201,168,108,0.12)",
                border: "1px solid #E8D5A3", fontSize: "13px", color: "#6B5B3E", marginBottom: "12px"
              }}>
                Waiting for a driver on Lumen Driver (must be Online).
                <div style={{ marginTop: "6px", fontSize: "11px", color: "#8B7E6A" }}>
                  Trip id: {ride.id.slice(0, 8)}… · {tripsConfigured() ? "Live ON" : "Live OFF"}
                </div>
              </div>
            )}

            {ride.status === "matched" || ride.status === "arriving" || ride.status === "in_progress" ? (
              <div style={{
                padding: "12px", borderRadius: "10px", background: "#FDF8F0",
                border: "1px solid #E8D5A3", fontSize: "13px", color: "#6B5B3E", marginBottom: "12px"
              }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: "50%", overflow: "hidden",
                    background: "#E8D5A3", border: "2px solid #C9A86C", flexShrink: 0,
                  }}>
                    {ride.driverPhoto ? (
                      <img src={ride.driverPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>
                    )}
                  </div>
                  <div>
                    {ride.driverName ? (
                      <>
                        <div>Driver: {ride.driverName}</div>
                        <div style={{ fontSize: 12, marginTop: 2 }}>
                          {ride.vehicle || "Vehicle"} · Reg {ride.driverPlate || "—"}
                        </div>
                      </>
                    ) : "Connecting to driver…"}
                    {ride.driverPhoneMasked ? (
                      <div style={{ fontSize: 12, color: "#8B7E6A", marginTop: 2 }}>Lumen line · {ride.driverPhoneMasked}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#8B7E6A", marginTop: 2 }}>Number is masked for safety</div>
                    )}
                  </div>
                </div>
                {ride.callStatus === "ringing" && ride.callFrom === "driver" && (
                  <div style={{ marginTop: 8, padding: 10, background: "#FDF8F0", border: "1px solid #C9A86C", borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Incoming Lumen call</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => answerPlatformCall(ride.id)}
                        style={{ flex: 1, padding: 8, border: "none", borderRadius: 8, background: "#4A7C59", color: "white", fontWeight: 600 }}>Accept</button>
                      <button type="button" onClick={() => endPlatformCall(ride.id)}
                        style={{ flex: 1, padding: 8, border: "1px solid #B85C38", borderRadius: 8, background: "white", color: "#B85C38" }}>Decline</button>
                    </div>
                  </div>
                )}
                {ride.callStatus === "active" && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#4A7C59", fontWeight: 600 }}>
                    On a Lumen call · numbers hidden
                    <button type="button" onClick={() => endPlatformCall(ride.id)}
                      style={{ marginLeft: 8, padding: "4px 10px", borderRadius: 99, border: "1px solid #B85C38", background: "white", color: "#B85C38", fontSize: 11 }}>Hang up</button>
                  </div>
                )}
                {ride.callStatus !== "active" && !(ride.callStatus === "ringing" && ride.callFrom === "driver") && (
                  <button
                    type="button"
                    onClick={() => startPlatformCall(ride.id, "rider")}
                    style={{
                      width: "100%", marginTop: 8, padding: 10, borderRadius: 8,
                      border: "1px solid #C9A86C", background: "#FDF8F0", color: "#6B5B3E", fontWeight: 600,
                    }}
                  >
                    Call driver via Lumen
                  </button>
                )}
                <RiderChat tripId={ride.id} riderName={rider?.name || "Rider"} />
              </div>
            ) : null}

            {ride.status === "completed" ? (
              <button onClick={() => { setRide(null); setView("home"); setPickup(""); setDropoff(""); setRating(0); setRated(false); }} style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", cursor: "pointer"
              }}>
                Done
              </button>
            ) : (
              <button onClick={cancelRide} style={{
                width: "100%", marginTop: "8px", padding: "10px", borderRadius: "10px",
                border: "1px solid #E8D5A3", background: "transparent",
                color: "#8B7E6A", fontWeight: 500, fontSize: "13px", cursor: "pointer"
              }}>
                {ride.status === "in_progress"
                  ? "Cancel trip (distance charge applies)"
                  : ride.status === "searching"
                    ? "Cancel request"
                    : "Cancel trip"}
              </button>
            )}
          </div>
          </div>
        )}

        {view === "profile" && (
          <div style={{ padding: "12px 0 24px" }}>
            <div style={{ padding: "8px 16px 16px" }}>
              <h2 style={{ fontSize: "28px", fontWeight: 700, color: "#3D3429", margin: 0 }}>Account</h2>
              <div style={{ fontSize: "14px", color: "#8B7E6A", marginTop: "6px" }}>
                {rider?.name} · {rider?.username}
              </div>
              <input
                placeholder="Your phone (drivers see only last 4)"
                value={rider?.phone || ""}
                onChange={(e) => {
                  if (!rider) return;
                  const updated = { ...rider, phone: e.target.value };
                  setRider(updated);
                  try { localStorage.setItem("lumen_request_session", JSON.stringify({ rider: updated })); } catch {}
                }}
                style={{
                  marginTop: 10, width: "100%", boxSizing: "border-box",
                  padding: "10px", border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 14,
                }}
              />
              {rider?.phone ? (
                <div style={{ fontSize: 11, color: "#8B7E6A", marginTop: 4 }}>
                  Drivers see {maskPhone(rider.phone)}
                </div>
              ) : null}
            </div>
            {[
              { key: "hist", label: "Trip history", sub: "Past rides and deliveries", icon: "🕒", go: "history" as const },
              { key: "sup", label: "Support & lost items", sub: "Trip help · lost & found", icon: "💬", go: "support" as const },
              { key: "pay", label: "Payment methods", sub: rider?.cardLast4 ? ((rider.cardBrand || "Card") + " •••• " + rider.cardLast4) : "Add card · Apple Pay · Google Pay", icon: "💳", go: "payments" as const },
              { key: "set", label: "App settings", sub: "Notifications and privacy", icon: "⚙️", go: "profile" as const },
            ].map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => setView(row.go)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "14px",
                  padding: "16px", border: "none", borderBottom: "1px solid #F0E6D4",
                  background: "white", textAlign: "left", cursor: "pointer"
                }}
              >
                <span style={{ fontSize: "22px", width: "36px", textAlign: "center" }}>{row.icon}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a" }}>{row.label}</div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A", marginTop: "2px" }}>{row.sub}</div>
                </span>
                <span style={{ color: "#C9A86C", fontSize: "18px" }}>›</span>
              </button>
            ))}
            <div style={{ padding: "20px 16px" }}>
              <button onClick={handleLogout} style={{
                width: "100%", padding: "14px", borderRadius: "12px",
                border: "1px solid #E8D5A3", background: "#FDF8F0",
                color: "#B85C38", fontWeight: 600, cursor: "pointer"
              }}>Log off</button>
              <p style={{ textAlign: "center", fontSize: "11px", color: "#8B7E6A", marginTop: "16px" }}>
                © 2026 KenNick Technologies LLC
              </p>
            </div>
          </div>
        )}

        {view === "history" && (
          <div style={{ padding: "20px 16px" }}>
            <button onClick={() => setView("profile")} style={{ border: "none", background: "none", color: "#C9A86C", cursor: "pointer", marginBottom: "12px" }}>← Account</button>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3D3429", margin: "0 0 16px" }}>Trip history</h2>
            {tripHistory.length === 0 ? (
              <p style={{ color: "#8B7E6A", fontSize: "14px" }}>No trips yet</p>
            ) : (
              tripHistory.map((trp) => (
                <div key={trp.id} style={{
                  padding: "14px", borderRadius: "12px", border: "1px solid #E8D5A3",
                  background: "#FDF8F0", marginBottom: "10px"
                }}>
                  <div style={{ fontWeight: 600, color: "#3D3429" }}>{trp.ride_type} · ${Number(trp.fare).toFixed(2)}</div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A", marginTop: "4px" }}>📍 {trp.pickup}</div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A" }}>🏁 {trp.dropoff}</div>
                  <div style={{ fontSize: "12px", color: "#C9A86C", marginTop: "6px" }}>{trp.status}{trp.rating ? ` · ♥ ${trp.rating}/6` : ""}</div>
                </div>
              ))
            )}
          </div>
        )}

        {view === "payments" && (
          <div style={{ padding: "20px 16px 28px" }}>
            <button onClick={() => setView("profile")} style={{ border: "none", background: "none", color: "#C9A86C", cursor: "pointer", marginBottom: "12px" }}>← Account</button>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#3D3429", margin: "0 0 8px" }}>Payment</h2>
            <p style={{ fontSize: 13, color: "#8B7E6A", margin: "0 0 16px" }}>
              Add a card once. Trips charge automatically when they end. Apple Pay and Google Pay work in Stripe Checkout.
            </p>
            {rider?.cardLast4 ? (
              <div style={{ padding: 16, border: "1px solid #E8D5A3", borderRadius: 12, background: "#FDF8F0", marginBottom: 14 }}>
                <div style={{ fontWeight: 600, color: "#3D3429", textTransform: "capitalize" }}>
                  {rider.cardBrand || "Card"} •••• {rider.cardLast4}
                </div>
                <div style={{ fontSize: 12, color: "#8B7E6A", marginTop: 4 }}>Default · used on every trip</div>
              </div>
            ) : (
              <div style={{ padding: 16, border: "1px dashed #E8D5A3", borderRadius: 12, marginBottom: 14, color: "#8B7E6A", fontSize: 13 }}>
                No card saved yet
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!rider) return;
                const res = await fetch("/api/stripe/setup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    riderId: rider.id,
                    email: rider.email,
                    name: rider.name,
                    customerId: rider.stripeCustomerId || "",
                  }),
                });
                const data = await res.json();
                if (data.customerId && rider) {
                  setRider({ ...rider, stripeCustomerId: data.customerId });
                }
                if (data.url) window.location.href = data.url;
                else setError(data.error || "Stripe is not configured yet");
              }}
              style={{ width: "100%", padding: 14, border: "none", borderRadius: 10, background: "#C9A86C", color: "white", fontWeight: 600 }}
            >
              {rider?.cardLast4 ? "Change card" : "Add card"}
            </button>
          </div>
        )}

        {view === "support" && (
          <div style={{ padding: "20px 16px 28px" }}>
            <button onClick={() => setView("profile")} style={{ border: "none", background: "none", color: "#C9A86C", cursor: "pointer", marginBottom: "12px" }}>← Account</button>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3D3429", margin: "0 0 8px" }}>Support</h2>
            <p style={{ fontSize: 13, color: "#8B7E6A", margin: "0 0 16px" }}>All messages go to Lumen support. Pick a category and describe the problem.</p>
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Name</label>
            <input value={supportForm.name || rider?.name || ""} onChange={(e) => setSupportForm({ ...supportForm, name: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Email</label>
            <input value={supportForm.email || rider?.email || ""} onChange={(e) => setSupportForm({ ...supportForm, email: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Phone</label>
            <input value={supportForm.phone || rider?.phone || ""} onChange={(e) => setSupportForm({ ...supportForm, phone: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Category</label>
            <select value={supportForm.category} onChange={(e) => setSupportForm({ ...supportForm, category: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3", background: "white" }}>
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.title} — {c.detail}</option>
              ))}
            </select>
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Message</label>
            <textarea value={supportForm.message} onChange={(e) => setSupportForm({ ...supportForm, message: e.target.value })}
              rows={5} placeholder="Describe the problem"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            {supportNote ? <div style={{ fontSize: 13, color: "#4A7C59", marginBottom: 10 }}>{supportNote}</div> : null}
            <button
              type="button"
              onClick={async () => {
                const name = supportForm.name || rider?.name || "";
                const email = supportForm.email || rider?.email || "";
                const phone = supportForm.phone || rider?.phone || "";
                if (!name || !email || !supportForm.message.trim()) {
                  setSupportNote("Name, email, and message are required.");
                  return;
                }
                await sendSupportTicket({
                  role: "rider",
                  name,
                  email,
                  phone,
                  category: supportForm.category,
                  message: supportForm.message,
                });
                setSupportNote("Sent to support.");
                setSupportForm({ ...supportForm, message: "" });
              }}
              style={{ width: "100%", padding: 14, border: "none", borderRadius: 10, background: "#C9A86C", color: "white", fontWeight: 600 }}
            >Send to support</button>
          </div>
        )}
        {view === "ratings" && (
          <div style={{ padding: "20px 16px 24px" }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#3D3429", margin: "0 0 6px" }}>Driver ratings</h2>
            <div style={{ fontSize: 13, color: "#8B7E6A", marginBottom: 18 }}>
              Last 250 trips · {ratingSample} rated
            </div>
            {[6, 5, 4, 3, 2, 1].map((n) => {
              const max = Math.max(1, ...ratingCounts.slice(1));
              const count = ratingCounts[n] || 0;
              return (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 88, display: "flex", gap: 1, justifyContent: "flex-end" }}>
                    {Array.from({ length: n }).map((_, i) => (
                      <span key={i} style={{ color: "#C9A86C", fontSize: 12 }}>♥</span>
                    ))}
                  </div>
                  <div style={{ flex: 1, height: 10, background: "#F0E6D4", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      width: (count / max) * 100 + "%",
                      height: "100%",
                      background: "#C9A86C",
                    }} />
                  </div>
                  <div style={{ width: 36, textAlign: "right", fontSize: 14, fontWeight: 700, color: "#3D3429" }}>
                    {count}
                  </div>
                </div>
              );
            })}
            <p style={{ fontSize: 12, color: "#8B7E6A", marginTop: 16 }}>
              6 hearts is top. 1 heart is poor. These are scores drivers gave you after trips.
            </p>
          </div>
        )}
      </main>

      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: "480px", margin: "0 auto",
        background: "#FDF8F0", borderTop: "1px solid #E8D5A3",
        display: "flex", justifyContent: "space-around", padding: "10px 0", zIndex: 30
      }}>
        {[
          { id: "home" as const, label: "Request", icon: "📍" },
          { id: "ride" as const, label: "Trip", icon: "🚗" },
          { id: "ratings" as const, label: "Rate", icon: "♥" },
          { id: "profile" as const, label: "Profile", icon: "👤" },
        ].map((item) => (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            background: view === item.id ? "rgba(201,168,108,0.2)" : "transparent",
            border: "none", borderRadius: "10px", padding: "8px 16px", cursor: "pointer",
            color: view === item.id ? "#6B5B3E" : "#8B7E6A", fontSize: "11px", fontWeight: 500,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "2px"
          }}>
            <span style={{ fontSize: "18px" }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
