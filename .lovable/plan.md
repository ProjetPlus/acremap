
# Mise à jour V3 — AcreMap

Travail très volumineux. Je propose de l'exécuter en 4 lots livrables. Avant de coder, je veux confirmer le plan car certaines décisions techniques sont structurantes (notamment Supabase, l'auth « admin / @AcreMap » sans email, et le format CAD).

---

## LOT 1 — Refonte UI levée + GPS (points 1, 2 partiel)

- `src/routes/app.measure.tsx` : carte plein écran, panneaux flottants translucides (top‑bar compacte + dock bas).
- Stats (points / périmètre / surface / précision) regroupées dans une barre flottante repliable.
- Boutons principaux (Marquer / Pause / Annuler / Sauver / Soumettre) dans un dock bas compact, icônes + labels courts.
- Menu burger pour options secondaires (auto 100 m, unité, vue carte, profil GPS).
- GPS : moyennage renforcé (filtre Kalman 1D simple sur lat/lng/accuracy, rejet si accuracy > seuil dynamique p75).

## LOT 2 — Partage AC / Propriétaire + Voies + Morcellement strict (points 3 à 8, 10)

- Nouveau module `src/lib/partage.ts` :
  - Coupe le polygone en 2 parties (horizontal / vertical) selon % AC / Propriétaire via Turf (`lineSplit` + bissection sur l'axe).
  - Retourne `{ partAC, partProprio }` polygones.
- Nouveau module `src/lib/morcellement.ts` réécrit :
  - Lots **strictement** de N hectares (1 ha par défaut). Algo : bandes parallèles à la voie, largeur calée pour aire = lotAreaHa exactement (clip + ajustement itératif jusqu'à |aire − cible| < 0.5 %).
  - Aucun lot < cible ; surface restante exposée séparément (`reste: { polygon, areaM2 }`).
- Voies : `src/lib/voie.ts` génère bande centrale (3/4/5/6 m) horizontale ou verticale, indépendante de l'axe de partage. Soustraction de la voie avant morcellement.
- Nouvelle page `src/routes/app.parcelles.$id.morcellement.tsx` avec wizard :
  1. Partage oui/non → si oui : axe + % AC/Proprio.
  2. Choix de la part à morceler (AC / Proprio / les deux / aucune).
  3. Voie : orientation + largeur.
  4. Taille de lot (1 ha par défaut).
  5. Aperçu carte temps réel + validation.
- Logo AgriCapital : copier `user-uploads://Logo_AgriCapital_-V2.jpg` → `src/assets/agricapital-logo.jpg`, intégré dans header app + PDF.

## LOT 3 — Export pro mono‑page + formats CAD (points 9, 11, 2 final)

- `src/lib/pdf.ts` réécrit pour reproduire la **capture 2** :
  - Bandeau gauche : infos générales + tableau superficies + localisation + notes.
  - Centre : plan (image satellite tuilée capturée via Leaflet `leaflet-image` ou rendu vectoriel) + lots colorés + voie marron + bornes A1..An + grille UTM.
  - Bandeau droite : légende + tableau lots + tableau coordonnées UTM (WGS84 / UTM 30N via `proj4`).
  - **Toujours 1 page**, format choisi (A4 → A1) avec auto‑scale pour ne jamais couper.
- Export DXF (AutoCAD) : nouveau `src/lib/dxf.ts` (génération texte DXF R12 — polygones parcelle + lots + voies sur calques séparés `PARCELLE`, `LOTS`, `VOIE`, `BORNES`).
- Export GeoJSON + KML pour outils topo / GPS terrain.
- Export Shapefile (.zip) via `shp-write` (ajout dépendance).

## LOT 4 — Supabase + Auth admin + Réutilisation données (points 12, 13, 14, 15)

> Migration SQL séparée, je vous demanderai d'approuver avant exécution.

Tables : `profiles`, `user_roles` (enum `admin|agent|viewer`), `sps`, `domaines`, `parcelles`, `measurements`, `measurement_points`, `lots`, `voies`, `partages`. 
RLS : admin = tout ; agent = ses propres mesures + lecture hiérarchie ; viewer = lecture seule. Fonction `has_role()` SECURITY DEFINER.

Auth admin sans email : Supabase exige un email → je crée un compte « interne » `admin@acremap.local` mappé à l'identifiant `admin`. Le formulaire login accepte « admin » + « @AcreMap » et résout en interne vers cet email. Compte seedé via migration (admin user + role admin). C'est la seule façon propre avec Supabase Auth ; sinon il faudrait abandonner Supabase Auth et faire une auth maison (déconseillé sécurité).

Réutilisation intelligente : selects en cascade Département → SP → Domaine → Parcelle avec création inline d'une nouvelle entrée si absente, persistée immédiatement et réutilisable.

Sync : remplacement progressif de Dexie par Supabase via server functions (`*.functions.ts`), Dexie gardé en cache offline.

---

## Détails techniques

- Dépendances ajoutées : `proj4`, `shp-write`, `leaflet-image` (lot 3).
- `src/lib/morcellement.ts` v2 : algo bandes + bissection (pas de squareGrid).
- Server functions : `src/lib/parcelles.functions.ts`, `measurements.functions.ts`, `lots.functions.ts` — toutes protégées par `requireSupabaseAuth`.
- `attachSupabaseAuth` ajouté à `src/start.ts`.

---

## Questions avant de coder

1. **Auth admin sans email** : OK pour la solution « identifiant `admin` mappé en interne vers `admin@acremap.local` » côté Supabase ? (alternative = auth maison non recommandée)
2. **Ordre d'exécution** : je propose Lot 1 → 2 → 3 → 4 sur 4 tours successifs (sinon une seule réponse serait trop volumineuse et risquerait des régressions). OK ?
3. **Format CAD prioritaire** : DXF suffit, ou il faut aussi DWG (DWG = format propriétaire Autodesk, nécessite un service externe payant — pas faisable localement) ?
