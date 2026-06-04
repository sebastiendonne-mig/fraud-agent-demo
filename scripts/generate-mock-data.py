"""
Génération des données fictives IARD pour la démo agent détecteur de fraude.

Produit trois fichiers dans /data-mock/ :
  - sinistres_mock.json   : 50 dossiers sinistres
  - polices_mock.json     : contrats associés
  - rapports_police_mock.txt : rapports texte pour analyse LLM

Patterns de fraude intégrés (8 dossiers) :
  - Réseau de réparateurs complices (même id_reparateur sur plusieurs dossiers proches)
  - Anneau d'IP partagées (même adresse IP pour plusieurs assurés distincts)
  - Déclaration suspecte dans les 30 jours suivant la souscription de la police

5 dossiers supplémentaires comportent un rapport de police avec tiers responsable identifié.
"""

import json
import random
import os
from datetime import date, timedelta

# --- Graine aléatoire pour reproductibilité ---
random.seed(42)

# --- Chemins de sortie ---
BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "data-mock")
SINISTRES_PATH = os.path.join(BASE_DIR, "sinistres_mock.json")
POLICES_PATH = os.path.join(BASE_DIR, "polices_mock.json")
RAPPORTS_PATH = os.path.join(BASE_DIR, "rapports_police_mock.txt")

# ---------------------------------------------------------------------------
# Référentiels fictifs
# ---------------------------------------------------------------------------

ASSURES = [
    {"id_assure": f"ASS-{1000 + i}", "nom": nom, "prenom": prenom,
     "date_naissance": dob, "ville": ville, "code_postal": cp}
    for i, (nom, prenom, dob, ville, cp) in enumerate([
        ("Dupont",    "Jean",      "1978-04-12", "Paris",         "75011"),
        ("Martin",    "Sophie",    "1985-09-23", "Lyon",          "69003"),
        ("Bernard",   "Marc",      "1970-01-30", "Marseille",     "13008"),
        ("Thomas",    "Élise",     "1992-06-14", "Bordeaux",      "33000"),
        ("Robert",    "Julien",    "1988-11-05", "Nantes",        "44000"),
        ("Petit",     "Marie",     "1965-03-19", "Toulouse",      "31000"),
        ("Richard",   "Antoine",   "1975-07-28", "Strasbourg",    "67000"),
        ("Durand",    "Camille",   "1990-02-08", "Lille",         "59000"),
        ("Leroy",     "Théo",      "1982-08-17", "Nice",          "06000"),
        ("Moreau",    "Isabelle",  "1968-12-31", "Rennes",        "35000"),
        ("Simon",     "Lucas",     "1995-05-22", "Reims",         "51000"),
        ("Laurent",   "Valérie",   "1973-10-03", "Toulon",        "83000"),
        ("Lefebvre",  "Paul",      "1987-04-25", "Grenoble",      "38000"),
        ("Michel",    "Nathalie",  "1980-06-09", "Dijon",         "21000"),
        ("Garcia",    "David",     "1993-01-14", "Angers",        "49000"),
        ("Clement",   "Aurélie",   "1971-09-17", "Saint-Étienne", "42000"),
        ("Girard",    "François",  "1984-03-06", "Brest",         "29200"),
        ("Rousseau",  "Claire",    "1977-11-20", "Villeurbanne",  "69100"),
        ("Vincent",   "Nicolas",   "1991-07-11", "Limoges",       "87000"),
        ("Fournier",  "Sandrine",  "1966-02-28", "Montpellier",   "34000"),
        # Assurés du réseau frauduleux (même réparateur)
        ("Chevalier", "Romain",    "1983-08-04", "Paris",         "75018"),
        ("Bonnet",    "Amandine",  "1989-05-13", "Paris",         "75018"),
        ("François",  "Kevin",     "1994-10-27", "Paris",         "75019"),
        ("Morel",     "Stéphanie", "1979-12-01", "Paris",         "75019"),
        # Assurés du réseau IP partagée
        ("Perrin",    "Alexis",    "1986-06-30", "Marseille",     "13001"),
        ("Renard",    "Lena",      "1990-03-22", "Marseille",     "13002"),
        ("Leroux",    "Hugo",      "1988-09-15", "Marseille",     "13003"),
        ("Roux",      "Manon",     "1992-11-08", "Marseille",     "13004"),
        # Assurés déclarant juste après souscription
        ("Blanc",     "Tristan",   "1997-04-01", "Nantes",        "44100"),
        ("Guerin",    "Océane",    "1996-07-19", "Nantes",        "44300"),
        # Assurés normaux supplémentaires
        ("Henry",     "Frédéric",  "1974-01-23", "Tours",         "37000"),
        ("Gauthier",  "Élodie",    "1981-08-29", "Amiens",        "80000"),
        ("Faure",     "Bertrand",  "1969-06-05", "Caen",          "14000"),
        ("Andre",     "Mélanie",   "1985-02-12", "Nancy",         "54000"),
        ("Mercier",   "Quentin",   "1993-09-03", "Rouen",         "76000"),
        ("Dupuis",    "Virginie",  "1976-04-18", "Metz",          "57000"),
        ("Lambert",   "Maxime",    "1988-07-07", "Perpignan",     "66000"),
        ("Bonin",     "Séverine",  "1972-03-14", "Clermont-Ferrand","63000"),
        ("Caron",     "Damien",    "1990-10-26", "Mulhouse",      "68100"),
        ("Picard",    "Jessica",   "1983-12-09", "Orléans",       "45000"),
        ("Joubert",   "Samuel",    "1977-05-31", "Avignon",       "84000"),
        ("Barbier",   "Caroline",  "1968-08-22", "Poitiers",      "86000"),
        ("Arnaud",    "Cyril",     "1995-01-17", "Besançon",      "25000"),
        ("Philippe",  "Laetitia",  "1980-11-04", "Caen",          "14200"),
        ("Pons",      "Adrien",    "1987-06-26", "Toulon",        "83200"),
        ("Masson",    "Florence",  "1973-02-08", "Angers",        "49100"),
        ("Leblanc",   "Rémi",      "1991-04-03", "Brest",         "29000"),
        ("Gilles",    "Patricia",  "1964-09-14", "Reims",         "51100"),
        ("Muller",    "Thomas",    "1986-03-27", "Strasbourg",    "67100"),
        ("Denis",     "Aurore",    "1993-07-20", "Dijon",         "21100"),
    ])
]

