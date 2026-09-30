"""
Modèle de scoring fraude — Agent 2 du pipeline agentique.

Architecture hybride :
  Score final (0-100) = score_règles (0-50) + score_ml (0-50)

  - score_règles : règles métier explicables → Reason Codes Power BI
  - score_ml     : régression logistique entraînée sur les features engineerées

Catégories de risque :
  Faible  :  0 – 29  → Straight-Through Processing
  Moyen   : 30 – 59  → Contrôle léger
  Élevé   : 60 – 100 → Renvoi SIU

Usage CLI :
  python scoring-model.py --mode train
  python scoring-model.py --mode score --sinistres ../../data-mock/sinistres_mock.json

Azure ML : le script accepte les arguments standard MLflow ; les chemins
           d'entrée/sortie sont passés via --data-path et --model-output.
"""

import argparse
import json
import os
import warnings
from datetime import date

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# Intégration MLflow optionnelle (disponible nativement dans Azure ML)
try:
    import mlflow
    MLFLOW_AVAILABLE = True
except ImportError:
    MLFLOW_AVAILABLE = False

# ---------------------------------------------------------------------------
# Chemins par défaut (relatifs au script)
# ---------------------------------------------------------------------------
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.join(_SCRIPT_DIR, "..", "..")

DEFAULT_SINISTRES = os.path.join(_REPO_ROOT, "data-mock", "sinistres_mock.json")
DEFAULT_POLICES = os.path.join(_REPO_ROOT, "data-mock", "polices_mock.json")
DEFAULT_MODEL_DIR = os.path.join(_SCRIPT_DIR, "model_artifacts")

# Seuils de fenêtres temporelles pour la détection de clusters
WINDOW_REPARATEUR_DAYS = 90  # cluster réparateur
WINDOW_IP_DAYS = 30          # cluster IP

# Seuils de catégorisation du score final
SEUIL_FAIBLE = 30
SEUIL_MOYEN = 60


# ---------------------------------------------------------------------------
# Chargement et jointure des données
# ---------------------------------------------------------------------------

def load_data(sinistres_path: str, polices_path: str) -> pd.DataFrame:
    """Charge et joint sinistres + polices en un seul DataFrame."""
    with open(sinistres_path, encoding="utf-8") as f:
        sinistres = pd.DataFrame(json.load(f))
    with open(polices_path, encoding="utf-8") as f:
        polices = pd.DataFrame(json.load(f))

    df = sinistres.merge(polices[["id_police", "date_souscription",
                                   "franchise", "plafond_garantie",
                                   "type_contrat"]],
                         on="id_police", how="left")

    # Conversion des colonnes date
    df["date_declaration"] = pd.to_datetime(df["date_declaration"])
    df["date_souscription"] = pd.to_datetime(df["date_souscription"])

    return df


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def compute_cluster_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calcule les features de clustering temporel :
      - reparateur_count_Xd : nb de sinistres vers le même réparateur sur X jours
      - ip_count_Xd         : nb de sinistres depuis la même IP sur X jours
    Ces features sont le cœur de la détection de réseaux frauduleux.
    """
    df = df.copy().sort_values("date_declaration")

    # Cluster réparateur (fenêtre glissante WINDOW_REPARATEUR_DAYS jours)
    rep_counts = []
    for _, row in df.iterrows():
        window_start = row["date_declaration"] - pd.Timedelta(days=WINDOW_REPARATEUR_DAYS)
        mask = (
            (df["id_reparateur"] == row["id_reparateur"])
            & (df["date_declaration"] >= window_start)
            & (df["date_declaration"] <= row["date_declaration"])
            & (df["id_sinistre"] != row["id_sinistre"])
        )
        rep_counts.append(mask.sum())
    df["reparateur_count_90d"] = rep_counts

    # Cluster IP (fenêtre glissante WINDOW_IP_DAYS jours)
    ip_counts = []
    for _, row in df.iterrows():
        window_start = row["date_declaration"] - pd.Timedelta(days=WINDOW_IP_DAYS)
        mask = (
            (df["adresse_ip_declaration"] == row["adresse_ip_declaration"])
            & (df["date_declaration"] >= window_start)
            & (df["date_declaration"] <= row["date_declaration"])
            & (df["id_sinistre"] != row["id_sinistre"])
        )
        ip_counts.append(mask.sum())
    df["ip_count_30d"] = ip_counts

    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Construit toutes les features numériques pour le modèle ML."""
    df = compute_cluster_features(df)

    # Délai entre souscription et déclaration (en jours)
    df["days_since_subscription"] = (
        df["date_declaration"] - df["date_souscription"]
    ).dt.days.clip(lower=0)

    # Ratio montant réclamé / plafond de garantie
    df["montant_sur_plafond"] = df["montant_reclame"] / df["plafond_garantie"].replace(0, 1)

    # Z-score du montant au sein de chaque type de sinistre
    type_stats = df.groupby("type")["montant_reclame"].agg(["mean", "std"])
    df = df.join(type_stats, on="type", rsuffix="_type")
    df["montant_zscore"] = (
        (df["montant_reclame"] - df["mean"]) / df["std"].replace(0, 1)
    ).fillna(0)
    df.drop(columns=["mean", "std"], inplace=True)

    # Jour de la semaine de la déclaration (0=lundi … 6=dimanche)
    df["declaration_weekday"] = df["date_declaration"].dt.weekday

    # Encodage du type de sinistre (label encoding stable)
    type_order = sorted(df["type"].unique())
    df["type_encoded"] = df["type"].apply(
        lambda t: type_order.index(t) if t in type_order else -1
    )

    # Flag IP suspecte (partagée par 2+ assurés distincts sur la fenêtre)
    df["ip_suspicious"] = (df["ip_count_30d"] >= 1).astype(int)

    # Flag réparateur concentré (3+ sinistres dans la fenêtre 90j)
    df["reparateur_suspicious"] = (df["reparateur_count_90d"] >= 2).astype(int)

    # Flag déclaration précoce (< 30 jours après souscription)
    df["precoce_flag"] = (df["days_since_subscription"] < 30).astype(int)

    return df


