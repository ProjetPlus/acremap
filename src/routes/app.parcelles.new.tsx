import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db, isBrowser } from "@/lib/db";
import { nextSequentialCode } from "@/lib/ref";
import {
  listDistricts, regionsOfDistrict, departementsOfRegion, spsOfDepartement,
} from "@/lib/ci-admin";
import { fileToDataUrl } from "@/lib/photo";
import { feedbackSuccess } from "@/lib/feedback";

export const Route = createFileRoute("/app/parcelles/new")({
  component: NewParcelleWizard,
  head: () => ({ meta: [{ title: "Nouveau levé — choix de la parcelle" }] }),
});

type Step = 1 | 2 | 3 | 4;

function NewParcelleWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);

  // Étape 1 — géographie
  const [district, setDistrict] = useState(listDistricts()[0] ?? "");
  const [region, setRegion] = useState(regionsOfDistrict(district)[0] ?? "");
  const [departement, setDepartement] = useState(departementsOfRegion(region)[0] ?? "");
  const [spName, setSpName] = useState(spsOfDepartement(departement)[0] ?? "");

  // Étape 2 — domaine
  const [domaineMode, setDomaineMode] = useState<"existing" | "new">("new");
  const [domaineExistingId, setDomaineExistingId] = useState<string>("");
  const [domaineName, setDomaineName] = useState("");

  // Étape 3 — parcelle
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [conventionStatus, setConventionStatus] = useState<"PP" | "AC" | "EN_COURS">("PP");
  const [declaredArea, setDeclaredArea] = useState<string>("");
  const [notes, setNotes] = useState("");

  // Étape 4 — photos
  const [ownerPhoto, setOwnerPhoto] = useState<string>("");
  const [groupPhoto, setGroupPhoto] = useState<string>("");
  const [parcellePhoto, setParcellePhoto] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useLiveQuery(async () => {
    if (!isBrowser()) return null;
    const d = db();
    const [sps, domaines, parcelles] = await Promise.all([
      d.sps.toArray(), d.domaines.toArray(), d.parcelles.toArray(),
    ]);
    return { sps, domaines, parcelles };
  }, []);

  // SP existante candidate
  const matchingSp = useMemo(() => {
    if (!existing) return null;
    return existing.sps.find(
      (s) => s.name.toLowerCase() === spName.trim().toLowerCase()
        && s.departement === departement && s.region === region && s.district === district
    ) ?? null;
  }, [existing, spName, departement, region, district]);

  const domainesOfSp = useMemo(() => {
    if (!existing || !matchingSp) return [];
    return existing.domaines.filter((d) => d.spId === matchingSp.id);
  }, [existing, matchingSp]);

  async function submit() {
    if (!existing) return;
    setError(null);
    if (!spName.trim()) return setError("Renseignez le nom de la sous-préfecture.");
    if (domaineMode === "new" && !domaineName.trim()) return setError("Renseignez le nom du domaine.");
    if (domaineMode === "existing" && !domaineExistingId) return setError("Choisissez un domaine existant.");
    if (!ownerName.trim()) return setError("Renseignez le nom du propriétaire.");

    setSaving(true);
    try {
      const d = db();

      // SP — réutilise ou crée
      let spId = matchingSp?.id;
      if (!spId) {
        const code = nextSequentialCode("SP", existing.sps.map((x) => x.code));
        spId = crypto.randomUUID();
        await d.sps.put({
          id: spId, code, name: spName.trim(),
          district, region, departement, createdAt: Date.now(),
        });
      }

      // Domaine
      let domId: string;
      if (domaineMode === "existing") {
        domId = domaineExistingId;
      } else {
        const code = nextSequentialCode("DOM", existing.domaines.map((x) => x.code));
        domId = crypto.randomUUID();
        await d.domaines.put({
          id: domId, code, name: domaineName.trim(), spId, createdAt: Date.now(),
        });
      }

      // Parcelle
      const parcCode = nextSequentialCode("PARC", existing.parcelles.map((x) => x.code));
      const parcId = crypto.randomUUID();
      await d.parcelles.put({
        id: parcId,
        code: parcCode,
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim() || undefined,
        domaineId: domId,
        conventionDate: Date.now(),
        declaredArea: declaredArea ? Number(declaredArea) : undefined,
        notes: notes.trim() || undefined,
        conventionStatus,
        ownerPhoto: ownerPhoto || undefined,
        groupPhoto: groupPhoto || undefined,
        parcellePhoto: parcellePhoto || undefined,
        createdAt: Date.now(),
      });

      feedbackSuccess();
      navigate({ to: "/app/measure", search: { parcelleId: parcId } as any });
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const canNext1 = district && region && departement && spName.trim();
  const canNext2 = domaineMode === "new" ? !!domaineName.trim() : !!domaineExistingId;
  const canNext3 = !!ownerName.trim();

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-5">
      <div>
        <Link to="/app/parcelles" className="text-xs text-muted-foreground hover:underline">← Parcelles</Link>
        <h1 className="text-2xl font-bold mt-1">Nouveau levé</h1>
        <p className="text-sm text-muted-foreground">
          Avant de mesurer, identifiez la parcelle et son propriétaire.
        </p>
      </div>

      <Stepper step={step} />

      {error && <div className="text-xs bg-destructive/10 text-destructive px-3 py-2 rounded-md">{error}</div>}

      {step === 1 && (
        <Section title="1 · Localisation administrative" hint="Choisissez ou saisissez : District → Région → Département → Sous-Préfecture.">
          <ComboField label="District" value={district} options={listDistricts()}
            onChange={(v) => { setDistrict(v); const r = regionsOfDistrict(v); setRegion(r[0] ?? ""); const dp = departementsOfRegion(r[0] ?? ""); setDepartement(dp[0] ?? ""); setSpName(spsOfDepartement(dp[0] ?? "")[0] ?? ""); }} />
          <ComboField label="Région" value={region} options={regionsOfDistrict(district)}
            onChange={(v) => { setRegion(v); const dp = departementsOfRegion(v); setDepartement(dp[0] ?? ""); setSpName(spsOfDepartement(dp[0] ?? "")[0] ?? ""); }} />
          <ComboField label="Département" value={departement} options={departementsOfRegion(region)}
            onChange={(v) => { setDepartement(v); setSpName(spsOfDepartement(v)[0] ?? ""); }} />
          <ComboField label="Sous-Préfecture (nom)" value={spName} options={spsOfDepartement(departement)}
            onChange={setSpName} placeholder="Ex : Daloa-Centre" />
          {matchingSp ? (
            <div className="text-xs bg-success/10 text-success rounded-md px-3 py-2">
              Sous-préfecture existante : <b>{matchingSp.code} · {matchingSp.name}</b>
            </div>
          ) : (
            <div className="text-xs bg-warn/10 text-warn rounded-md px-3 py-2">
              Nouvelle sous-préfecture — un code sera créé automatiquement (SP{(existing?.sps.length ?? 0) + 1 < 10 ? "00" : (existing?.sps.length ?? 0) + 1 < 100 ? "0" : ""}{(existing?.sps.length ?? 0) + 1}).
            </div>
          )}
        </Section>
      )}

      {step === 2 && (
        <Section title="2 · Domaine" hint="Sélectionnez un domaine existant ou créez-en un nouveau.">
          {matchingSp && domainesOfSp.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Domaines de {matchingSp.code}</div>
              <div className="grid gap-1.5">
                {domainesOfSp.map((d) => (
                  <label key={d.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                    domaineMode === "existing" && domaineExistingId === d.id ? "border-primary bg-primary/5" : ""
                  }`}>
                    <input type="radio" checked={domaineMode === "existing" && domaineExistingId === d.id}
                      onChange={() => { setDomaineMode("existing"); setDomaineExistingId(d.id); }} />
                    <span className="text-sm"><b>{d.code}</b> · {d.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer ${domaineMode === "new" ? "border-primary bg-primary/5" : ""}`}>
            <input type="radio" checked={domaineMode === "new"} onChange={() => setDomaineMode("new")} className="mt-1" />
            <div className="flex-1">
              <div className="text-sm font-medium">Créer un nouveau domaine</div>
              <input value={domaineName} onChange={(e) => { setDomaineName(e.target.value); setDomaineMode("new"); }}
                placeholder="Nom du domaine (ex : Plantation Gonaté Nord)"
                className="mt-2 w-full h-10 px-3 rounded-md border bg-background" />
            </div>
          </label>
        </Section>
      )}

      {step === 3 && (
        <Section title="3 · Parcelle & propriétaire" hint="Informations sur la convention.">
          <Field label="Nom du propriétaire / famille">
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Ex : Famille Séri" className="w-full h-10 px-3 rounded-md border bg-background" />
          </Field>
          <Field label="Téléphone du propriétaire (optionnel)">
            <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="+225 …" className="w-full h-10 px-3 rounded-md border bg-background" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type de convention">
              <select value={conventionStatus} onChange={(e) => setConventionStatus(e.target.value as any)}
                className="w-full h-10 px-3 rounded-md border bg-background">
                <option value="PP">Planté-Partagé</option>
                <option value="AC">Achat / Cession</option>
                <option value="EN_COURS">En cours</option>
              </select>
            </Field>
            <Field label="Surface déclarée (ha)">
              <input value={declaredArea} onChange={(e) => setDeclaredArea(e.target.value)}
                type="number" step="0.1" min="0"
                placeholder="Ex : 5" className="w-full h-10 px-3 rounded-md border bg-background" />
            </Field>
          </div>
          <Field label="Notes (optionnel)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-md border bg-background" />
          </Field>
        </Section>
      )}

      {step === 4 && (
        <Section title="4 · Photos" hint="Photos enregistrées localement (pas d'URL externe).">
          <PhotoField label="Photo du propriétaire" value={ownerPhoto} onChange={setOwnerPhoto} />
          <PhotoField label="Photo de groupe / famille" value={groupPhoto} onChange={setGroupPhoto} />
          <PhotoField label="Photo de la parcelle" value={parcellePhoto} onChange={setParcellePhoto} />
        </Section>
      )}

      <div className="flex gap-2 pt-2">
        {step > 1 && (
          <button onClick={() => setStep((s) => (s - 1) as Step)}
            className="flex-1 h-11 rounded-lg border font-medium">← Précédent</button>
        )}
        {step < 4 && (
          <button onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2) || (step === 3 && !canNext3)}
            className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40">
            Suivant →
          </button>
        )}
        {step === 4 && (
          <button onClick={submit} disabled={saving}
            className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40">
            {saving ? "Enregistrement…" : "Enregistrer & lancer la mesure GPS"}
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Localisation", "Domaine", "Parcelle", "Photos"];
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const idx = i + 1;
        const active = step === idx;
        const done = step > idx;
        return (
          <div key={s} className="flex-1 flex items-center gap-1.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              done ? "bg-success text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>{idx}</div>
            <span className={`hidden sm:inline text-xs ${active ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
            {idx < steps.length && <div className={`flex-1 h-0.5 ${done ? "bg-success" : "bg-muted"}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-2xl shadow-card p-5 space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ComboField({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const id = `dl-${label.replace(/\W/g, "-")}`;
  return (
    <Field label={label}>
      <input value={value} onChange={(e) => onChange(e.target.value)} list={id} placeholder={placeholder}
        className="w-full h-10 px-3 rounded-md border bg-background" />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </Field>
  );
}

function PhotoField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try { onChange(await fileToDataUrl(file)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-lg bg-muted overflow-hidden border flex items-center justify-center text-xs text-muted-foreground">
          {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : "Aucune"}
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="cursor-pointer text-xs px-3 py-2 rounded-md border bg-background text-center hover:bg-muted">
            {busy ? "Compression…" : value ? "Remplacer le fichier" : "Choisir un fichier"}
            <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <label className="cursor-pointer text-xs px-3 py-2 rounded-md border bg-background text-center hover:bg-muted">
            📷 Prendre une photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {value && <button onClick={() => onChange("")} className="text-[10px] text-destructive underline self-start">Retirer</button>}
        </div>
      </div>
    </div>
  );
}
