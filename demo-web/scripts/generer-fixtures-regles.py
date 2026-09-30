"""
Génère test/fixtures/regles-python.json : des cas synthétiques passés dans
compute_rule_score de ml/scoring-model.py (source de vérité), pour tester la
parité du port JavaScript sur les règles que la base fictive ne déclenche pas
(montant anormal, arrondis du z-score). Exécution locale, sans réseau.
"""
import importlib.util
import json
import os

import pandas as pd

ICI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "scoring_model", os.path.join(ICI, "..", "..", "ml", "scoring-model.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

cas = []
zscores = [1.8, 1.8000001, 1.85, 1.95, 2.05, 2.25, 2.35, 2.45, 3.05, 4.999, 12.34]
for i, z in enumerate(zscores):
    cas.append({"ip_count_30d": i % 3, "reparateur_count_90d": i % 4,
                "days_since_subscription": [0, 5, 29, 30, 400][i % 5],
                "montant_zscore": z, "montant_reclame": 1000 + 137 * i,
                "type": "accident_auto", "id_reparateur": f"REP-{i:03d}",
                "adresse_ip_declaration": f"203.0.113.{i}"})

resultats = []
for c in cas:
    score, reasons = module.compute_rule_score(pd.Series(c))
    resultats.append({"entree": c, "score": int(score), "reason_codes": reasons})

with open(os.path.join(ICI, "..", "test", "fixtures", "regles-python.json"), "w", encoding="utf-8") as f:
    json.dump(resultats, f, ensure_ascii=False, indent=2)
print(f"{len(resultats)} cas écrits")