FEATURE_COLUMNS = [
    "days_since_subscription",
    "montant_sur_plafond",
    "montant_zscore",
    "declaration_weekday",
    "type_encoded",
    "reparateur_count_90d",
    "ip_count_30d",
    "ip_suspicious",
    "reparateur_suspicious",
    "precoce_flag",
    "franchise",
]


# ---------------------------------------------------------------------------
# Score basé sur les règles métier (0-50 points)
# ---------------------------------------------------------------------------

def compute_rule_score(row: pd.Series) -> tuple[int, list[str]]:
    """
    Applique les règles métier et retourne (score_règles, reason_codes).
    Les reason codes sont lisibles par un investigateur SIU.
    """
    score = 0
    reasons = []

    # Règle 1 — IP partagée entre plusieurs assurés distincts
    if row["ip_count_30d"] >= 1:
        pts = min(20, int(row["ip_count_30d"]) * 10)
        score += pts
        reasons.append(
            f"Adresse IP partagée avec {int(row['ip_count_30d'])} autre(s) dossier(s) "
            f"sur 30 jours ({row['adresse_ip_declaration']})"
        )

    # Règle 2 — Réseau réparateur concentré
    if row["reparateur_count_90d"] >= 2:
        pts = min(20, int(row["reparateur_count_90d"]) * 7)
        score += pts
        reasons.append(
            f"Réparateur {row['id_reparateur']} impliqué dans "
            f"{int(row['reparateur_count_90d'])} autre(s) dossier(s) sur 90 jours"
        )

    # Règle 3 — Déclaration très précoce après souscription
    if row["days_since_subscription"] < 30:
        score += 15
        reasons.append(
            f"Sinistre déclaré {int(row['days_since_subscription'])} jours "
            "après la souscription de la police (< 30 jours)"
        )

    # Règle 4 — Montant anormalement élevé pour le type de sinistre
    if row["montant_zscore"] > 1.8:
        score += 10
        reasons.append(
            f"Montant réclamé ({int(row['montant_reclame'])} €) supérieur "
            f"de {row['montant_zscore']:.1f}σ à la moyenne du type '{row['type']}'"
        )

    return min(score, 50), reasons


# ---------------------------------------------------------------------------
# Entraînement du modèle ML
# ---------------------------------------------------------------------------