# Réparateurs agréés (dont REP-007 = réparateur complice du réseau frauduleux)
REPARATEURS = {
    "REP-001": "Garage Lefranc (Paris 15e)",
    "REP-002": "AutoService Méditerranée (Marseille)",
    "REP-003": "Carrosserie du Rhône (Lyon)",
    "REP-004": "Ateliers de la Loire (Nantes)",
    "REP-005": "Plomberie Gironde (Bordeaux)",
    "REP-006": "EDF Habitat Services (Toulouse)",
    "REP-007": "Carrosserie Express Paris (Paris 18e)",   # réseau frauduleux
    "REP-008": "Vitrerie Nationale (Lille)",
    "REP-009": "Dépannage Auto 06 (Nice)",
    "REP-010": "Toiture & Couverture Bretagne (Rennes)",
}

TYPES_SINISTRE = ["degat_des_eaux", "bris_de_glace", "accident_auto",
                  "incendie", "vol", "catastrophe_naturelle"]

# IP normales (pool large) vs IP suspectes (pool restreint = même adresse partagée)
IP_NORMALES = [f"91.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
               for _ in range(40)]
IP_SUSPECTES = ["185.23.14.77", "185.23.14.78"]  # même bloc = même réseau frauduleux


def random_date(start: date, end: date) -> date:
    """Retourne une date aléatoire entre start et end."""
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def build_montant(type_sinistre: str, is_fraud: bool = False) -> int:
    """Retourne un montant réclamé réaliste selon le type, gonflé si fraude."""
    ranges = {
        "degat_des_eaux":     (500,   8000),
        "bris_de_glace":      (150,   1200),
        "accident_auto":      (800,  18000),
        "incendie":           (2000, 50000),
        "vol":                (500,   6000),
        "catastrophe_naturelle": (1000, 25000),
    }
    low, high = ranges.get(type_sinistre, (500, 5000))
    montant = random.randint(low, high)
    if is_fraud:
        # montant gonflé de 40 à 80 %
        montant = int(montant * random.uniform(1.4, 1.8))
    return montant


# ---------------------------------------------------------------------------
# Génération des polices
# ---------------------------------------------------------------------------

