// AcreMap — High-precision GPS engine
// Goal: produce reproducible measurements regardless of device tier.
// Strategy:
//  1. enableHighAccuracy + 1Hz watch
//  2. Reject readings with accuracy worse than threshold
//  3. Apply 1D Kalman filter on lat/lng (independent, weighted by reported accuracy)
//  4. For "marked" points: collect N samples (weighted average by 1/accuracy²) — STATIC averaging
//  5. Track full raw trace for audit (immutable history)
//  6. Detect device GPS tier heuristically from observed best accuracy

import type { GpsPoint, MeasurementPoint } from "./types";

export interface GpsConfig {
  maxAcceptableAccuracy: number; // meters; readings worse are dropped from "valid" stream
  staticSamples: number;         // number of samples to average when manually marking a point
  staticTimeoutMs: number;       // max wait time for static averaging
  autoMarkEveryMeters: number;   // 100m per spec
  kalmanProcessNoise: number;    // m/s typical
}

export const DEFAULT_GPS_CONFIG: GpsConfig = {
  maxAcceptableAccuracy: 25,
  staticSamples: 20,
  staticTimeoutMs: 25_000,
  autoMarkEveryMeters: 100,
  kalmanProcessNoise: 1.0,
};

// ---- Kalman 1D for lat & lng (independent) ----
// State: position (deg). Variance: in m² (converted via local meter scale)
export class Kalman1D {
  private x: number | null = null;
  private variance = -1; // m²
  constructor(private processNoise: number) {}
  reset() { this.x = null; this.variance = -1; }
  update(measurement: number, accuracyM: number, dtSec: number, mPerDeg: number): number {
    const measVar = Math.max(accuracyM * accuracyM, 1);
    if (this.x === null || this.variance < 0) {
      this.x = measurement;
      this.variance = measVar / (mPerDeg * mPerDeg);
      return this.x;
    }
    // predict
    this.variance += (dtSec * this.processNoise) ** 2 / (mPerDeg * mPerDeg);
    // update
    const measVarDeg = measVar / (mPerDeg * mPerDeg);
    const k = this.variance / (this.variance + measVarDeg);
    this.x = this.x + k * (measurement - this.x);
    this.variance = (1 - k) * this.variance;
    return this.x;
  }
}

// haversine — meters between two coords
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Polygon area (m²) — spherical excess approximation, accurate for plots ≤ a few km
export function polygonAreaM2(coords: { lat: number; lng: number }[]): number {
  if (coords.length < 3) return 0;
  const R = 6378137;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0, n = coords.length; i < n; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % n];
    area += (toRad(p2.lng) - toRad(p1.lng)) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((area * R * R) / 2);
}

export function polygonPerimeterM(coords: { lat: number; lng: number }[]): number {
  if (coords.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < coords.length; i++) {
    p += haversine(coords[i], coords[(i + 1) % coords.length]);
  }
  return p;
}

// Weighted average by 1/accuracy² — for static point averaging
export function weightedAverage(samples: GpsPoint[]): { lat: number; lng: number; accuracy: number } {
  let sw = 0, swLat = 0, swLng = 0;
  for (const s of samples) {
    const w = 1 / Math.max(s.accuracy * s.accuracy, 0.25);
    sw += w; swLat += s.lat * w; swLng += s.lng * w;
  }
  // resulting accuracy ≈ 1/sqrt(sum of 1/var_i)
  const acc = 1 / Math.sqrt(sw);
  return { lat: swLat / sw, lng: swLng / sw, accuracy: acc };
}

export function classifyAccuracy(acc: number): "good" | "ok" | "bad" {
  if (acc <= 5) return "good";
  if (acc <= 10) return "ok";
  return "bad";
}

export function estimateDeviceTier(bestAccuracy: number): "L1" | "L1+L5" | "unknown" {
  if (bestAccuracy <= 0) return "unknown";
  if (bestAccuracy <= 3) return "L1+L5";
  if (bestAccuracy <= 8) return "L1";
  return "unknown";
}

// ---- High-precision watcher (browser only) ----
export interface WatchHandle { stop: () => void; }

export type Listener = (p: GpsPoint, filtered: GpsPoint) => void;

export function startWatch(listener: Listener, cfg: GpsConfig = DEFAULT_GPS_CONFIG): WatchHandle {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { stop: () => {} };
  }
  const kLat = new Kalman1D(cfg.kalmanProcessNoise);
  const kLng = new Kalman1D(cfg.kalmanProcessNoise);
  let last: GpsPoint | null = null;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const acc = pos.coords.accuracy ?? 999;
      const raw: GpsPoint = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: acc,
        ts: pos.timestamp,
        alt: pos.coords.altitude ?? null,
      };
      if (acc > cfg.maxAcceptableAccuracy) {
        // still notify with raw so UI can show poor accuracy, but filtered = raw (no Kalman corruption)
        listener(raw, raw);
        return;
      }
      const dt = last ? (raw.ts - last.ts) / 1000 : 1;
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos((raw.lat * Math.PI) / 180);
      const fLat = kLat.update(raw.lat, acc, dt, mPerDegLat);
      const fLng = kLng.update(raw.lng, acc, dt, mPerDegLng);
      const filtered: GpsPoint = { ...raw, lat: fLat, lng: fLng };
      last = raw;
      listener(raw, filtered);
    },
    (err) => console.warn("GPS error", err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }
  );
  return { stop: () => navigator.geolocation.clearWatch(id) };
}

// Static point capture — collect N good samples then average
export function captureStaticPoint(
  cfg: GpsConfig = DEFAULT_GPS_CONFIG,
  onProgress?: (n: number, target: number, currentAcc: number) => void
): Promise<MeasurementPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation indisponible"));
      return;
    }
    const samples: GpsPoint[] = [];
    const start = Date.now();
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 999;
        const s: GpsPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
          ts: pos.timestamp,
          alt: pos.coords.altitude ?? null,
        };
        if (acc <= cfg.maxAcceptableAccuracy) samples.push(s);
        onProgress?.(samples.length, cfg.staticSamples, acc);
        const elapsed = Date.now() - start;
        if (samples.length >= cfg.staticSamples || elapsed >= cfg.staticTimeoutMs) {
          navigator.geolocation.clearWatch(id);
          if (samples.length === 0) {
            reject(new Error("Aucun signal GPS suffisant. Déplacez-vous en zone dégagée."));
            return;
          }
          const avg = weightedAverage(samples);
          resolve({
            index: 0,
            samples: samples.length,
            auto: false,
            lat: avg.lat,
            lng: avg.lng,
            accuracy: avg.accuracy,
            ts: Date.now(),
          });
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(id);
        reject(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }
    );
  });
}
