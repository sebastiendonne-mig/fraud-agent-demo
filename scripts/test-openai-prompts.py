"""
Test des prompts OpenAI (analyse rapport de police + identification tiers)
sur les rapports de police fictifs du jeu de données mock.

Utilise le SDK Anthropic en local pour valider les prompts avant déploiement Azure OpenAI.
"""

import json
import os
import re
import anthropic

# ---------------------------------------------------------------------------
# Chargement des données
# ---------------------------------------------------------------------------

RAPPORTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data-mock", "rapports_police_mock.txt")
SINISTRES_PATH = os.path.join(os.path.dirname(__file__), "..", "data-mock", "sinistres_mock.json")

# Correspondance rapport → sinistre (établie lors de la génération des données mock)
RAPPORT_TO_SINISTRE = {
    "RAPPORT-0009": "SIN-2024-0035",
    "RAPPORT-0010": "SIN-2024-0034",
    "RAPPORT-0011": "SIN-2024-0024",
    "RAPPORT-0012": "SIN-2024-0007",
    "RAPPORT-0013": "SIN-2024-0017",
}


def charger_rapports(path: str) -> dict[str, str]:
    """Parse le fichier TXT et retourne un dict {reference: texte_rapport}."""
    with open(path, encoding="utf-8") as f:
        contenu = f.read()

    rapports = {}
    blocs = contenu.split("=" * 72)
    for bloc in blocs:
        bloc = bloc.strip()
        if not bloc:
            continue
        # Extraire la référence
        match = re.search(r"Référence rapport\s*:\s*(RAPPORT-\d+)", bloc)
        if match:
            ref = match.group(1)
            rapports[ref] = bloc
    return rapports


def charger_sinistres(path: str) -> dict[str, dict]:
    """Charge les sinistres et retourne un dict {id_sinistre: sinistre}."""
    with open(path, encoding="utf-8") as f:
        sinistres_list = json.load(f)
    return {s["id_sinistre"]: s for s in sinistres_list}


# ---------------------------------------------------------------------------
# Prompts système
# ---------------------------------------------------------------------------

PROMPT_ANALYSE_RAPPORT = """Tu es un assistant juridique spécialisé en droit des assurances français, expert en analyse de procès-verbaux de police et en évaluation de la responsabilité civile.

Analyse le rapport de police fourni et identifie :
1. La ou les parties responsables de l'accident (nom, immatriculation si disponible)
2. La part de responsabilité estimée pour chaque partie (en %, total = 100 %)
3. Les éléments factuels clés à retenir pour un recours en subrogation (faits précis tirés du texte)
4. Le niveau de certitude de ton analyse : Faible / Moyen / Élevé

Règles absolues :
- Réponds UNIQUEMENT en JSON structuré, sans aucun texte avant ou après le bloc JSON
- Ne jamais inventer ou extrapoler des faits non présents dans le texte
- Si une information est absente du rapport, utilise null dans le JSON
- Ne jamais formuler d'opinion juridique définitive — tu fournis une analyse factuelle d'aide à la décision

Format de sortie JSON attendu :
{
  "reference_rapport": "string | null",
  "date_accident": "YYYY-MM-DD | null",
  "lieu_accident": "string | null",
  "parties_responsables": [
    {
      "nom": "string | null",
      "immatriculation": "string | null",
      "part_responsabilite_pct": number,
      "motif_responsabilite": "string"
    }
  ],
  "partie_non_responsable": {
    "nom": "string | null",
    "immatriculation": "string | null",
    "role": "assuré victime"
  },
  "elements_cles_recours": ["string"],
  "blesses": {
    "present": boolean,
    "description": "string | null"
  },
  "temoins": {
    "present": boolean,
    "nombre": "number | null",
    "confirment_version_assure": "boolean | null"
  },
  "recours_possible": boolean,
  "niveau_certitude": "Faible | Moyen | Élevé",
  "notes_analyste": "string | null"
}"""

