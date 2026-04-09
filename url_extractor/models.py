from __future__ import annotations

from pydantic import BaseModel, Field, ConfigDict


class CompanyExtractionResult(BaseModel):
    """Structured extraction output for a single input URL."""

    model_config = ConfigDict(extra="forbid")

    url: str
    company_name: str | None = None
    website: str | None = None
    linkedin_url: str | None = None
    confidence_score: float = Field(ge=0.0, le=1.0)

