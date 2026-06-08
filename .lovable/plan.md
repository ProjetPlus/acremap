# Plan — Lot 5 : Plans 2D conformes, aperçu, export par lot, levé instantané

## 1. Levé instantané (suppression du compteur 1/30)

Fichier : `src/routes/app.measure.tsx`
- Supprimer toute logique de comptage d'échantillons visible lors d'un appui sur **Marquer**.
- Au clic sur **Marquer un point** : capture immédiate d'UNE position GPS (la dernière reçue par `watchPosition`), ajout instantané au polygone, aucun overlay « 1/30 », aucune attente.
- Le filtre qualité (précision max, rejet anti-dérive immobile) reste actif en arrière-plan mais n'apparaît plus dans l'UI au moment du marquage.
- Toujours masquer le bouton « Terminer » uniquement après ≥ 3 points valides.

## 2. Références claires des lots après morcellement

Fichier : `src/lib/morcellement.ts`
- Pour chaque lot `H01..Hnn`, générer les bornes avec étiquettes séquentielles **par lot** au format `H01-P1, H01-P2, …` qui correspondent aux sommets du polygone dans l'ordre de tracé.
- Ajouter `edges: { from: "H01-P1", to: "H01-P2", lengthM: 23.31 }` pour chaque côté → permet d'imprimer les longueurs sur le plan et de « revenir » à n'importe quel segment.
- Numéroter aussi les bornes globales de la parcelle `A1..An` (déjà fait) ET garder un mapping `Hxx-Pk ↔ Ay` quand le sommet du lot coïncide avec une borne de parcelle.

## 3. Plan PDF « ENTREPRISE » (modèle Plan 1)

Refonte `src/lib/pdf.ts` → `exportPdfEntreprise(...)`
A3 paysage, 3 colonnes :
- **Colonne gauche** : logo AgriCapital + bloc vert « PLAN DE MORCELLEMENT PARCELLE AGRICOLE » + référence officielle, Informations générales, Tableau des superficies (brute / piste / nette / nb lots / moyenne), Localisation (mini-carte), Notes, Dressé par.
- **Centre** : plan 2D avec grille UTM (X en haut/bas, Y gauche/droite), rose des vents, polygone parcelle vert, voie centrale beige, lots H01..Hnn avec étiquette + « 1,00 ha », **longueurs des côtés des lots** affichées sur chaque segment (m), points A1..An, échelle graphique 1/2500.
- **Colonne droite** : Légende, Tableau des lots (N° / Référence officielle / Superficie 1,00 ha), Coordonnées UTM des points A1..An (X,Y en mètres), Remarques importantes.

## 4. Plan PDF « CLIENT » (modèle Plan client) — un par lot

Nouveau : `exportPdfClient({ measurement, parcelle, lots, focusLotCode })`
A3 paysage, épuré :
- **Colonne gauche** : logo, titre vert « PLAN DE LOTISSEMENT AGRICOLE – VERSION CLIENT », référence officielle du **lot ciblé** `AC-PP-…-PARC001-H07`, Aperçu de la parcelle (Superficie totale, Nb lots, Localisation, Date), Légende client (4 entrées), bloc Informations entreprise.
- **Centre** : même plan 2D que entreprise mais **sans cotes** ni grille UTM ni coordonnées ; le lot ciblé est mis en évidence (remplissage vert clair + bordure plus épaisse) ; les autres lots restent visibles en gris clair pour le contexte.
- **Pas de tableau de coordonnées, pas de longueurs**, juste l'échelle graphique 1/2500 en bas à droite.

Boucle d'export par lot : `for (const lot of lots) exportPdfClient({..., focusLotCode: lot.code})` → un PDF par souscripteur (`Plan-Client-AC-PP-SP001-DOM001-PARC001-H07.pdf`).

## 5. Aperçu avant impression dans le détail de parcelle

`src/routes/app.parcelles.$id.tsx`
- Nouveau bouton **« Aperçu avant impression »** ouvre un `Dialog` plein écran.
- Le dialog rend le PDF entreprise via `jsPDF` → `dataURIString()` dans un `<iframe>` (aperçu fidèle au PDF final).
- Sélecteur de variante : **Entreprise** / **Client (par lot)** + dropdown du lot.
- Actions : `Imprimer` (window.print de l'iframe), `Télécharger PDF`, `Fermer`.

## 6. Exports par lot — boutons supplémentaires

Dans le détail parcelle, section morcellement :
- Bouton **« Tous les plans clients (ZIP) »** → génère un PDF par lot et empaquette via `JSZip` (déjà installé indirectement avec `shp-write` ? sinon `bun add jszip`).
- Boutons existants DXF/GeoJSON/KML/SHP inchangés.

## Acceptance
- Marquage GPS : clic → point ajouté, **aucun** indicateur « x/30 ».
- Chaque lot strict 1,00 ha (déjà garanti par `morcelerStrict`).
- PDF entreprise visuellement aligné sur Plan_1.png.
- PDF client visuellement aligné sur Plan_client.png, un par lot, mettant en évidence le lot du souscripteur.
- Aperçu avant impression fonctionnel dans le détail parcelle.
- Coordonnées UTM du tableau = coordonnées projetées des points A1..An réellement levés.

## Notes techniques
- Projection UTM : déjà via `proj4` dans `src/lib/dxf.ts` → factoriser dans `src/lib/utm.ts` partagé par DXF et PDF pour cohérence stricte X/Y.
- Longueurs des segments : calcul Haversine entre points consécutifs (déjà dans `src/lib/gps.ts`).
- Pas de changement de schéma Supabase.