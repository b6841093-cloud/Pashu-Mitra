"""Conservative call-to-structured-report extraction.

Only structured survey values and explicit transcript phrases are returned.
The extractor never supplies a diagnosis and uses ``None`` for absent facts.
"""
from __future__ import annotations

import re

SUMMARY_FIELDS = (
    "animal",
    "species",
    "breed",
    "age",
    "sex",
    "symptoms",
    "duration",
    "severity",
    "affected_count",
    "treatment",
    "medication",
    "vaccination",
    "farmer_observations",
    "veterinarian_observations",
    "veterinarian_advice",
    "follow_up",
    "urgency",
)

_SPECIES = {
    "cattle": "Cattle",
    "cow": "Cattle",
    "buffalo": "Buffalo",
    "goat": "Goat",
    "sheep": "Sheep",
}
_SEVERITY = {"critical": "Critical", "severe": "High", "high": "High", "medium": "Medium", "mild": "Low", "low": "Low"}


def _first_explicit(mapping: dict[str, str], text: str) -> str | None:
    lowered = text.lower()
    for marker, value in mapping.items():
        if re.search(rf"\b{re.escape(marker)}\b", lowered):
            return value
    return None


def summarize_call(survey: dict | None, transcript: str | None) -> dict:
    survey = survey or {}
    transcript = (transcript or "").strip()
    summary = {field: None for field in SUMMARY_FIELDS}

    direct_mapping = {
        "animal": "animal_name",
        "species": "species",
        "breed": "breed",
        "age": "age",
        "sex": "sex",
        "symptoms": "symptoms",
        "duration": "duration",
        "severity": "severity",
        "affected_count": "affected_count",
        "treatment": "previous_treatment",
        "medication": "medicines_used",
        "vaccination": "vaccination_status",
        "farmer_observations": "farmer_observations",
        "veterinarian_observations": "veterinarian_observations",
        "veterinarian_advice": "veterinarian_advice",
        "follow_up": "follow_up",
        "urgency": "urgency",
    }
    for target, source in direct_mapping.items():
        value = survey.get(source)
        if value not in (None, "", []):
            summary[target] = value

    # Limited explicit extraction supplements, but never replaces, survey facts.
    if transcript:
        summary["farmer_observations"] = summary["farmer_observations"] or transcript
        summary["species"] = summary["species"] or _first_explicit(_SPECIES, transcript)
        summary["severity"] = summary["severity"] or _first_explicit(_SEVERITY, transcript)
        duration = re.search(r"\b(?:for|since)\s+(\d+\s+(?:hour|hours|day|days|week|weeks))\b", transcript, re.I)
        if duration and not summary["duration"]:
            summary["duration"] = duration.group(1)

    if not summary["urgency"] and summary["severity"]:
        severity = str(summary["severity"]).lower()
        summary["urgency"] = "URGENT" if severity in {"high", "critical", "severe"} else "ROUTINE"

    return {
        **summary,
        "diagnosis": None,
        "extraction_method": "structured-survey-and-conservative-rules",
        "disclaimer": "AI-assisted extraction only; veterinary confirmation is required. No diagnosis was generated.",
    }
