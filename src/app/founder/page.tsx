"use client";

import { useEffect, useMemo, useState } from "react";
import {
  tripsConfigured,
  listPlatformEarnings,
  listAllDriverEarnings,
} from "../../lib/trips";

const FOUNDERS = new Set(["thevip", "@thevip", "kendall.vip", "@kendall.vip"]);

type PlatRow = {
  continent?: string;
  country?: string;
  state_region?: string;
  county?: string;
  city?: string;
  trip_count?: number;
  gross_fare?: number;
  platform_revenue?: number;
  tips_volume?: number;
};

type Agg = {
  key: string;
  trip_count: number;
  platform_revenue: number;
  gross_fare: number;
};

function aggregate(rows: PlatRow[], keyFn: (r: PlatRow) => string): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyFn(r) || "—";
    const cur = map.get(key) || {
      key,
      trip_count: 0,
      platform_revenue: 0,
      gross_fare: 0,
    };
    cur.trip_count += Number(r.trip_count) || 0;
    cur.platform_revenue += Number(r.platform_revenue) || 0;
    cur.gross_fare += Number(r.gross_fare) || 0;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.platform_revenue - a.platform_revenue
  );
}

const colBox: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#FDF8F0",
  border: "1px solid #E8D5A3",
  borderRadius: 14,
  padding: 12,
  maxHeight: 420,
  overflowY: "auto",
};

const colTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#6B5B3E",
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: "1px solid #E8D5A3",
  position: "sticky",
  top: 0,
  background: "#FDF8F0",
};

