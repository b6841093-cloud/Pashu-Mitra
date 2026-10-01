"""
Unified Disease Knowledge Base for PashuMitra.

Loads diseases.json once and exposes a normalised, searchable interface used
by the Clinical Decision Support engine (animal_ai.py) and by the advisory
generator.

Design rationale
================
Previously the CDS engine maintained its own hardcoded ``DISEASE_SIGNATURES``
list independent of diseases.json.  Adding a new disease to diseases.json did
*not* make it detectable by AI triage.  This module unifies both sources so
that:

1. ``diseases.json`` remains the single source of truth for disease metadata.
2. The CDS engine reads keyword indices from ``DiseaseKnowledge``.
3. Future diseases added to diseases.json are automatically available to AI
   detection without editing animal_ai.py.

The module is intentionally pure-Python with no external dependencies so it
can be imported safely from any layer.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional

_DISEASES_PATH = os.path.join(os.path.dirname(__file__), "diseases.json")


@dataclass
class DiseaseEntry:
    """Normalised representation of a single disease from diseases.json."""
    id: str
    name_en: str
    name_mr: str
    aliases: List[str]
    category: str
    risk_level: str
    zoonotic: bool
    vaccine_preventable: bool
    vaccine_key: Optional[str]
    species: List[str]
    symptoms_en: List[str]
    symptoms_mr: List[str]
    prevention_en: List[str]
    description_en: str
    description_mr: str
    # Derived
    keyword_set: set = field(default_factory=set, repr=False)


# Mapping from disease name / id patterns to vaccine key used by the CDS
# vaccination gap checker.
_VACCINE_KEY_MAP: Dict[str, str] = {
    "fmd": "FMD",
    "foot-and-mouth": "FMD",
    "hs": "HS",
    "haemorrhagic": "HS",
    "hemorrhagic": "HS",
    "bq": "BQ",
    "black quarter": "BQ",
    "blackleg": "BQ",
    "brucellosis": "Brucellosis",
    "lsd": "LSD",
    "lumpy skin": "LSD",
    "ppr": "PPR",
    "peste des petits": "PPR",
}


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", text.lower()).strip()


def _derive_vaccine_key(entry: DiseaseEntry) -> Optional[str]:
    """Try to derive a vaccine key from the disease name / aliases."""
    searchable = " ".join([entry.name_en] + entry.aliases).lower()
    for pattern, key in _VACCINE_KEY_MAP.items():
        if pattern in searchable:
            return key
    return None


def _derive_priority(risk: str) -> str:
    r = risk.lower().strip()
    if r in ("critical", "high"):
        return "CRITICAL" if r == "critical" else "HIGH"
    if r in ("medium", "moderate"):
        return "MEDIUM"
    return "LOW"


class DiseaseKnowledge:
    """
    Singleton-style knowledge base.

    Usage::

        dk = DiseaseKnowledge.load()
        for sig in dk.cds_signatures():
            ...

    The ``load()`` classmethod caches the instance so the JSON file is read
    only once per process.
    """

    _instance: Optional["DiseaseKnowledge"] = None

    def __init__(self, diseases: List[DiseaseEntry]):
        self._diseases = diseases
        self._by_id: Dict[str, DiseaseEntry] = {d.id: d for d in diseases}
        self._by_name_lower: Dict[str, DiseaseEntry] = {}
        for d in diseases:
            self._by_name_lower[d.name_en.lower()] = d
            for alias in d.aliases:
                self._by_name_lower[alias.lower()] = d

    # ----------------------------------------------------------
    # Loading
    # ----------------------------------------------------------

    @classmethod
    def load(cls, path: str | None = None) -> "DiseaseKnowledge":
        if cls._instance is not None and path is None:
            return cls._instance
        path = path or _DISEASES_PATH
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            raw = []
        entries: List[DiseaseEntry] = []
        for item in raw:
            symptoms_en = item.get("symptoms_en", [])
            symptoms_mr = item.get("symptoms_mr", [])
            aliases = item.get("aliases", [])
            # Build keyword set from English symptoms, name, aliases, category
            keywords: set = set()
            for s in symptoms_en:
                for word in _normalise(s).split():
                    if len(word) >= 3:
                        keywords.add(word)
            for a in aliases:
                for word in _normalise(a).split():
                    if len(word) >= 3:
                        keywords.add(word)
            for word in _normalise(item.get("name_en", "")).split():
                if len(word) >= 3:
                    keywords.add(word)
            entry = DiseaseEntry(
                id=item.get("id", ""),
                name_en=item.get("name_en", ""),
                name_mr=item.get("name_mr", ""),
                aliases=aliases,
                category=item.get("category", ""),
                risk_level=item.get("riskLevel", "Medium"),
                zoonotic=bool(item.get("zoonotic", False)),
                vaccine_preventable=bool(item.get("vaccinePreventable", False)),
                vaccine_key=_derive_vaccine_key(
                    DiseaseEntry(id="", name_en=item.get("name_en", ""),
                                 name_mr="", aliases=aliases, category="",
                                 risk_level="", zoonotic=False,
                                 vaccine_preventable=False, vaccine_key=None,
                                 species=[], symptoms_en=[], symptoms_mr=[],
                                 prevention_en=[], description_en="",
                                 description_mr="")
                ),
                species=[s.title() for s in item.get("affectedSpecies", [])],
                symptoms_en=symptoms_en,
                symptoms_mr=symptoms_mr,
                prevention_en=item.get("prevention_en", item.get("prevention", [])),
                description_en=item.get("description_en", item.get("description", "")),
                description_mr=item.get("description_mr", ""),
            )
            entry.keyword_set = keywords
            entries.append(entry)
        inst = cls(entries)
        if path is None:
            cls._instance = inst
        return inst

    @classmethod
    def reload(cls) -> "DiseaseKnowledge":
        """Force reload from disk."""
        cls._instance = None
        return cls.load()

    # ----------------------------------------------------------
    # Queries
    # ----------------------------------------------------------

    @property
    def diseases(self) -> List[DiseaseEntry]:
        return list(self._diseases)

    def zoonotic_diseases(self) -> List[DiseaseEntry]:
        return [d for d in self._diseases if d.zoonotic]

    def lookup(self, name_or_alias: str) -> Optional[DiseaseEntry]:
        return self._by_name_lower.get(name_or_alias.lower().strip())

    # ----------------------------------------------------------
    # CDS-compatible signatures
    # ----------------------------------------------------------

    def cds_signatures(self) -> List[dict]:
        """
        Return a list of signature dicts compatible with the format expected
        by ``animal_ai.evaluate_animal_cds()``.

        Each dict has keys: disease, keywords, weight, category, priority,
        vaccine_key, diagnostic_steps, follow_up.
        """
        # Disease-specific diagnostic / follow-up recommendations are
        # embedded here for diseases that have enough structure in
        # diseases.json to derive them.  For diseases without explicit
        # recommendations we provide sensible generic guidance.
        _HARDCODED_GUIDANCE: Dict[str, dict] = {
            "Foot-and-Mouth Disease (FMD)": {
                "keywords_override": [
                    "blister", "vesicle", "mouth", "ulcer", "drooling", "salivat",
                    "lame", "hoof", "smack", "tongue",
                ],
                "weight": 25,
                "category": "Infectious Vesicular Disease (Suspected FMD)",
                "priority": "CRITICAL",
                "diagnostic_steps": [
                    "Collect vesicular fluid or unruptured vesicle epithelial tissue into transport medium (pH 7.4)",
                    "Submit sample for FMD Antigen-ELISA or RT-PCR testing",
                    "Immediate biosecurity barrier: quarantine premise and stop animal movement",
                    "Disinfect footwear and equipment with 4% sodium carbonate or 2% citric acid",
                ],
                "follow_up": [
                    "Daily inspection of interdigital spaces and oral mucosa",
                    "Check herd FMD vaccination records for non-immunized calves/heifers",
                    "Soft feeding with gruel/electrolytes to maintain metabolic intake",
                ],
            },
            "Haemorrhagic Septicaemia (HS)": {
                "keywords_override": [
                    "fever", "eating", "lethargic", "salivation", "throat",
                    "swelling", "submandibular", "dyspnea", "respiratory", "grunting",
                ],
                "weight": 25,
                "category": "Acute Bacterial Septicemia (Suspected HS)",
                "priority": "HIGH",
                "diagnostic_steps": [
                    "Collect jugular blood sample in EDTA & sterile clot activator prior to antimicrobial therapy",
                    "Perform peripheral blood smear for bipolar-staining Pasteurella multocida (Leishman/Giemsa)",
                    "Measure rectal temperature twice daily across all in-contact herd members",
                    "Isolate affected animal in a dry, sheltered isolation pen",
                ],
                "follow_up": [
                    "Re-assess respiratory effort and swelling every 6 hours",
                    "Screen surrounding herd animals for early febrile spike (>103°F)",
                    "Notify local veterinary dispensary if additional cases present within 48 hours",
                ],
            },
            "Black Quarter (BQ)": {
                "keywords_override": [
                    "crepit", "crackl", "swelling", "shoulder", "thigh",
                    "lame", "gluteal", "gangren", "dark muscle",
                ],
                "weight": 25,
                "category": "Clostridial Myonecrosis (Suspected BQ)",
                "priority": "CRITICAL",
                "diagnostic_steps": [
                    "Aspiration of crepitant swelling exudate for Gram stain (Gram-positive spore-forming rods)",
                    "Avoid incision of lesion to prevent environmental sporulation of Clostridium chauvoei",
                    "Immediate emergency parenteral penicillin/oxytetracycline therapy as directed by vet",
                ],
                "follow_up": [
                    "Urgent ring-vaccination of young stock (6 months to 2 years) in herd",
                    "Deep burial of any carcass with quicklime without opening body",
                ],
            },
            "Brucellosis": {
                "keywords_override": [
                    "abort", "miscarriage", "retained placenta", "hygroma",
                    "orchitis", "infertility", "stillborn",
                ],
                "weight": 20,
                "category": "Reproductive / Zoonotic Infection (Suspected Brucellosis)",
                "priority": "HIGH",
                "diagnostic_steps": [
                    "Submit maternal serum for Rose Bengal Plate Test (RBPT) and Standard Tube Agglutination Test (STAT)",
                    "Submit milk sample for Brucella Milk Ring Test (MRT)",
                    "Wear PPE (gloves, mask, protective eyewear) when handling aborted material — HIGH ZOONOTIC RISK",
                ],
                "follow_up": [
                    "Segregate animal until vaginal discharge ceases completely",
                    "Screen all adult female livestock in herd through serology",
                    "Ensure farm workers and family members avoid consuming unpasteurized milk",
                ],
            },
            "Lumpy Skin Disease (LSD)": {
                "keywords_override": [
                    "nodule", "lump", "skin", "edema", "lymph node", "pox", "scab",
                ],
                "weight": 20,
                "category": "Capripoxvirus Dermatopathy (Suspected LSD)",
                "priority": "HIGH",
                "diagnostic_steps": [
                    "Collect skin lesion biopsy / scab or EDTA blood for Capripoxvirus PCR",
                    "Apply vector control (deltamethrin/cypermethrin pour-on) to reduce biting fly/tick transmission",
                    "Isolate cattle with skin lesions under fine-mesh fly-proof netting",
                ],
                "follow_up": [
                    "Apply antiseptic ointment / fly repellent to open burst nodules",
                    "Monitor secondary bacterial infection and administer supportive vitamins",
                    "Verify goat pox / live attenuated heterologous vaccine status in herd",
                ],
            },
            "Bovine Mastitis": {
                "keywords_override": [
                    "udder", "quarter", "clot", "milk", "teat", "mastitis",
                    "watery milk", "bloody milk",
                ],
                "weight": 20,
                "category": "Intramammary Infection (Suspected Mastitis)",
                "priority": "MEDIUM",
                "diagnostic_steps": [
                    "Perform California Mastitis Test (CMT) strip cup examination on all four quarters",
                    "Aseptically collect quarter milk sample for bacterial culture and antimicrobial sensitivity test (ABST)",
                    "Check for systemic fever and udder hardness/heat",
                ],
                "follow_up": [
                    "Post-milking teat dipping with 0.5% povidone-iodine",
                    "Milk affected quarters last and discard abnormal secretions safely",
                    "Review milking hygiene, teat liner condition, and bedding cleanliness",
                ],
            },
        }

        signatures: List[dict] = []
        for d in self._diseases:
            guidance = _HARDCODED_GUIDANCE.get(d.name_en)
            if guidance:
                sig = {
                    "disease": d.name_en,
                    "keywords": guidance["keywords_override"],
                    "weight": guidance["weight"],
                    "category": guidance["category"],
                    "priority": guidance["priority"],
                    "vaccine_key": d.vaccine_key,
                    "diagnostic_steps": guidance["diagnostic_steps"],
                    "follow_up": guidance["follow_up"],
                }
            else:
                # Auto-generate from diseases.json symptom keywords
                if not d.keyword_set:
                    continue
                sig = {
                    "disease": d.name_en,
                    "keywords": sorted(d.keyword_set),
                    "weight": 15,
                    "category": f"Suspected {d.name_en}",
                    "priority": _derive_priority(d.risk_level),
                    "vaccine_key": d.vaccine_key,
                    "diagnostic_steps": [
                        f"Collect appropriate diagnostic sample for {d.name_en}",
                        "Consult a veterinarian for confirmatory testing",
                    ],
                    "follow_up": [
                        "Monitor animal closely for 48-72 hours",
                        "Isolate if infectious disease is suspected",
                    ],
                }
            signatures.append(sig)
        return signatures