def generate_polices(assures: list) -> list:
    """Crée une police par assuré avec des données cohérentes."""
    polices = []
    for assure in assures:
        assure_id = assure["id_assure"]
        # Numéro de police dérivé de l'ID assuré pour cohérence
        num = int(assure_id.split("-")[1])
        police_id = f"POL-{70000 + num}"
        # Date de souscription aléatoire sur 3 ans
        date_souscription = random_date(date(2021, 1, 1), date(2024, 6, 1))
        polices.append({
            "id_police":         police_id,
            "id_assure":         assure_id,
            "date_souscription": date_souscription.isoformat(),
            "date_expiration":   (date_souscription + timedelta(days=365)).isoformat(),
            "type_contrat":      random.choice(["MRH", "Auto", "Auto+MRH"]),
            "franchise":         random.choice([150, 300, 500, 750]),
            "plafond_garantie":  random.choice([50000, 75000, 100000, 150000]),
            "statut_police":     "active",
        })
    return polices


# ---------------------------------------------------------------------------
# Constructeurs de dossiers sinistres
# ---------------------------------------------------------------------------

def build_sinistre(idx: int, assure: dict, police: dict,
                   type_sinistre: str, declaration_date: date,
                   ip: str, reparateur_id: str,
                   is_fraud: bool = False,
                   has_rapport: bool = False) -> dict:
    """Construit un dossier sinistre complet."""
    return {
        "id_sinistre":          f"SIN-2024-{idx:04d}",
        "id_police":            police["id_police"],
        "id_assure":            assure["id_assure"],
        "date_declaration":     declaration_date.isoformat(),
        "type":                 type_sinistre,
        "montant_reclame":      build_montant(type_sinistre, is_fraud),
        "id_reparateur":        reparateur_id,
        "adresse_ip_declaration": ip,
        "rapport_police":       f"RAPPORT-{idx:04d}" if has_rapport else None,
        "score_fraude":         None,
        "statut":               "en_cours",
        "flag_fraude_suspect":  is_fraud,  # champ interne démo, masqué en prod
    }


# ---------------------------------------------------------------------------
# Génération principale
# ---------------------------------------------------------------------------

