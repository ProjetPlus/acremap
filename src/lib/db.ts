import Dexie, { type Table } from "dexie";
import type { Domaine, Lot, Measurement, Parcelle, SP, User } from "./types";

class AcreDB extends Dexie {
  users!: Table<User, string>;
  sps!: Table<SP, string>;
  domaines!: Table<Domaine, string>;
  parcelles!: Table<Parcelle, string>;
  measurements!: Table<Measurement, string>;
  lots!: Table<Lot, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("acremap");
    this.version(1).stores({
      users: "id, username, role",
      sps: "id, code",
      domaines: "id, code, spId",
      parcelles: "id, code, domaineId",
      measurements: "id, status, parcelleId, createdBy, createdAt",
      lots: "id, parcelleId, code",
      meta: "key",
    });
  }
}

let _db: AcreDB | null = null;
export function db(): AcreDB {
  if (typeof window === "undefined") {
    // SSR guard — return a dummy proxy that throws if used during SSR
    throw new Error("DB only available in browser");
  }
  if (!_db) _db = new AcreDB();
  return _db;
}

export const isBrowser = () => typeof window !== "undefined";