def train(sinistres_path: str, polices_path: str, model_dir: str) -> None:
    """Entraîne la régression logistique et sauvegarde les artefacts."""
    print("Chargement des données...")
    df = load_data(sinistres_path, polices_path)

    print("Feature engineering...")
    df = engineer_features(df)

    X = df[FEATURE_COLUMNS].fillna(0).values
    y = df["flag_fraude_suspect"].astype(int).values

    print(f"  Échantillons : {len(y)} | Frauduleux : {y.sum()} | Normaux : {(y == 0).sum()}")

    # Pipeline : normalisation + régression logistique avec équilibrage des classes
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            C=0.5,
            class_weight="balanced",  # compense le déséquilibre fraude / non-fraude
            max_iter=1000,
            random_state=42,
        )),
    ])

    # Validation croisée stratifiée (conserve le ratio fraude/non-fraude dans chaque fold)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(pipeline, X, y, cv=cv, scoring="roc_auc")
    print(f"\nValidation croisée ROC-AUC : {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Entraînement final sur l'ensemble des données mock
    pipeline.fit(X, y)

    # Rapport de classification sur les données d'entraînement (indicatif pour la démo)
    y_pred = pipeline.predict(X)
    y_proba = pipeline.predict_proba(X)[:, 1]
    print("\n--- Rapport sur données d'entraînement (démo uniquement) ---")
    print(classification_report(y, y_pred, target_names=["Normal", "Fraude"]))
    print(f"ROC-AUC entraînement : {roc_auc_score(y, y_proba):.3f}")

    # Coefficients explicatifs
    coefs = dict(zip(FEATURE_COLUMNS, pipeline["clf"].coef_[0]))
    print("\nCoefficients du modèle :")
    for feat, coef in sorted(coefs.items(), key=lambda x: abs(x[1]), reverse=True):
        print(f"  {feat:<30s} {coef:+.4f}")

    # Sauvegarde des artefacts
    os.makedirs(model_dir, exist_ok=True)
    joblib.dump(pipeline, os.path.join(model_dir, "fraud_pipeline.joblib"))
    with open(os.path.join(model_dir, "feature_columns.json"), "w") as f:
        json.dump(FEATURE_COLUMNS, f)
    with open(os.path.join(model_dir, "type_order.json"), "w") as f:
        json.dump(sorted(df["type"].unique().tolist()), f)

    print(f"\nArtefacts sauvegardés dans : {model_dir}")

    if MLFLOW_AVAILABLE:
        mlflow.log_metric("cv_roc_auc_mean", float(cv_scores.mean()))
        mlflow.log_metric("cv_roc_auc_std", float(cv_scores.std()))
        mlflow.log_metric("train_roc_auc", float(roc_auc_score(y, y_proba)))
        mlflow.sklearn.log_model(pipeline, "fraud_pipeline")
        print("Métriques et modèle enregistrés dans MLflow.")


# ---------------------------------------------------------------------------
# Scoring d'un dossier ou d'un batch
# ---------------------------------------------------------------------------

def load_model_artifacts(model_dir: str) -> tuple:
    """Charge le pipeline et les métadonnées associées."""
    pipeline = joblib.load(os.path.join(model_dir, "fraud_pipeline.joblib"))
    with open(os.path.join(model_dir, "feature_columns.json")) as f:
        feature_cols = json.load(f)
    with open(os.path.join(model_dir, "type_order.json")) as f:
        type_order = json.load(f)
    return pipeline, feature_cols, type_order


def score_batch(sinistres_path: str, polices_path: str, model_dir: str,
                output_path: str | None = None) -> pd.DataFrame:
    """
    Score un batch de sinistres et retourne un DataFrame enrichi.
    Si output_path est fourni, écrit le résultat en JSON.
    """
    df = load_data(sinistres_path, polices_path)
    df = engineer_features(df)

    pipeline, feature_cols, type_order = load_model_artifacts(model_dir)

    # Score ML (probabilité × 50 → contribution 0-50 pts)
    X = df[feature_cols].fillna(0).values
    ml_proba = pipeline.predict_proba(X)[:, 1]
    df["score_ml"] = (ml_proba * 50).round(1)

    # Score règles + reason codes
    rule_results = df.apply(compute_rule_score, axis=1)
    df["score_regles"] = rule_results.apply(lambda x: x[0])
    df["reason_codes"] = rule_results.apply(lambda x: x[1])

    # Score final et catégorie de risque
    df["score_fraude"] = (df["score_ml"] + df["score_regles"]).clip(upper=100).round(1)
    df["categorie_risque"] = df["score_fraude"].apply(categorize_risk)

    # Colonnes de sortie (format Dataverse)
    result = df[[
        "id_sinistre", "id_police", "id_assure", "date_declaration",
        "type", "montant_reclame", "id_reparateur", "rapport_police",
        "score_fraude", "score_ml", "score_regles", "categorie_risque",
        "reason_codes", "statut",
    ]].copy()

    print("\n=== Résultats de scoring ===")
    print(result[["id_sinistre", "type", "montant_reclame",
                   "score_fraude", "categorie_risque"]].to_string(index=False))

    summary = result["categorie_risque"].value_counts()
    print(f"\nRépartition : {summary.to_dict()}")

    if output_path:
        records = result.copy()
        records["reason_codes"] = records["reason_codes"].apply(list)
        records["date_declaration"] = records["date_declaration"].astype(str)
        records.to_json(output_path, orient="records", force_ascii=False, indent=2)
        print(f"\nRésultats exportés → {output_path}")

    return result


def score_single(sinistre: dict, police: dict, model_dir: str) -> dict:
    """
    Score un seul sinistre en temps réel (appelé par l'agent Copilot Studio).
    Retourne le sinistre enrichi avec score, catégorie et reason codes.
    """
    df_sin = pd.DataFrame([sinistre])
    df_pol = pd.DataFrame([police])
    df = df_sin.merge(df_pol[["id_police", "date_souscription",
                               "franchise", "plafond_garantie",
                               "type_contrat"]],
                      on="id_police", how="left")
    df["date_declaration"] = pd.to_datetime(df["date_declaration"])
    df["date_souscription"] = pd.to_datetime(df["date_souscription"])

    # Les features de clustering nécessitent l'historique complet
    # En production, on requête Dataverse pour obtenir les sinistres récents du même réparateur/IP
    # Ici on fournit des valeurs par défaut conservatrices pour les features de cluster
    df["reparateur_count_90d"] = sinistre.get("_reparateur_count_90d", 0)
    df["ip_count_30d"] = sinistre.get("_ip_count_30d", 0)

    df["days_since_subscription"] = (
        df["date_declaration"] - df["date_souscription"]
    ).dt.days.clip(lower=0)
    df["montant_sur_plafond"] = df["montant_reclame"] / df["plafond_garantie"].replace(0, 1)
    df["montant_zscore"] = 0.0  # calculé sur l'ensemble du portefeuille en prod
    df["declaration_weekday"] = df["date_declaration"].dt.weekday
    df["ip_suspicious"] = (df["ip_count_30d"] >= 1).astype(int)
    df["reparateur_suspicious"] = (df["reparateur_count_90d"] >= 2).astype(int)
    df["precoce_flag"] = (df["days_since_subscription"] < 30).astype(int)

    pipeline, feature_cols, type_order = load_model_artifacts(model_dir)
    df["type_encoded"] = df["type"].apply(
        lambda t: type_order.index(t) if t in type_order else -1
    )

    X = df[feature_cols].fillna(0).values
    ml_proba = float(pipeline.predict_proba(X)[0, 1])
    score_ml = round(ml_proba * 50, 1)

    row = df.iloc[0]
    score_regles, reason_codes = compute_rule_score(row)
    score_final = min(round(score_ml + score_regles, 1), 100)

    return {
        **sinistre,
        "score_fraude":    score_final,
        "score_ml":        score_ml,
        "score_regles":    score_regles,
        "categorie_risque": categorize_risk(score_final),
        "reason_codes":    reason_codes,
    }


def categorize_risk(score: float) -> str:
    """Traduit le score numérique en catégorie textuelle."""
    if score < SEUIL_FAIBLE:
        return "Faible"
    elif score < SEUIL_MOYEN:
        return "Moyen"
    return "Élevé"


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scoring fraude — Agent 2 Azure ML"
    )
    parser.add_argument("--mode", choices=["train", "score"], default="train",
                        help="'train' : entraîne et sauvegarde le modèle ; "
                             "'score' : charge le modèle et score les sinistres")
    parser.add_argument("--sinistres", default=DEFAULT_SINISTRES,
                        help="Chemin vers sinistres_mock.json")
    parser.add_argument("--polices", default=DEFAULT_POLICES,
                        help="Chemin vers polices_mock.json")
    parser.add_argument("--model-dir", default=DEFAULT_MODEL_DIR,
                        help="Répertoire de sauvegarde/chargement des artefacts")
    parser.add_argument("--output", default=None,
                        help="(mode score) Chemin JSON de sortie des scores")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.mode == "train":
        train(args.sinistres, args.polices, args.model_dir)
    else:
        if not os.path.exists(os.path.join(args.model_dir, "fraud_pipeline.joblib")):
            print("Modèle introuvable — lancement de l'entraînement d'abord.")
            train(args.sinistres, args.polices, args.model_dir)
        score_batch(args.sinistres, args.polices, args.model_dir, args.output)


if __name__ == "__main__":
    main()