def generate_sinistres(assures: list, polices: list) -> list:
    """
    Génère 50 sinistres dont :
      - 8 frauduleux (patterns détectables)
      - 5 avec rapport de police et tiers responsable
      - 37 dossiers normaux
    """
    # Index lookup police par assuré
    police_by_assure = {p["id_assure"]: p for p in polices}

    sinistres = []
    idx = 1

    # ------------------------------------------------------------------
    # PATTERN 1 — Réseau réparateur complice (assurés 20-23, REP-007)
    # Même garagiste, dates groupées, montants gonflés, même arrondissement
    # ------------------------------------------------------------------
    fraud_reseau_dates = [
        date(2024, 3, 4), date(2024, 3, 11),
        date(2024, 3, 18), date(2024, 3, 25),
    ]
    for i, assure_idx in enumerate([20, 21, 22, 23]):
        assure = assures[assure_idx]
        police = police_by_assure[assure["id_assure"]]
        sinistres.append(build_sinistre(
            idx, assure, police,
            type_sinistre="accident_auto",
            declaration_date=fraud_reseau_dates[i],
            ip=IP_NORMALES[assure_idx],
            reparateur_id="REP-007",
            is_fraud=True,
        ))
        idx += 1

    # ------------------------------------------------------------------
    # PATTERN 2 — IP partagée (assurés 24-25, adresses IP suspectes)
    # Deux assurés distincts déclarant depuis la même IP à deux jours d'intervalle
    # ------------------------------------------------------------------
    fraud_ip_dates = [
        date(2024, 5, 6), date(2024, 5, 8),
    ]
    fraud_ip_list = [IP_SUSPECTES[0], IP_SUSPECTES[0]]
    for i, assure_idx in enumerate([24, 25]):
        assure = assures[assure_idx]
        police = police_by_assure[assure["id_assure"]]
        sinistres.append(build_sinistre(
            idx, assure, police,
            type_sinistre=random.choice(["degat_des_eaux", "vol"]),
            declaration_date=fraud_ip_dates[i],
            ip=fraud_ip_list[i],
            reparateur_id=random.choice(["REP-002", "REP-009"]),
            is_fraud=True,
        ))
        idx += 1

    # ------------------------------------------------------------------
    # PATTERN 3 — Déclaration dans les 30 jours après souscription (assurés 28-29)
    # ------------------------------------------------------------------
    for assure_idx in [28, 29]:
        assure = assures[assure_idx]
        police = police_by_assure[assure["id_assure"]]
        souscription = date.fromisoformat(police["date_souscription"])
        # Déclaration entre J+5 et J+25 après souscription
        declaration_date = souscription + timedelta(days=random.randint(5, 25))
        sinistres.append(build_sinistre(
            idx, assure, police,
            type_sinistre="degat_des_eaux",
            declaration_date=declaration_date,
            ip=IP_NORMALES[assure_idx],
            reparateur_id="REP-005",
            is_fraud=True,
        ))
        idx += 1

    # ------------------------------------------------------------------
    # 5 DOSSIERS AVEC RAPPORT DE POLICE (accident auto, tiers responsable)
    # Assurés normaux (indices 0-4)
    # ------------------------------------------------------------------
    rapport_assures = [0, 1, 2, 3, 4]
    for assure_idx in rapport_assures:
        assure = assures[assure_idx]
        police = police_by_assure[assure["id_assure"]]
        declaration_date = random_date(date(2024, 1, 1), date(2024, 11, 30))
        sinistres.append(build_sinistre(
            idx, assure, police,
            type_sinistre="accident_auto",
            declaration_date=declaration_date,
            ip=IP_NORMALES[assure_idx],
            reparateur_id=random.choice(["REP-001", "REP-003", "REP-009"]),
            is_fraud=False,
            has_rapport=True,
        ))
        idx += 1

    # ------------------------------------------------------------------
    # DOSSIERS NORMAUX — complète jusqu'à 50
    # ------------------------------------------------------------------
    used_assure_indices = set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29] + rapport_assures)
    remaining_assures = [a for i, a in enumerate(assures) if i not in used_assure_indices]
    random.shuffle(remaining_assures)

    normal_count = 50 - len(sinistres)
    for i in range(normal_count):
        assure = remaining_assures[i % len(remaining_assures)]
        police = police_by_assure[assure["id_assure"]]
        declaration_date = random_date(date(2024, 1, 1), date(2024, 12, 15))
        type_sinistre = random.choice(TYPES_SINISTRE)
        reparateur_id = random.choice(list(REPARATEURS.keys()))
        ip = IP_NORMALES[i % len(IP_NORMALES)]
        sinistres.append(build_sinistre(
            idx, assure, police,
            type_sinistre=type_sinistre,
            declaration_date=declaration_date,
            ip=ip,
            reparateur_id=reparateur_id,
            is_fraud=False,
        ))
        idx += 1

    # Mélange final (sauf dossiers fraud/rapport triés pour lisibilité démo)
    random.shuffle(sinistres)
    # Réassigner les IDs dans l'ordre final
    for i, s in enumerate(sinistres, start=1):
        s["id_sinistre"] = f"SIN-2024-{i:04d}"

    return sinistres


# ---------------------------------------------------------------------------
# Génération des rapports de police fictifs
# ---------------------------------------------------------------------------

RAPPORTS_TEMPLATE = [
    {
        "id": "RAPPORT-{idx}",
        "assure_nom": "{nom}",
        "date_accident": "{date}",
        "lieu": "{lieu}",
        "texte": (
            "PROCÈS-VERBAL D'ACCIDENT DE LA CIRCULATION\n"
            "Date : {date} — Lieu : {lieu}\n\n"
            "Circonstances : Le véhicule immatriculé {plaque_tiers} conduit par M./Mme {conducteur_tiers} "
            "a grillé un feu rouge à l'intersection de la rue {rue} et a percuté le véhicule "
            "de M./Mme {nom_assure}, qui circulait normalement sur sa voie prioritaire.\n\n"
            "Responsabilité : Le conducteur du véhicule {plaque_tiers} est déclaré seul responsable "
            "de l'accident (infraction au Code de la route article R412-30). "
            "Aucune faute de conduite relevée côté assuré.\n\n"
            "Blessés : {blesses}\n"
            "Témoins : {temoins}\n"
            "Part de responsabilité tiers estimée : 100 %\n"
            "Niveau de certitude : Élevé\n"
        ),
    }
]

LIEUX_ACCIDENT = [
    ("Paris 12e", "du Faubourg Saint-Antoine", "rue de Lyon"),
    ("Lyon 3e",   "de la Part-Dieu",           "cours Lafayettte"),
    ("Marseille 8e", "du Prado",               "avenue du Périer"),
    ("Bordeaux",  "des Chartrons",             "quai des Marques"),
    ("Nantes",    "de la gare",                "rue de Strasbourg"),
]

