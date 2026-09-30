# Features du modèle de scoring fraude
*Dernière mise à jour : juin 2026*

---

## Architecture du score

Le score final (0–100) est la somme de deux composantes indépendantes et complémentaires :

| Composante | Plage | Méthode | Rôle |
|---|---|---|---|
| `score_regles` | 0–50 | Règles métier explicites | Détection patterns connus, Reason Codes |
| `score_ml` | 0–50 | Régression logistique | Généralisation sur combinaisons de signaux |
| **`score_fraude`** | **0–100** | Somme (cap 100) | **Score final transmis à Dataverse** |

### Catégories de risque

| Catégorie | Plage | Action |
|---|---|---|
| Faible | 0 – 29 | Straight-Through Processing (STP) |
| Moyen | 30 – 59 | Contrôle documentaire léger |
| Élevé | 60 – 100 | Renvoi SIU + Reason Codes Power BI |

---

## Features utilisées par le modèle ML

### Features temporelles

| Feature | Type | Construction | Signal de fraude |
|---|---|---|---|
| `days_since_subscription` | int | `date_declaration - date_souscription` (jours) | Fraude opportuniste : sinistre déclaré < 30j après souscription |
| `declaration_weekday` | int (0–6) | Jour de la semaine de la déclaration | Signal faible : certains réseaux évitent les lundis/vendredis |
| `precoce_flag` | bool | 1 si `days_since_subscription < 30` | Flag binaire complémentaire |

### Features financières

| Feature | Type | Construction | Signal de fraude |
|---|---|---|---|
| `montant_reclame` | int | Source directe sinistre | — |
| `montant_sur_plafond` | float | `montant_reclame / plafond_garantie` | Montants gonflés proches du plafond |
| `montant_zscore` | float | Z-score intra-type de sinistre | Montant statistiquement anormal vs le type (ex. DDO à 15 000 €) |
| `franchise` | int | Source directe police | Influence sur la motivation à frauder |

### Features de clustering (détection de réseaux)

| Feature | Type | Construction | Signal de fraude |
|---|---|---|---|
| `reparateur_count_90d` | int | Nb de sinistres vers le même `id_reparateur` sur 90 jours glissants | Réseau réparateur complice |
| `reparateur_suspicious` | bool | 1 si `reparateur_count_90d >= 2` | Flag binaire complémentaire |
| `ip_count_30d` | int | Nb de sinistres depuis la même `adresse_ip_declaration` sur 30 jours glissants | Anneau d'IP : plusieurs assurés coordonnés |
| `ip_suspicious` | bool | 1 si `ip_count_30d >= 1` | Flag binaire complémentaire |

### Feature de type de sinistre

| Feature | Type | Construction | Signal de fraude |
|---|---|---|---|
| `type_encoded` | int | Label encoding stable sur : `accident_auto`, `bris_de_glace`, `catastrophe_naturelle`, `degat_des_eaux`, `incendie`, `vol` | Certains types sont sur-représentés dans les fraudes réseau |

---

## Règles métier et barème (score_règles)

| Règle | Condition | Points | Reason Code généré |
|---|---|---|---|
| IP partagée | `ip_count_30d >= 1` | +10 pts par dossier concurrent (cap 20) | "Adresse IP partagée avec N autre(s) dossier(s) sur 30 jours" |
| Réseau réparateur | `reparateur_count_90d >= 2` | +7 pts par dossier concurrent (cap 20) | "Réparateur REP-XXX impliqué dans N autre(s) dossier(s) sur 90 jours" |
| Déclaration précoce | `days_since_subscription < 30` | +15 pts | "Sinistre déclaré N jours après la souscription de la police" |
| Montant anormal | `montant_zscore > 1.8` | +10 pts | "Montant réclamé supérieur de Nσ à la moyenne du type" |

---

## Notes d'implémentation

### Fenêtres temporelles
- **90 jours** pour le clustering réparateur : capture les montages étalés sur un trimestre.
- **30 jours** pour le clustering IP : les anneau d'IP opèrent sur des cycles courts.

### Données enrichies requises en production (Dataverse)
Pour scorer un sinistre en temps réel (`score_single`), le pipeline Copilot Studio doit fournir deux champs enrichis calculés par requête Dataverse avant l'appel :

```json
{
  "_reparateur_count_90d": 3,
  "_ip_count_30d": 2
}
```

Ces champs préfixés `_` sont des entrées de contexte, non stockées dans le dossier final.

### Limites du modèle de démo
- **50 échantillons** : l'AUC de validation croisée est indicative ; un modèle production nécessite ≥ 5 000 dossiers étiquetés.
- **Pas de dérive** : aucun mécanisme de détection de dérive (data drift) n'est intégré ici. En production, Azure ML Model Monitoring assure ce rôle.
- **Pas de recalibration** : la probabilité brute de la régression logistique est utilisée directement. En production, une calibration Platt ou isotonique est recommandée.

### Packages requis (Azure ML curated environment `AzureML-sklearn-1.0-ubuntu20.04-py38-cpu`)
```
scikit-learn >= 1.0
pandas >= 1.3
numpy >= 1.21
joblib >= 1.1
mlflow (natif Azure ML)
```
