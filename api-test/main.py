"""
API FastAPI minimale — scoring de leads (démo).
"""

from enum import Enum

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(
    title="Lead Scoring API",
    description="API de démonstration pour scorer des leads commerciaux",
    version="0.1.0",
)


class LeadTier(str, Enum):
    cold = "cold"
    warm = "warm"
    hot = "hot"


class LeadInput(BaseModel):
    company: str = Field(..., min_length=1, description="Nom de l'entreprise")
    email: str = Field(..., description="Email du contact")
    budget_eur: float = Field(..., ge=0, description="Budget estimé en euros")
    employees: int = Field(default=0, ge=0, description="Effectif de l'entreprise")
    has_demo_request: bool = Field(default=False, description="Demande de démo")


class LeadScoreResponse(BaseModel):
    score: int = Field(..., ge=0, le=100)
    tier: LeadTier
    reasons: list[str]


def compute_lead_score(lead: LeadInput) -> tuple[int, LeadTier, list[str]]:
    """Score heuristique simple pour la démo (pas de ML)."""
    score = 0
    reasons: list[str] = []

    if lead.budget_eur >= 50_000:
        score += 35
        reasons.append("Budget élevé (≥ 50 k€)")
    elif lead.budget_eur >= 10_000:
        score += 20
        reasons.append("Budget modéré (≥ 10 k€)")
    else:
        score += 5
        reasons.append("Budget faible")

    if lead.employees >= 100:
        score += 25
        reasons.append("Entreprise de taille significative")
    elif lead.employees >= 20:
        score += 15
        reasons.append("PME établie")
    elif lead.employees > 0:
        score += 5

    if lead.has_demo_request:
        score += 30
        reasons.append("Demande de démo")

    if lead.email.endswith((".fr", ".com")) and "@" in lead.email:
        score += 10
        reasons.append("Email professionnel valide")

    score = min(score, 100)

    if score >= 70:
        tier = LeadTier.hot
    elif score >= 40:
        tier = LeadTier.warm
    else:
        tier = LeadTier.cold

    return score, tier, reasons


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/leads/score", response_model=LeadScoreResponse)
def score_lead(lead: LeadInput) -> LeadScoreResponse:
    """Calcule un score 0–100 et un tier (cold / warm / hot) pour un lead."""
    score, tier, reasons = compute_lead_score(lead)
    return LeadScoreResponse(score=score, tier=tier, reasons=reasons)