CONDUCTEURS_TIERS = [
    ("DT-456-AB", "Karim Bensalem"),
    ("GH-789-CD", "Nathalie Voisin"),
    ("MN-123-EF", "Patrick Lemaire"),
    ("ZZ-321-GH", "Ingrid Holst"),
    ("YY-654-IJ", "Olivier Château"),
]


def generate_rapports_police(sinistres: list, assures: list) -> str:
    """
    Génère le fichier texte des 5 rapports de police.
    Chaque rapport est séparé par une ligne de séparation.
    """
    assure_by_id = {a["id_assure"]: a for a in assures}
    rapport_sinistres = [s for s in sinistres if s["rapport_police"] is not None]

    lignes = []
    for i, sin in enumerate(rapport_sinistres):
        assure = assure_by_id[sin["id_assure"]]
        lieu_data = LIEUX_ACCIDENT[i % len(LIEUX_ACCIDENT)]
        tiers_data = CONDUCTEURS_TIERS[i % len(CONDUCTEURS_TIERS)]

        has_blesses = random.choice([True, False])
        blesses_txt = (
            f"Légères contusions côté assuré (M./Mme {assure['prenom']} {assure['nom']}), "
            "transporté aux urgences à titre de précaution."
            if has_blesses else "Aucun blessé."
        )

        texte = (
            "PROCÈS-VERBAL D'ACCIDENT DE LA CIRCULATION\n"
            f"Référence rapport : {sin['rapport_police']}\n"
            f"Date : {sin['date_declaration']} — Lieu : {lieu_data[0]}, "
            f"intersection {lieu_data[1]} / {lieu_data[2]}\n\n"
            f"Circonstances : Le véhicule immatriculé {tiers_data[0]} conduit par "
            f"M./Mme {tiers_data[1]} a grillé un feu rouge à l'intersection de la "
            f"{lieu_data[1]} et a percuté le véhicule de M./Mme {assure['prenom']} "
            f"{assure['nom']}, qui circulait normalement sur sa voie prioritaire.\n\n"
            f"Responsabilité : Le conducteur du véhicule {tiers_data[0]} est déclaré "
            "seul responsable de l'accident (infraction au Code de la route, art. R412-30). "
            "Aucune faute de conduite relevée côté assuré.\n\n"
            f"Blessés : {blesses_txt}\n"
            "Témoins : Deux témoins ont confirmé la version de l'assuré (déclarations "
            "consignées au procès-verbal).\n"
            "Part de responsabilité tiers estimée : 100 %\n"
            "Niveau de certitude : Élevé\n"
        )
        lignes.append(texte)
        lignes.append("=" * 72 + "\n")

    return "\n".join(lignes)


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    print("Génération des assurés et polices...")
    polices = generate_polices(ASSURES)

    print("Génération des 50 sinistres...")
    sinistres = generate_sinistres(ASSURES, polices)

    print("Génération des rapports de police...")
    rapports_texte = generate_rapports_police(sinistres, ASSURES)

    # Écriture des fichiers
    with open(SINISTRES_PATH, "w", encoding="utf-8") as f:
        json.dump(sinistres, f, ensure_ascii=False, indent=2)
    print(f"  ✓ {SINISTRES_PATH}  ({len(sinistres)} sinistres)")

    with open(POLICES_PATH, "w", encoding="utf-8") as f:
        json.dump(polices, f, ensure_ascii=False, indent=2)
    print(f"  ✓ {POLICES_PATH}  ({len(polices)} polices)")

    with open(RAPPORTS_PATH, "w", encoding="utf-8") as f:
        f.write(rapports_texte)
    print(f"  ✓ {RAPPORTS_PATH}")

    # Résumé rapide
    frauduleux = [s for s in sinistres if s["flag_fraude_suspect"]]
    avec_rapport = [s for s in sinistres if s["rapport_police"]]
    print("\n--- Résumé ---")
    print(f"  Total sinistres       : {len(sinistres)}")
    print(f"  Dossiers frauduleux   : {len(frauduleux)}")
    print(f"  Avec rapport police   : {len(avec_rapport)}")
    print(f"  Polices générées      : {len(polices)}")


if __name__ == "__main__":
    main()
