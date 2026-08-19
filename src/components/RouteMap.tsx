"use client";

import { useEffect, useRef } from "react";
import { geocode, fetchRoute, ST_PETE, type Coords } from "../lib/navigation";

type Props = {
  pickup: string;
  dropoff: string;
  phase: "idle" | "to_pickup" | "to_dropoff";
  height?: number;
  onStats?: (s: { miles: number; minutes: number } | null) => void;
};

declare global {
  interface Window {
    L?: any;
  }
}

function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.L) return resolve(window.L);
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.querySelector("script[data-leaflet]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L));
      if (window.L) resolve(window.L);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.dataset.leaflet = "1";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("leaflet load failed"));
    document.body.appendChild(script);
  });
}

const LIGHT_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export default function RouteMap({
  pickup,
  dropoff,
  phase,
  height = 280,
  onStats,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const tileRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = L.map(containerRef.current, {
            zoomControl: true,
            attributionControl: true,
          }).setView([ST_PETE.lat, ST_PETE.lon], 13);
        }
        const map = mapRef.current;

        if (tileRef.current) {
          map.removeLayer(tileRef.current);
          tileRef.current = null;
        }
        tileRef.current = L.tileLayer(LIGHT_TILE, {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        }).addTo(map);

        if (layerRef.current) {
          layerRef.current.clearLayers();
        } else {
          layerRef.current = L.layerGroup().addTo(map);
        }
        const layers = layerRef.current;

        const pickupC = (await geocode(pickup)) || ST_PETE;
        const dropC =
          (await geocode(dropoff)) ||
          ({ lat: ST_PETE.lat + 0.02, lon: ST_PETE.lon + 0.02 } as Coords);
        if (cancelled) return;

        const driverC = ST_PETE;
        const lineColor = "#2563EB";
        const lineGlow = "#1D4ED8";

        const mk = (color: string) =>
          L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });

        L.marker([pickupC.lat, pickupC.lon], { icon: mk("#4A7C59") })
          .addTo(layers)
          .bindPopup("Pickup");
        L.marker([dropC.lat, dropC.lon], { icon: mk("#B85C38") })
          .addTo(layers)
          .bindPopup("Dropoff");

        if (phase === "to_pickup" || phase === "to_dropoff") {
          const from = phase === "to_pickup" ? driverC : pickupC;
          const to = phase === "to_pickup" ? pickupC : dropC;
          const route = await fetchRoute(from, to);
          if (cancelled) return;

          if (route && route.path.length > 1) {
            L.polyline(route.path, {
              color: lineGlow,
              weight: 6,
              opacity: 0.25,
              lineJoin: "round",
            }).addTo(layers);
            const line = L.polyline(route.path, {
              color: lineColor,
              weight: 5,
              opacity: 0.95,
              lineJoin: "round",
            }).addTo(layers);
            map.fitBounds(line.getBounds(), { padding: [40, 40] });
            onStats?.({ miles: route.miles, minutes: route.minutes });
          } else {
            map.fitBounds(L.latLngBounds([from.lat, from.lon], [to.lat, to.lon]), {
              padding: [40, 40],
            });
            onStats?.(null);
          }
        } else {
          map.fitBounds(
            L.latLngBounds([pickupC.lat, pickupC.lon], [dropC.lat, dropC.lon]),
            { padding: [48, 48] }
          );
          onStats?.(null);
        }

        setTimeout(() => map.invalidateSize(), 150);
      } catch (e) {
        console.error("RouteMap", e);
        onStats?.(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pickup, dropoff, phase]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
        tileRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        background: "#d4e4f0",
        zIndex: 0,
      }}
    />
  );
}
