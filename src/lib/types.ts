// AcreMap — Domain types
export type Role = "admin" | "agent" | "viewer";

export interface User {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  mustChangePassword?: boolean;
  createdAt: number;
}

export interface SP { id: string; code: string; name: string; departement: string; region: string; notes?: string; createdAt: number; }
export interface Domaine { id: string; code: string; name: string; spId: string; description?: string; notes?: string; createdAt: number; }
export interface Parcelle {
  id: string;
  code: string;
  ownerName: string;
  domaineId: string;
  conventionDate: number;
  declaredArea?: number;
  ownerPhone?: string;
  notes?: string;
  conventionStatus?: "PP" | "AC" | "EN_COURS";
  createdAt: number;
}

export interface GpsPoint { lat: number; lng: number; accuracy: number; ts: number; alt?: number | null; }
export interface MeasurementPoint extends GpsPoint { index: number; samples: number; auto: boolean; }

export type MeasurementStatus = "draft" | "submitted" | "validated" | "archived";

export interface Measurement {
  id: string;
  parcelleId?: string;
  createdBy: string;
  createdAt: number;
  status: MeasurementStatus;
  validatedBy?: string;
  validatedAt?: number;
  points: MeasurementPoint[];     // marked perimeter points
  trace: GpsPoint[];               // full walked path (every reading)
  areaM2: number;
  perimeterM: number;
  unit: "ha" | "m2" | "km2";
  deviceProfile?: DeviceProfile;
  notes?: string;
}

export interface Lot {
  id: string;
  parcelleId: string;
  measurementId: string;
  code: string;            // H01..
  polygon: { lat: number; lng: number }[];
  areaM2: number;
  assigneeName?: string;
  assignedAt?: number;
}

export interface DeviceProfile {
  userAgent: string;
  platform: string;
  estimatedTier: "L1" | "L1+L5" | "unknown";
  bestAccuracyM: number;
  medianAccuracyM: number;
  samplesCount: number;
}