PROMPT_IDENTIFICATION_TIERS = """Tu es un expert en recours et subrogation dans le secteur des assurances IARD français.

À partir de l'analyse structurée d'un rapport de police et des données du dossier sinistre, détermine :
1. L'identité et les coordonnées disponibles du tiers responsable
2. Si un recours en subrogation est juridiquement viable
3. Le fondement juridique applicable (subrogation légale art. L121-12 C.ass., recours amiable, recours judiciaire)
4. Le montant estimé récupérable (basé sur la part de responsabilité et le montant réclamé)
5. Les actions prioritaires à déclencher dans les 30 jours

Règles absolues :
- Réponds UNIQUEMENT en JSON structuré, sans aucun texte avant ou après le bloc JSON
- Ne jamais inventer de coordonnées ou d'informations non présentes dans les données fournies
- Si une information est insuffisante pour conclure, indique recours_viable: false avec un motif clair
- Les montants sont toujours en euros (€), arrondis à l'entier

La subrogation légale (art. L121-12 C.ass.) est applicable si :
1. Responsabilité du tiers établie (part_responsabilite_pct > 0)
2. Tiers identifiable
3. Montant récupérable > 500 €
Calcul : montant_estimé_récuperable = montant_reclame × (part_responsabilite_tiers_pct / 100)
Convention IRSA applicable pour accidents automobiles entre véhicules assurés.

Format de sortie JSON attendu :
{
  "id_sinistre": "string",
  "reference_rapport": "string | null",
  "tiers_identifie": {
    "nom": "string | null",
    "immatriculation": "string | null",
    "assurance_tiers_connue": "string | null",
    "coordonnees_disponibles": boolean
  },
  "recours_viable": boolean,
  "motif_non_viabilite": "string | null",
  "fondement_juridique": {
    "type": "subrogation_legale | recours_amiable | recours_judiciaire | none",
    "reference_legale": "string | null",
    "commentaire": "string | null"
  },
  "montant_reclame_assure": number,
  "part_responsabilite_tiers_pct": number,
  "montant_estimé_récuperable": number,
  "franchise_deductible": "number | null",
  "priorite_recours": "Urgente | Normale | Faible",
  "actions_prioritaires": [
    {
      "delai_jours": number,
      "action": "string",
      "responsable": "agent_recours | juridique | SIU"
    }
  ],
  "niveau_certitude_global": "Faible | Moyen | Élevé",
  "observations": "string | null"
}"""


# ---------------------------------------------------------------------------
# Appels API
# ---------------------------------------------------------------------------

def analyser_rapport(client: anthropic.Anthropic, rapport_texte: str) -> dict:
    """Appelle le modèle pour analyser un rapport de police."""
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1200,
        thinking={"type": "adaptive"},
        messages=[
            {
                "role": "user",
                "content": f"Analyse ce rapport de police :\n\n{rapport_texte}",
            }
        ],
        system=PROMPT_ANALYSE_RAPPORT,
    )
    # Extraire le texte de la réponse (le bloc thinking est ignoré)
    texte = next(b.text for b in response.content if b.type == "text")
    return json.loads(texte)


def identifier_tiers(client: anthropic.Anthropic, analyse_rapport: dict, sinistre: dict) -> dict:
    """Appelle le modèle pour évaluer la viabilité du recours."""
    user_msg = (
        "Voici l'analyse du rapport de police et les données du sinistre. "
        "Évalue la viabilité du recours.\n\n"
        f"Analyse rapport de police :\n{json.dumps(analyse_rapport, ensure_ascii=False, indent=2)}\n\n"
        f"Données sinistre Dataverse :\n{json.dumps(sinistre, ensure_ascii=False, indent=2)}"
    )
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1400,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": user_msg}],
        system=PROMPT_IDENTIFICATION_TIERS,
    )
    texte = next(b.text for b in response.content if b.type == "text")
    return json.loads(texte)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Le SDK lit ANTHROPIC_API_KEY depuis l'environnement ou ~/.config/anthropic
    client = anthropic.Anthropic()

    rapports = charger_rapports(RAPPORTS_PATH)
    sinistres = charger_sinistres(SINISTRES_PATH)

    resultats = []

    print(f"\n{'=' * 60}")
    print("TEST DES PROMPTS OPENAI — Analyse rapports de police")
    print(f"{'=' * 60}\n")

    for ref_rapport, texte_rapport in sorted(rapports.items()):
        id_sinistre = RAPPORT_TO_SINISTRE.get(ref_rapport)
        sinistre = sinistres.get(id_sinistre, {})

        print(f"[1/2] Analyse rapport : {ref_rapport} → {id_sinistre}")
        analyse = analyser_rapport(client, texte_rapport)

        print(f"      Responsable identifié : {analyse.get('parties_responsables', [{}])[0].get('nom')} "
              f"({analyse.get('parties_responsables', [{}])[0].get('part_responsabilite_pct')}%)")
        print(f"      Certitude : {analyse.get('niveau_certitude')} | Recours possible : {analyse.get('recours_possible')}")

        print(f"[2/2] Identification tiers & recours : {ref_rapport}")
        recours = identifier_tiers(client, analyse, sinistre)

        print(f"      Recours viable : {recours.get('recours_viable')} | "
              f"Montant récupérable : {recours.get('montant_estimé_récuperable')} € | "
              f"Priorité : {recours.get('priorite_recours')}")
        print()

        resultats.append({
            "rapport": ref_rapport,
            "sinistre": id_sinistre,
            "analyse_rapport": analyse,
            "identification_tiers": recours,
        })

    # Sauvegarde
    output_path = os.path.join(os.path.dirname(__file__), "..", "data-mock", "test_prompts_output.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(resultats, f, ensure_ascii=False, indent=2)

    print(f"{'=' * 60}")
    print(f"Résultats sauvegardés dans : data-mock/test_prompts_output.json")

    # Résumé
    viables = sum(1 for r in resultats if r["identification_tiers"].get("recours_viable"))
    total_recuperable = sum(
        r["identification_tiers"].get("montant_estimé_récuperable", 0)
        for r in resultats
        if r["identification_tiers"].get("recours_viable")
    )
    print(f"\nRésumé : {viables}/{len(resultats)} dossiers avec recours viable")
    print(f"Montant total récupérable estimé : {total_recuperable:,.0f} €")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