export default function FounderPortal() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [platform, setPlatform] = useState<PlatRow[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = localStorage.getItem("lumen_founder") || "";
    if (u && FOUNDERS.has(u.toLowerCase())) {
      setOk(true);
      setUser(u);
    }
  }, []);

  useEffect(() => {
    if (!ok || !tripsConfigured()) return;
    setLoading(true);
    Promise.all([listPlatformEarnings(), listAllDriverEarnings()])
      .then(([p, d]) => {
        setPlatform(p as PlatRow[]);
        setDrivers(d);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [ok]);

  const usaRows = useMemo(
    () =>
      platform.filter(
        (r) => !r.country || /united states|usa|us/i.test(String(r.country))
      ),
    [platform]
  );

  const byState = useMemo(
    () => aggregate(usaRows, (r) => String(r.state_region || "Unknown").trim()),
    [usaRows]
  );

  const rowsInState = useMemo(() => {
    if (!selectedState) return usaRows;
    return usaRows.filter(
      (r) => String(r.state_region || "Unknown").trim() === selectedState
    );
  }, [usaRows, selectedState]);

  const byCounty = useMemo(
    () =>
      aggregate(rowsInState, (r) => {
        const c = String(r.county || "").trim();
        return c || "All counties";
      }),
    [rowsInState]
  );

  const rowsInCounty = useMemo(() => {
    if (!selectedCounty || selectedCounty === "All counties") return rowsInState;
    return rowsInState.filter(
      (r) => String(r.county || "").trim() === selectedCounty
    );
  }, [rowsInState, selectedCounty]);

  const byCity = useMemo(
    () => aggregate(rowsInCounty, (r) => String(r.city || "Unknown").trim()),
    [rowsInCounty]
  );

  const totalPlatform = usaRows.reduce(
    (s, r) => s + (Number(r.platform_revenue) || 0),
    0
  );
  const totalTrips = usaRows.reduce(
    (s, r) => s + (Number(r.trip_count) || 0),
    0
  );

  function login(e: React.FormEvent) {
    e.preventDefault();
    const u = user.trim().toLowerCase().replace(/^@/, "");
    if (
      !(
        (u === "thevip" || u === "kendall.vip") &&
        (pass === "06061978" || pass.length >= 6)
      )
    ) {
      setErr("Founders only — @TheVIP or @Kendall.VIP");
      return;
    }
    localStorage.setItem("lumen_founder", u);
    setOk(true);
    setErr("");
  }

  function logout() {
    localStorage.removeItem("lumen_founder");
    setOk(false);
  }

  function renderList(
    items: Agg[],
    selected: string | null,
    onSelect: (k: string) => void,
    empty: string
  ) {
    if (items.length === 0) {
      return (
        <div style={{ fontSize: 12, color: "#8B7E6A", padding: "8px 0" }}>
          {empty}
        </div>
      );
    }
    return items.map((a) => {
      const active = selected === a.key;
      return (
        <button
          key={a.key}
          type="button"
          onClick={() => onSelect(a.key)}
          style={{
            width: "100%",
            textAlign: "left",
            border: active ? "1px solid #C9A86C" : "1px solid transparent",
            background: active ? "rgba(201,168,108,0.2)" : "white",
            borderRadius: 10,
            padding: "10px 10px",
            marginBottom: 6,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#3D3429",
              marginBottom: 2,
            }}
          >
            {a.key}
          </div>
          <div style={{ fontSize: 12, color: "#4A7C59", fontWeight: 600 }}>
            ${a.platform_revenue.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: "#8B7E6A" }}>
            {a.trip_count} trips · gross ${a.gross_fare.toFixed(2)}
          </div>
        </button>
      );
    });
  }

  if (!ok) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#FAF7F2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui,sans-serif",
        }}
      >
        <form
          onSubmit={login}
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#FDF8F0",
            border: "1px solid #E8D5A3",
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h1 style={{ margin: "0 0 6px", color: "#6B5B3E", fontSize: 22 }}>
            Lumen Founder Portal
          </h1>
          <p style={{ margin: "0 0 16px", color: "#8B7E6A", fontSize: 13 }}>
            @TheVIP · @Kendall.VIP · USA earnings
          </p>
          {err && (
            <div
              style={{
                background: "rgba(184,92,56,0.1)",
                color: "#B85C38",
                padding: 10,
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {err}
            </div>
          )}
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="thevip"
            style={{
              width: "100%",
              padding: 12,
              marginBottom: 10,
              borderRadius: 10,
              border: "1px solid #E8D5A3",
              boxSizing: "border-box",
            }}
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="password"
            style={{
              width: "100%",
              padding: 12,
              marginBottom: 14,
              borderRadius: 10,
              border: "1px solid #E8D5A3",
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: 14,
              border: "none",
              borderRadius: 10,
              background: "#C9A86C",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAF7F2",
        maxWidth: 960,
        margin: "0 auto",
        padding: "16px 14px 48px",
        fontFamily: "system-ui,sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#3D3429" }}>
            Founder portal · USA
          </div>
          <div style={{ fontSize: 13, color: "#8B7E6A" }}>
            State → County → City · Platform 30%
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          style={{
            border: "1px solid #E8D5A3",
            background: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            color: "#6B5B3E",
            flexShrink: 0,
          }}
        >
          Log off
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            background: "#FDF8F0",
            border: "1px solid #E8D5A3",
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "#8B7E6A" }}>USA platform total</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#6B5B3E" }}>
            ${totalPlatform.toFixed(2)}
          </div>
        </div>
        <div
          style={{
            background: "#FDF8F0",
            border: "1px solid #E8D5A3",
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "#8B7E6A" }}>USA completed trips</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#6B5B3E" }}>
            {totalTrips}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ color: "#8B7E6A", marginBottom: 10 }}>Loading…</div>
      )}
      {err && (
        <div style={{ color: "#B85C38", marginBottom: 10, fontSize: 13 }}>
          {err}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "stretch",
          marginBottom: 20,
        }}
      >
        <div style={colBox}>
          <div style={colTitle}>States (USA)</div>
          {renderList(
            byState,
            selectedState,
            (k) => {
              setSelectedState(k);
              setSelectedCounty(null);
            },
            "No state earnings yet."
          )}
        </div>

        <div style={colBox}>
          <div style={colTitle}>
            Counties{selectedState ? ` · ${selectedState}` : ""}
          </div>
          {!selectedState ? (
            <div style={{ fontSize: 12, color: "#8B7E6A" }}>
              Select a state on the left.
            </div>
          ) : (
            renderList(
              byCounty,
              selectedCounty,
              (k) => setSelectedCounty(k),
              "No county data yet."
            )
          )}
        </div>

        <div style={colBox}>
          <div style={colTitle}>
            Cities
            {selectedState ? ` · ${selectedState}` : ""}
            {selectedCounty && selectedCounty !== "All counties"
              ? ` · ${selectedCounty}`
              : ""}
          </div>
          {!selectedState ? (
            <div style={{ fontSize: 12, color: "#8B7E6A" }}>
              Select a state first.
            </div>
          ) : (
            renderList(byCity, null, () => {}, "No city earnings yet.")
          )}
        </div>
      </div>

      <h2 style={{ fontSize: 15, color: "#6B5B3E", margin: "0 0 10px" }}>
        Driver earnings (USA)
      </h2>
      {drivers.length === 0 && (
        <div style={{ fontSize: 13, color: "#8B7E6A" }}>No driver rows yet.</div>
      )}
      {drivers.map((r, i) => (
        <div
          key={i}
          style={{
            background: "#fff",
            border: "1px solid #E8D5A3",
            borderRadius: 12,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 600, color: "#3D3429" }}>
            @{String(r.driver_username || r.driver_id || "").replace(/^@/, "")}
          </div>
          <div style={{ fontSize: 12, color: "#8B7E6A", marginTop: 4 }}>
            {[r.state_region, r.county, r.city].filter(Boolean).join(" · ")}
          </div>
          <div
            style={{
              fontSize: 13,
              marginTop: 6,
              color: "#4A7C59",
              fontWeight: 600,
            }}
          >
            ${Number(r.driver_earnings).toFixed(2)} · {r.trip_count} trips · tips
            ${Number(r.tips_earned).toFixed(2)}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 11, color: "#8B7E6A", marginTop: 28 }}>
        © 2026 KenNick Technologies LLC · Economy $1.59 · Luxury $2.85 · Platform
        30%
      </p>
    </div>
  );
}
