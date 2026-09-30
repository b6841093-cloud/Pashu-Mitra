"""Application-level IVR orchestration for Pashu-Shield.

The module owns business state only. SIP, RTP, DTMF and audio remain the PBX's
responsibility and are represented by provider-independent voice instructions.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from difflib import SequenceMatcher

from case_service import create_case_record
from database import audit_log, next_code
from helpline_summary import summarize_call
from ivr_config import LANGUAGE_NAMES, SUPPORTED_LANGUAGES, get_ivr_settings, local_number, normalize_indian_number
from telephony import VoiceInstruction, get_telephony_adapter

TERMINAL_CALL_STATUSES = {"COMPLETED", "PARTIAL", "ABANDONED", "FAILED"}
LOCATION_SOURCES = {
    "PROFILE", "PROFILE_LOCATION", "FARMER_PROVIDED", "GPS", "NETWORK",
    "DISTRICT_LEVEL", "UNKNOWN",
}
LANGUAGE_DIGITS = {"1": "en", "2": "te", "3": "hi", "4": "mr"}

PROMPTS = {
    "en": {
        "welcome": "Welcome to Pashu-Shield.",
        "language": "For English press 1. Telugu press 2. Hindi press 3. Marathi press 4.",
        "region": "Please say your district and village after the tone.",
        "menu": "Press 1 to connect to a veterinarian. Press 2 to report an animal health problem.",
        "no_vet": "No suitable veterinarian is available now. Your report will not be lost. Please answer a short survey.",
        "complete": "Thank you. Your animal health report has been saved for veterinary review.",
    },
    "te": {
        "welcome": "పశు-షీల్డ్‌కు స్వాగతం.",
        "language": "ఇంగ్లీష్ కోసం 1, తెలుగు కోసం 2, హిందీ కోసం 3, మరాఠీ కోసం 4 నొక్కండి.",
        "region": "టోన్ తర్వాత మీ జిల్లా మరియు గ్రామం పేరు చెప్పండి.",
        "menu": "పశువైద్యునితో మాట్లాడటానికి 1 నొక్కండి. పశు ఆరోగ్య సమస్యను నివేదించడానికి 2 నొక్కండి.",
        "no_vet": "ప్రస్తుతం సరైన పశువైద్యుడు అందుబాటులో లేరు. మీ నివేదిక పోదు. చిన్న సర్వేకు సమాధానం ఇవ్వండి.",
        "complete": "ధన్యవాదాలు. మీ పశు ఆరోగ్య నివేదిక పశువైద్య సమీక్ష కోసం భద్రపరచబడింది.",
    },
    "hi": {
        "welcome": "पशु-शील्ड में आपका स्वागत है।",
        "language": "अंग्रेज़ी के लिए 1, तेलुगु के लिए 2, हिंदी के लिए 3, मराठी के लिए 4 दबाएँ।",
        "region": "टोन के बाद अपना जिला और गाँव बताएँ।",
        "menu": "पशु चिकित्सक से जुड़ने के लिए 1 दबाएँ। पशु स्वास्थ्य समस्या दर्ज करने के लिए 2 दबाएँ।",
        "no_vet": "अभी उपयुक्त पशु चिकित्सक उपलब्ध नहीं है। आपकी रिपोर्ट सुरक्षित रहेगी। कृपया छोटा सर्वे पूरा करें।",
        "complete": "धन्यवाद। आपकी पशु स्वास्थ्य रिपोर्ट पशु चिकित्सक की समीक्षा के लिए सहेज ली गई है।",
    },
    "mr": {
        "welcome": "पशु-शील्डमध्ये आपले स्वागत आहे.",
        "language": "इंग्रजीसाठी 1, तेलुगूसाठी 2, हिंदीसाठी 3, मराठीसाठी 4 दाबा.",
        "region": "टोननंतर आपला जिल्हा आणि गाव सांगा.",
        "menu": "पशुवैद्यकाशी जोडण्यासाठी 1 दाबा. पशू आरोग्य समस्या नोंदवण्यासाठी 2 दाबा.",
        "no_vet": "सध्या योग्य पशुवैद्यक उपलब्ध नाही. आपला अहवाल हरवणार नाही. कृपया छोटा सर्वे पूर्ण करा.",
        "complete": "धन्यवाद. आपला पशू आरोग्य अहवाल पशुवैद्यकीय पुनरावलोकनासाठी जतन केला आहे.",
    },
}

QUESTION_LABELS = {
    "animal_id": "Which registered animal is affected?",
    "animal_name": "What is the animal's name or tag?",
    "species": "What species is the animal?",
    "breed": "What is the breed, if known?",
    "age": "What is the animal's age, if known?",
    "sex": "What is the animal's sex?",
    "symptoms": "Describe the symptoms you observed.",
    "duration": "How long have the symptoms been present?",
    "severity": "Is the problem low, medium, high, or critical severity?",
    "affected_count": "How many animals are affected?",
    "vaccination_status": "What is the vaccination status, if known?",
    "previous_treatment": "Has any treatment already been given?",
    "medicines_used": "Which medicines were used, if any?",
    "farmer_observations": "Share any other observations about the animal.",
    "additional_information": "Is there any additional information?",
}

QUESTION_TRANSLATIONS = {
    "te": {
        "animal_id": "ప్రభావితమైన నమోదు చేసిన పశువును ఎంచుకోండి.",
        "animal_name": "పశువు పేరు లేదా ట్యాగ్ ఏమిటి?", "species": "పశువు జాతి ఏమిటి?",
        "breed": "తెలిస్తే పశువు రకం చెప్పండి.", "age": "తెలిస్తే పశువు వయస్సు చెప్పండి.",
        "sex": "పశువు లింగం ఏమిటి?", "symptoms": "మీరు గమనించిన లక్షణాలను వివరించండి.",
        "duration": "ఈ లక్షణాలు ఎంతకాలంగా ఉన్నాయి?", "severity": "సమస్య తీవ్రత తక్కువ, మధ్యస్థ, ఎక్కువ లేదా అత్యవసరమా?",
        "affected_count": "ఎన్ని పశువులు ప్రభావితమయ్యాయి?", "vaccination_status": "తెలిస్తే టీకా స్థితిని చెప్పండి.",
        "previous_treatment": "ఇప్పటికే ఏదైనా చికిత్స ఇచ్చారా?", "medicines_used": "ఏ మందులు వాడారు?",
        "farmer_observations": "పశువు గురించి ఇతర గమనికలు చెప్పండి.", "additional_information": "ఇంకా ఏదైనా సమాచారం ఉందా?",
    },
    "hi": {
        "animal_id": "प्रभावित पंजीकृत पशु चुनें।", "animal_name": "पशु का नाम या टैग क्या है?",
        "species": "पशु की प्रजाति क्या है?", "breed": "यदि पता हो तो नस्ल बताएँ।",
        "age": "यदि पता हो तो पशु की आयु बताएँ।", "sex": "पशु का लिंग क्या है?",
        "symptoms": "देखे गए लक्षण बताएँ।", "duration": "लक्षण कितने समय से हैं?",
        "severity": "समस्या की गंभीरता कम, मध्यम, अधिक या अत्यंत गंभीर है?",
        "affected_count": "कितने पशु प्रभावित हैं?", "vaccination_status": "यदि पता हो तो टीकाकरण स्थिति बताएँ।",
        "previous_treatment": "क्या पहले कोई उपचार दिया गया है?", "medicines_used": "कौन सी दवाएँ दी गईं?",
        "farmer_observations": "पशु के बारे में अन्य जानकारी बताएँ।", "additional_information": "क्या कोई अतिरिक्त जानकारी है?",
    },
    "mr": {
        "animal_id": "बाधित नोंदणीकृत पशू निवडा.", "animal_name": "पशूचे नाव किंवा टॅग काय आहे?",
        "species": "पशूची प्रजाती कोणती आहे?", "breed": "माहित असल्यास जात सांगा.",
        "age": "माहित असल्यास पशूचे वय सांगा.", "sex": "पशूचे लिंग काय आहे?",
        "symptoms": "आपण पाहिलेली लक्षणे सांगा.", "duration": "ही लक्षणे किती काळापासून आहेत?",
        "severity": "समस्येची तीव्रता कमी, मध्यम, जास्त किंवा गंभीर आहे?",
        "affected_count": "किती पशू बाधित आहेत?", "vaccination_status": "माहित असल्यास लसीकरण स्थिती सांगा.",
        "previous_treatment": "आधी काही उपचार दिले आहेत का?", "medicines_used": "कोणती औषधे वापरली?",
        "farmer_observations": "पशूबद्दल इतर निरीक्षणे सांगा.", "additional_information": "आणखी काही माहिती आहे का?",
    },
}

SURVEY_ORDER = tuple(QUESTION_LABELS)

NEARBY_DISTRICTS = {
    "pune": {"satara", "ahmednagar", "solapur", "raigad", "thane"},
    "nashik": {"ahmednagar", "thane", "dhule", "jalgaon"},
    "satara": {"pune", "sangli", "solapur", "kolhapur"},
    "nagpur": {"wardha", "bhandara", "chandrapur", "amravati"},
}


def _loads(value, default):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return default


def _event(conn, call_id: str, event_type: str, data: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO ivr_call_events (call_id, event_type, event_data) VALUES (?,?,?)",
        (call_id, event_type, json.dumps(data or {}, ensure_ascii=False)),
    )


def _call_dict(row) -> dict:
    result = dict(row)
    result["survey_data"] = _loads(result.get("survey_data"), {})
    result["summary"] = _loads(result.pop("summary_json", None), None)
    return result


def _language(call) -> str:
    code = call["language"] if call and call["language"] in SUPPORTED_LANGUAGES else "en"
    return code


def _prompt(call, key: str) -> str:
    return PROMPTS[_language(call)][key]


def _question_prompt(call, field: str | None) -> str:
    language = _language(call)
    return QUESTION_TRANSLATIONS.get(language, {}).get(
        field, QUESTION_LABELS.get(field, "Please provide the requested information.")
    )


def _find_farmer_by_phone(conn, caller_number: str | None):
    normalized = normalize_indian_number(caller_number)
    if not normalized:
        return None
    local = normalized[-10:]
    rows = conn.execute("SELECT * FROM users WHERE role='owner'").fetchall()
    for row in rows:
        if local_number(row["mobile"]) == local:
            return row
    return None


def _profile_location(conn, farmer) -> dict:
    """Apply the required region precedence without deriving coordinates."""
    if not farmer:
        return {}
    if farmer["district"] or farmer["village"] or farmer["block"]:
        return {
            "region_state": farmer["state"],
            "district": farmer["district"],
            "block": farmer["block"],
            "village": farmer["village"],
            "location_source": "PROFILE_LOCATION",
        }

    herd = conn.execute(
        "SELECT state, district, block, village FROM herds WHERE owner_id=? "
        "AND (district IS NOT NULL OR village IS NOT NULL) ORDER BY id DESC LIMIT 1",
        (farmer["id"],),
    ).fetchone()
    if herd:
        return {
            "region_state": herd["state"], "district": herd["district"],
            "block": herd["block"], "village": herd["village"],
            "location_source": "PROFILE_LOCATION",
        }

    prior_case = conn.execute(
        """
        SELECT a.state, a.district, a.block, a.village
        FROM cases c JOIN animals a ON a.id=c.animal_id
        WHERE c.owner_id=? AND (a.district IS NOT NULL OR a.village IS NOT NULL)
        ORDER BY c.id DESC LIMIT 1
        """,
        (farmer["id"],),
    ).fetchone()
    if prior_case:
        return {
            "region_state": prior_case["state"], "district": prior_case["district"],
            "block": prior_case["block"], "village": prior_case["village"],
            "location_source": "PROFILE_LOCATION",
        }

    verified = conn.execute(
        """
        SELECT region_state, district, block, village, latitude, longitude, location_source
        FROM helpline_reports WHERE farmer_id=? AND location_source != 'UNKNOWN'
        ORDER BY id DESC LIMIT 1
        """,
        (farmer["id"],),
    ).fetchone()
    return dict(verified) if verified else {}


def _prefill_known_animal_data(conn, farmer_id: int | None) -> tuple[dict, list[dict]]:
    if not farmer_id:
        return {}, []
    animals = conn.execute(
        "SELECT * FROM animals WHERE owner_id=? ORDER BY id DESC", (farmer_id,)
    ).fetchall()
    choices = [
        {"id": a["id"], "animal_code": a["animal_code"], "animal_name": a["animal_name"], "species": a["species"]}
        for a in animals
    ]
    if len(animals) != 1:
        return {}, choices
    animal = animals[0]
    known = {
        "animal_id": animal["id"],
        "animal_name": animal["animal_name"] or animal["animal_code"],
        "species": animal["species"],
        "breed": animal["breed"],
        "age": animal["age"] if animal["age"] is not None else animal["age_years"],
        "sex": animal["sex"] or animal["gender"],
    }
    vaccination = conn.execute(
        "SELECT GROUP_CONCAT(vaccine, ', ') value FROM vaccinations WHERE animal_id=?",
        (animal["id"],),
    ).fetchone()["value"]
    if vaccination:
        known["vaccination_status"] = f"Recorded vaccines: {vaccination}"
    medications = conn.execute(
        "SELECT GROUP_CONCAT(medication_name, ', ') value FROM animal_medications "
        "WHERE animal_id=? AND status='Active'",
        (animal["id"],),
    ).fetchone()["value"]
    if medications:
        known["medicines_used"] = medications
        known["previous_treatment"] = "Active medication is already recorded"
    return {k: v for k, v in known.items() if v not in (None, "")}, choices


def start_inbound_call(conn, payload: dict) -> dict:
    """Create an idempotent inbound call session from trusted provider metadata."""
    settings = get_ivr_settings()
    provider_call_id = (payload.get("provider_call_id") or "").strip() or None
    if provider_call_id:
        existing = conn.execute(
            "SELECT * FROM helpline_calls WHERE provider_call_id=?", (provider_call_id,)
        ).fetchone()
        if existing:
            return call_response(conn, existing)

    caller_number = normalize_indian_number(payload.get("caller_number") or payload.get("mobile"))
    farmer = _find_farmer_by_phone(conn, caller_number)
    language = None
    if farmer and farmer["preferred_language"] in SUPPORTED_LANGUAGES:
        language = farmer["preferred_language"]
    location = _profile_location(conn, farmer)
    known, choices = _prefill_known_animal_data(conn, farmer["id"] if farmer else None)
    if farmer:
        known["farmer_name"] = farmer["full_name"]

    call_id = f"ivr_{uuid.uuid4().hex}"
    status = "IDENTIFIED" if farmer else "INITIATED"
    conn.execute(
        """
        INSERT INTO helpline_calls
        (call_id, provider_call_id, provider_mode, caller_number, farmer_id, language,
         region_state, district, block, village, latitude, longitude, location_source,
         status, survey_data, answered_at, last_activity_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
        """,
        (
            call_id, provider_call_id, settings.provider_mode, caller_number,
            farmer["id"] if farmer else None, language,
            location.get("region_state"), location.get("district"), location.get("block"),
            location.get("village"), location.get("latitude"), location.get("longitude"),
            location.get("location_source", "UNKNOWN"), status,
            json.dumps(known, ensure_ascii=False),
        ),
    )
    _event(conn, call_id, "INBOUND_CALL", {
        "provider_mode": settings.provider_mode,
        "caller_id_available": bool(caller_number),
        "farmer_identified": bool(farmer),
    })
    audit_log(
        conn, "IVR_CALL_INITIATED", "helpline_call", call_id,
        actor_name="Voice Gateway", actor_role="system",
        details={"provider_mode": settings.provider_mode, "farmer_identified": bool(farmer)},
    )
    conn.commit()
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    response = call_response(conn, call)
    response["registered_animals"] = choices
    return response


def _next_stage(call) -> str:
    if not call["language"]:
        return "LANGUAGE_REQUIRED"
    if not call["district"] and not call["village"]:
        return "REGION_REQUIRED"
    if not call["menu_option"]:
        return "MENU_REQUIRED"
    if call["status"] == "SURVEY_STARTED":
        return "SURVEY_QUESTION"
    if call["status"] == "ROUTING":
        return "BRIDGE_PENDING"
    return call["status"]


def _instruction_for_call(call) -> dict:
    settings = get_ivr_settings()
    adapter = get_telephony_adapter(settings.provider_mode)
    stage = _next_stage(call)
    if stage == "LANGUAGE_REQUIRED":
        return adapter.gather(PROMPTS["en"]["welcome"] + " " + PROMPTS["en"]["language"], 1).as_dict()
    if stage == "REGION_REQUIRED":
        return VoiceInstruction(action="COLLECT_REGION", prompt=_prompt(call, "region")).as_dict()
    if stage == "MENU_REQUIRED":
        return adapter.gather(_prompt(call, "welcome") + " " + _prompt(call, "menu"), 1).as_dict()
    if stage == "SURVEY_QUESTION":
        return VoiceInstruction(
            action="COLLECT_SURVEY_ANSWER",
            prompt=_question_prompt(call, call["current_question"]),
            metadata={"field": call["current_question"]},
        ).as_dict()
    return VoiceInstruction(action=stage).as_dict()


def call_response(conn, call) -> dict:
    result = _call_dict(call)
    result["next_stage"] = _next_stage(call)
    result["instruction"] = _instruction_for_call(call)
    result["farmer_identified"] = bool(call["farmer_id"])
    if call["farmer_id"]:
        farmer = conn.execute(
            "SELECT id, full_name, preferred_language, state, district, block, village FROM users WHERE id=?",
            (call["farmer_id"],),
        ).fetchone()
        result["farmer"] = dict(farmer) if farmer else None
    report = conn.execute("SELECT * FROM helpline_reports WHERE call_id=?", (call["call_id"],)).fetchone()
    if report:
        report_data = dict(report)
        report_data["structured_summary"] = _loads(report_data["structured_summary"], {})
        result["report"] = report_data
    return result


def _set_region(conn, call, payload: dict) -> None:
    district = (payload.get("district") or "").strip() or None
    village = (payload.get("village") or "").strip() or None
    block = (payload.get("block") or payload.get("mandal") or payload.get("taluk") or "").strip() or None
    state = (payload.get("state") or "").strip() or None
    source = (payload.get("location_source") or "FARMER_PROVIDED").strip().upper()
    if source not in LOCATION_SOURCES:
        source = "FARMER_PROVIDED"

    lat = payload.get("latitude")
    lng = payload.get("longitude")
    if lat is not None or lng is not None:
        if source not in {"GPS", "NETWORK"}:
            raise ValueError("Coordinates require a legitimate GPS or NETWORK location source")
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            raise ValueError("Invalid coordinates")
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError("Coordinates are outside valid bounds")
    else:
        lat = lng = None
        if source in {"GPS", "NETWORK"}:
            raise ValueError("GPS or NETWORK source requires coordinates")
        if district and not village and source == "FARMER_PROVIDED":
            source = "DISTRICT_LEVEL"

    if not district and not village:
        raise ValueError("District or village is required")
    conn.execute(
        """
        UPDATE helpline_calls SET region_state=?, district=?, block=?, village=?,
        latitude=?, longitude=?, location_source=?, last_activity_at=datetime('now'), updated_at=datetime('now')
        WHERE call_id=?
        """,
        (state, district, block, village, lat, lng, source, call["call_id"]),
    )
    _event(conn, call["call_id"], "REGION_CAPTURED", {"source": source, "district": district, "village": village})


def apply_call_input(conn, call_id: str, payload: dict) -> dict:
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    if call["status"] in TERMINAL_CALL_STATUSES:
        raise ValueError("Call session is already closed")

    if not call["language"]:
        language = (payload.get("language") or LANGUAGE_DIGITS.get(str(payload.get("dtmf", ""))) or "").lower()
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError("Language must be en, te, hi, or mr")
        conn.execute(
            "UPDATE helpline_calls SET language=?, last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (language, call_id),
        )
        _event(conn, call_id, "LANGUAGE_SELECTED", {"language": language})
    elif not call["district"] and not call["village"]:
        _set_region(conn, call, payload)
    elif not call["menu_option"]:
        option = str(payload.get("menu_option") or payload.get("dtmf") or "").strip()
        if option not in {"1", "2"}:
            raise ValueError("Menu option must be 1 or 2")
        conn.execute(
            "UPDATE helpline_calls SET menu_option=?, last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (option, call_id),
        )
        _event(conn, call_id, "MENU_SELECTED", {"option": option})
        conn.commit()
        if option == "1":
            return route_veterinarian(conn, call_id)
        return start_survey(conn, call_id)
    elif call["status"] == "SURVEY_STARTED":
        return record_survey_answer(conn, call_id, payload)
    else:
        raise ValueError("Input is not expected at the current call stage")

    conn.commit()
    updated = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    return call_response(conn, updated)


def _within_work_hours(hour: int, start: int, end: int) -> bool:
    if start == end:
        return True
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def recover_stale_sessions(conn) -> int:
    settings = get_ivr_settings()
    stale = conn.execute(
        """
        SELECT va.*, hc.status call_status
        FROM vet_availability va
        LEFT JOIN helpline_calls hc ON hc.call_id=va.current_call_id
        WHERE va.status='BUSY' AND va.current_call_id IS NOT NULL
          AND COALESCE(hc.last_activity_at, va.busy_since, va.updated_at) < datetime('now', ?)
        """,
        (f"-{settings.stale_minutes} minutes",),
    ).fetchall()
    for row in stale:
        if row["call_status"] and row["call_status"] not in TERMINAL_CALL_STATUSES:
            conn.execute(
                "UPDATE helpline_calls SET status='PARTIAL', fallback_reason='STALE_SESSION_RECOVERY', "
                "ended_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
                (row["current_call_id"],),
            )
            _event(conn, row["current_call_id"], "STALE_SESSION_RECOVERED", {"vet_id": row["vet_id"]})
        conn.execute(
            "UPDATE vet_availability SET status='AVAILABLE', current_call_id=NULL, busy_since=NULL, updated_at=datetime('now') WHERE vet_id=?",
            (row["vet_id"],),
        )
    if stale:
        conn.commit()
    return len(stale)


def _availability_rows(conn) -> list[dict]:
    recover_stale_sessions(conn)
    settings = get_ivr_settings()
    hour = datetime.now().hour
    in_hours = _within_work_hours(hour, settings.work_start_hour, settings.work_end_hour)
    rows = conn.execute(
        """
        SELECT u.id vet_id, u.full_name, u.mobile, u.specialization, u.preferred_language,
               u.state, u.district, u.block, u.village,
               COALESCE(va.status, 'AVAILABLE') configured_status,
               COALESCE(va.supported_languages, '["en"]') supported_languages,
               va.current_call_id, va.busy_since, va.updated_at
        FROM users u LEFT JOIN vet_availability va ON va.vet_id=u.id
        WHERE u.role='vet'
        """
    ).fetchall()
    output = []
    for row in rows:
        item = dict(row)
        item["supported_languages"] = _loads(item["supported_languages"], ["en"])
        status = item["configured_status"]
        if status == "AVAILABLE" and not in_hours:
            status = "OUTSIDE_HOURS"
        item["effective_status"] = status
        item["active_cases"] = conn.execute(
            "SELECT COUNT(*) c FROM cases WHERE vet_id=? AND status NOT IN ('CLOSED','RECOVERED')",
            (item["vet_id"],),
        ).fetchone()["c"]
        output.append(item)
    return output


def list_vet_availability(conn) -> list[dict]:
    return _availability_rows(conn)


def set_vet_availability(conn, vet_id: int, status: str, languages=None) -> dict:
    status = (status or "").upper()
    if status not in {"AVAILABLE", "BUSY", "OFFLINE", "OUTSIDE_HOURS"}:
        raise ValueError("Invalid availability status")
    current = conn.execute("SELECT * FROM vet_availability WHERE vet_id=?", (vet_id,)).fetchone()
    supported = languages
    if supported is None:
        supported = _loads(current["supported_languages"], ["en"]) if current else ["en"]
    if not isinstance(supported, list) or not supported:
        raise ValueError("supported_languages must be a non-empty list")
    supported = list(dict.fromkeys(code for code in supported if code in SUPPORTED_LANGUAGES))
    if not supported:
        raise ValueError("At least one supported language is required")
    # Manual BUSY has no fabricated call association. A live association is set only by routing.
    conn.execute(
        """
        INSERT INTO vet_availability (vet_id, status, supported_languages, updated_at)
        VALUES (?,?,?,datetime('now'))
        ON CONFLICT(vet_id) DO UPDATE SET status=excluded.status,
          supported_languages=excluded.supported_languages,
          current_call_id=CASE WHEN excluded.status='AVAILABLE' THEN NULL ELSE vet_availability.current_call_id END,
          busy_since=CASE WHEN excluded.status='AVAILABLE' THEN NULL ELSE vet_availability.busy_since END,
          updated_at=datetime('now')
        """,
        (vet_id, status, json.dumps(supported)),
    )
    audit_log(conn, "UPDATE_VET_AVAILABILITY", "vet_availability", vet_id, actor_id=vet_id, actor_role="vet", details={"status": status, "languages": supported})
    conn.commit()
    return next(item for item in _availability_rows(conn) if item["vet_id"] == vet_id)


def _route_score(conn, call, survey: dict, vet: dict) -> tuple[float, list[str]]:
    score = 0.0
    reasons = []
    call_district = (call["district"] or "").strip().lower()
    vet_district = (vet["district"] or "").strip().lower()
    if call_district and call_district == vet_district:
        score += 100
        reasons.append("same_region")
    elif call_district and vet_district in NEARBY_DISTRICTS.get(call_district, set()):
        score += 25
        reasons.append("nearby_region")
    elif call["region_state"] and vet["state"] and call["region_state"].lower() == vet["state"].lower():
        score += 10
        reasons.append("same_state")

    if call["block"] and vet["block"] and call["block"].lower() == vet["block"].lower():
        score += 20
        reasons.append("same_block")
    if call["language"] in vet["supported_languages"]:
        score += 50
        reasons.append("language_match")
    if call["farmer_id"]:
        prior = conn.execute(
            "SELECT COUNT(*) c FROM cases WHERE owner_id=? AND vet_id=?",
            (call["farmer_id"], vet["vet_id"]),
        ).fetchone()["c"]
        if prior:
            score += 35
            reasons.append("existing_relationship")
    specialization = (vet["specialization"] or "").lower()
    symptoms = " ".join(str(survey.get(k) or "") for k in ("species", "symptoms")).lower()
    if specialization and any(word in specialization for word in re.findall(r"[a-z]+", symptoms) if len(word) > 4):
        score += 15
        reasons.append("specialization_match")
    score -= min(vet["active_cases"], 20)
    return score, reasons


def route_veterinarian(conn, call_id: str) -> dict:
    settings = get_ivr_settings()
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    survey = _loads(call["survey_data"], {})
    candidates = []
    for vet in _availability_rows(conn):
        allowed = vet["effective_status"] == "AVAILABLE"
        if vet["effective_status"] == "OUTSIDE_HOURS" and settings.allow_outside_hours_fallback:
            allowed = True
        if not allowed or vet["active_cases"] >= settings.max_active_cases:
            conn.execute(
                "INSERT INTO ivr_routing_attempts (call_id, vet_id, score, outcome, reason) VALUES (?,?,?,?,?)",
                (call_id, vet["vet_id"], None, "SKIPPED", vet["effective_status"] if not allowed else "MAX_ACTIVE_CASES"),
            )
            continue
        score, reasons = _route_score(conn, call, survey, vet)
        candidates.append((score, -vet["active_cases"], -vet["vet_id"], reasons, vet))

    if not candidates:
        conn.execute(
            "UPDATE helpline_calls SET status='VET_UNAVAILABLE', routing_status='NO_SUITABLE_VET', "
            "fallback_reason='NO_AVAILABLE_VETERINARIAN', last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (call_id,),
        )
        _event(conn, call_id, "VET_UNAVAILABLE", {"fallback": "SURVEY"})
        conn.commit()
        return start_survey(conn, call_id, fallback_reason="NO_AVAILABLE_VETERINARIAN")

    candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    score, _, _, reasons, vet = candidates[0]
    conn.execute(
        """
        UPDATE helpline_calls SET status='ROUTING', vet_id=?, routing_status='VET_SELECTED',
        last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?
        """,
        (vet["vet_id"], call_id),
    )
    conn.execute(
        """
        INSERT INTO vet_availability (vet_id, status, supported_languages, current_call_id, busy_since, updated_at)
        VALUES (?,'BUSY',?,?,datetime('now'),datetime('now'))
        ON CONFLICT(vet_id) DO UPDATE SET status='BUSY', current_call_id=excluded.current_call_id,
          busy_since=datetime('now'), updated_at=datetime('now')
        """,
        (vet["vet_id"], json.dumps(vet["supported_languages"]), call_id),
    )
    conn.execute(
        "INSERT INTO ivr_routing_attempts (call_id, vet_id, score, outcome, reason) VALUES (?,?,?,?,?)",
        (call_id, vet["vet_id"], score, "SELECTED", ",".join(reasons)),
    )
    _event(conn, call_id, "VET_SELECTED", {"vet_id": vet["vet_id"], "score": score, "reasons": reasons})
    conn.commit()

    adapter = get_telephony_adapter(settings.provider_mode)
    instruction = adapter.bridge(normalize_indian_number(vet["mobile"]) or vet["mobile"], call_id).as_dict()
    updated = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    response = call_response(conn, updated)
    response["instruction"] = instruction
    response["routing"] = {"vet_id": vet["vet_id"], "vet_name": vet["full_name"], "score": score, "reasons": reasons}
    return response


def _next_survey_question(survey: dict, farmer_id: int | None, animal_choices: list[dict]) -> str | None:
    for field in SURVEY_ORDER:
        if field == "animal_id" and (not farmer_id or len(animal_choices) <= 1):
            continue
        if field == "animal_name" and farmer_id and survey.get("animal_id"):
            continue
        if survey.get(field) in (None, ""):
            return field
    return None


def start_survey(conn, call_id: str, fallback_reason: str | None = None) -> dict:
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    survey = _loads(call["survey_data"], {})
    known, choices = _prefill_known_animal_data(conn, call["farmer_id"])
    for key, value in known.items():
        survey.setdefault(key, value)
    question = _next_survey_question(survey, call["farmer_id"], choices)
    conn.execute(
        """
        UPDATE helpline_calls SET status='SURVEY_STARTED', routing_status=COALESCE(routing_status, 'SURVEY'),
          fallback_reason=COALESCE(?, fallback_reason), survey_data=?, current_question=?,
          last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?
        """,
        (fallback_reason, json.dumps(survey, ensure_ascii=False), question, call_id),
    )
    _event(conn, call_id, "SURVEY_STARTED", {"fallback_reason": fallback_reason, "known_fields": sorted(survey)})
    conn.commit()
    if question is None:
        return complete_survey(conn, call_id)
    updated = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    response = call_response(conn, updated)
    response["animal_choices"] = choices
    if fallback_reason:
        response["fallback_prompt"] = _prompt(updated, "no_vet")
    return response


def record_survey_answer(conn, call_id: str, payload: dict) -> dict:
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call or call["status"] != "SURVEY_STARTED":
        raise ValueError("Survey is not active")
    field = (payload.get("field") or call["current_question"] or "").strip()
    if field not in SURVEY_ORDER:
        raise ValueError("Unknown survey field")
    value = payload.get("value")
    if value is None:
        value = payload.get(field)
    if isinstance(value, str):
        value = value.strip()
        if value.lower() in {"skip", "not known", "unknown", "not provided"}:
            value = "Not Provided"
    if value in (None, ""):
        raise ValueError("Survey answer is required; use 'Not Provided' when unknown")

    survey = _loads(call["survey_data"], {})
    if field == "animal_id":
        try:
            animal_id = int(value)
        except (TypeError, ValueError):
            raise ValueError("animal_id must identify a registered animal")
        animal = conn.execute(
            "SELECT * FROM animals WHERE id=? AND owner_id=?", (animal_id, call["farmer_id"])
        ).fetchone()
        if not animal:
            raise ValueError("Animal is not registered to the identified farmer")
        survey.update({
            "animal_id": animal["id"], "animal_name": animal["animal_name"] or animal["animal_code"],
            "species": animal["species"], "breed": animal["breed"],
            "age": animal["age"] if animal["age"] is not None else animal["age_years"],
            "sex": animal["sex"] or animal["gender"],
        })
        vaccination = conn.execute(
            "SELECT GROUP_CONCAT(vaccine, ', ') value FROM vaccinations WHERE animal_id=?",
            (animal_id,),
        ).fetchone()["value"]
        if vaccination:
            survey["vaccination_status"] = f"Recorded vaccines: {vaccination}"
        medications = conn.execute(
            "SELECT GROUP_CONCAT(medication_name, ', ') value FROM animal_medications WHERE animal_id=? AND status='Active'",
            (animal_id,),
        ).fetchone()["value"]
        if medications:
            survey["medicines_used"] = medications
            survey["previous_treatment"] = "Active medication is already recorded"
    else:
        survey[field] = value

    _, choices = _prefill_known_animal_data(conn, call["farmer_id"])
    question = _next_survey_question(survey, call["farmer_id"], choices)
    conn.execute(
        "UPDATE helpline_calls SET survey_data=?, current_question=?, last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
        (json.dumps(survey, ensure_ascii=False), question, call_id),
    )
    _event(conn, call_id, "SURVEY_ANSWER", {"field": field, "provided": True})
    conn.commit()
    if question is None:
        return complete_survey(conn, call_id)
    updated = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    return call_response(conn, updated)


def _select_review_vet(conn, call, survey: dict) -> int | None:
    if call["vet_id"]:
        return call["vet_id"]
    vets = _availability_rows(conn)
    if not vets:
        return None
    ranked = []
    for vet in vets:
        # Async report review may be assigned even when the vet cannot take a live call.
        score, _ = _route_score(conn, call, survey, vet)
        ranked.append((score, -vet["active_cases"], -vet["vet_id"], vet["vet_id"]))
    ranked.sort(reverse=True)
    return ranked[0][3]


def _similar_problem(first: str | None, second: str | None) -> bool:
    a = re.sub(r"\s+", " ", (first or "").strip().lower())
    b = re.sub(r"\s+", " ", (second or "").strip().lower())
    if not a or not b:
        return False
    a_tokens, b_tokens = set(re.findall(r"\w+", a)), set(re.findall(r"\w+", b))
    jaccard = len(a_tokens & b_tokens) / max(1, len(a_tokens | b_tokens))
    return jaccard >= 0.5 or SequenceMatcher(None, a, b).ratio() >= 0.75


def _find_duplicate(conn, call, survey: dict, animal_id: int | None):
    settings = get_ivr_settings()
    candidates = conn.execute(
        """
        SELECT * FROM helpline_reports
        WHERE created_at >= datetime('now', ?)
          AND ((? IS NOT NULL AND farmer_id=?) OR (? IS NOT NULL AND caller_number=?))
          AND (? IS NULL OR animal_id=? OR animal_id IS NULL)
          AND (? IS NULL OR LOWER(COALESCE(district,''))=LOWER(?))
        ORDER BY id DESC
        """,
        (
            f"-{settings.duplicate_window_hours} hours",
            call["farmer_id"], call["farmer_id"], call["caller_number"], call["caller_number"],
            animal_id, animal_id, call["district"], call["district"],
        ),
    ).fetchall()
    for candidate in candidates:
        if _similar_problem(candidate["symptoms"], survey.get("symptoms")):
            return candidate
    return None


def _resolve_report_animal(conn, call, survey: dict):
    if not call["farmer_id"]:
        return None
    animal_id = survey.get("animal_id")
    if animal_id:
        return conn.execute(
            "SELECT * FROM animals WHERE id=? AND owner_id=?", (animal_id, call["farmer_id"])
        ).fetchone()

    # A live transcript may explicitly name a registered tag/name. Match only
    # when exactly one owned animal is unambiguous; never pick the latest at random.
    hint = " ".join(str(value or "") for value in (survey.get("animal_name"), call["transcript"])).lower()
    if hint.strip():
        matches = []
        for candidate in conn.execute("SELECT * FROM animals WHERE owner_id=?", (call["farmer_id"],)).fetchall():
            identifiers = [candidate["animal_code"], candidate["animal_name"]]
            if any(identifier and identifier.lower() in hint for identifier in identifiers):
                matches.append(candidate)
        if len(matches) == 1:
            return matches[0]

    species = survey.get("species")
    if not species or species == "Not Provided":
        return None
    try:
        age = float(survey.get("age")) if survey.get("age") not in (None, "", "Not Provided") else None
    except (TypeError, ValueError):
        age = None
    owner = conn.execute("SELECT * FROM users WHERE id=?", (call["farmer_id"],)).fetchone()
    code = next_code(conn, "MH", "animals", "animal_code", district=(call["district"] or "PUN")[:3].upper())
    cur = conn.execute(
        """
        INSERT INTO animals
        (animal_code, owner_id, animal_name, animal_type, species, breed, gender, sex,
         age, age_years, owner_name, mobile, village, block, district, state, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Under Observation')
        """,
        (
            code, call["farmer_id"], survey.get("animal_name"), species, species,
            survey.get("breed"), survey.get("sex"), survey.get("sex"), age, age,
            owner["full_name"], owner["mobile"], call["village"], call["block"], call["district"],
            call["region_state"] or owner["state"],
        ),
    )
    animal_id = cur.lastrowid
    token = f"aqr_{uuid.uuid4().hex}"
    conn.execute(
        "INSERT INTO animal_qr_codes (animal_id, qr_token, qr_payload, status) VALUES (?,?,?,'ACTIVE')",
        (animal_id, token, f"PASHU:ANIMAL:{token}"),
    )
    return conn.execute("SELECT * FROM animals WHERE id=?", (animal_id,)).fetchone()


def finalize_report(conn, call_id: str) -> dict:
    existing = conn.execute("SELECT * FROM helpline_reports WHERE call_id=?", (call_id,)).fetchone()
    if existing:
        data = dict(existing)
        data["structured_summary"] = _loads(data["structured_summary"], {})
        return data

    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    survey = _loads(call["survey_data"], {})
    summary = summarize_call(survey, call["transcript"])
    animal = _resolve_report_animal(conn, call, survey)
    animal_id = animal["id"] if animal else None
    assigned_vet_id = _select_review_vet(conn, call, survey)
    duplicate = _find_duplicate(conn, call, survey, animal_id)
    report_status = "DUPLICATE_FLAGGED" if duplicate else ("CREATED" if animal else "PARTIAL")
    report_no = f"HLPR-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"

    case = None
    if animal and call["farmer_id"]:
        details = []
        for label, key in (
            ("Duration", "duration"), ("Affected animals", "affected_count"),
            ("Previous treatment", "previous_treatment"), ("Medicines", "medicines_used"),
            ("Farmer observations", "farmer_observations"), ("Additional information", "additional_information"),
        ):
            if survey.get(key) not in (None, "", "Not Provided"):
                details.append(f"{label}: {survey[key]}")
        case = create_case_record(
            conn,
            animal=animal,
            owner_id=call["farmer_id"],
            data={
                "symptoms": survey.get("symptoms") or summary.get("farmer_observations"),
                "severity": survey.get("severity") or "Medium",
                "description": "; ".join(details) or "Helpline report; no additional details provided.",
            },
            source="HELPLINE",
            actor_name="Pashu-Shield Helpline",
            actor_role="system",
            assigned_vet_id=assigned_vet_id,
            notify_veterinarians=False,
        )

    conn.execute(
        """
        INSERT INTO helpline_reports
        (report_no, call_id, case_id, farmer_id, animal_id, assigned_vet_id,
         caller_number, language, region_state, district, block, village, latitude,
         longitude, location_source, symptoms, urgency, structured_summary, source,
         status, duplicate_of)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            report_no, call_id, case["id"] if case else None, call["farmer_id"], animal_id,
            assigned_vet_id, call["caller_number"], call["language"], call["region_state"],
            call["district"], call["block"], call["village"], call["latitude"], call["longitude"],
            call["location_source"], survey.get("symptoms"), summary.get("urgency"),
            json.dumps(summary, ensure_ascii=False), "HELPLINE", report_status,
            duplicate["id"] if duplicate else None,
        ),
    )
    conn.execute(
        "UPDATE helpline_calls SET summary_json=?, case_id=?, updated_at=datetime('now') WHERE call_id=?",
        (json.dumps(summary, ensure_ascii=False), case["id"] if case else None, call_id),
    )

    if assigned_vet_id:
        farmer_name = "Unlinked caller"
        if call["farmer_id"]:
            row = conn.execute("SELECT full_name FROM users WHERE id=?", (call["farmer_id"],)).fetchone()
            farmer_name = row["full_name"] if row else farmer_name
        animal_text = survey.get("animal_name") or survey.get("species") or "Not Provided"
        message = (
            f"Helpline report {report_no}: {farmer_name}; region {call['district'] or call['village'] or 'Unknown'}; "
            f"language {LANGUAGE_NAMES.get(call['language'], 'Unknown')}; animal {animal_text}; "
            f"symptoms {survey.get('symptoms') or 'Not Provided'}; urgency {summary.get('urgency') or 'Not Provided'}; source HELPLINE."
        )
        conn.execute("INSERT INTO notifications (user_id, message, type) VALUES (?,?, 'case')", (assigned_vet_id, message))
    if call["farmer_id"]:
        conn.execute(
            "INSERT INTO notifications (user_id, message, type) VALUES (?,?, 'case')",
            (call["farmer_id"], f"Your helpline report {report_no} has been saved for veterinary review."),
        )

    _event(conn, call_id, "REPORT_CREATED", {
        "report_no": report_no, "case_id": case["id"] if case else None,
        "status": report_status, "duplicate_of": duplicate["report_no"] if duplicate else None,
    })
    audit_log(
        conn, "CREATE_HELPLINE_REPORT", "helpline_report", report_no,
        actor_name="Pashu-Shield Helpline", actor_role="system",
        details={"call_id": call_id, "case_id": case["id"] if case else None, "status": report_status},
    )
    conn.commit()
    report = conn.execute("SELECT * FROM helpline_reports WHERE call_id=?", (call_id,)).fetchone()
    result = dict(report)
    result["structured_summary"] = _loads(result["structured_summary"], {})
    return result


def complete_survey(conn, call_id: str) -> dict:
    conn.execute(
        "UPDATE helpline_calls SET status='SURVEY_COMPLETED', current_question=NULL, last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
        (call_id,),
    )
    _event(conn, call_id, "SURVEY_COMPLETED")
    conn.commit()
    report = finalize_report(conn, call_id)
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    response = call_response(conn, call)
    response["report"] = report
    response["instruction"] = get_telephony_adapter(get_ivr_settings().provider_mode).hangup(_prompt(call, "complete")).as_dict()
    return response


def _release_vet(conn, call) -> None:
    if call["vet_id"]:
        conn.execute(
            """
            UPDATE vet_availability SET status='AVAILABLE', current_call_id=NULL,
              busy_since=NULL, updated_at=datetime('now')
            WHERE vet_id=? AND (current_call_id=? OR current_call_id IS NULL)
            """,
            (call["vet_id"], call["call_id"]),
        )


def handle_call_event(conn, call_id: str, payload: dict) -> dict:
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    event_type = (payload.get("event") or payload.get("event_type") or "").strip().lower()
    if event_type == "bridge_connected":
        if call["status"] != "ROUTING" or not call["vet_id"]:
            raise ValueError("No pending veterinarian bridge exists")
        conn.execute(
            "UPDATE helpline_calls SET status='VET_CONNECTED', routing_status='CONNECTED', last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (call_id,),
        )
        _event(conn, call_id, "BRIDGE_CONNECTED", {"provider_confirmed": True})
    elif event_type == "bridge_failed":
        _release_vet(conn, call)
        conn.execute(
            "UPDATE helpline_calls SET status='VET_UNAVAILABLE', routing_status='BRIDGE_FAILED', fallback_reason='BRIDGE_FAILED', last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (call_id,),
        )
        _event(conn, call_id, "BRIDGE_FAILED", {"reason": payload.get("reason")})
        conn.commit()
        return start_survey(conn, call_id, fallback_reason="BRIDGE_FAILED")
    elif event_type == "transcript":
        text = (payload.get("transcript") or payload.get("text") or "").strip()
        if not text:
            raise ValueError("Transcript text is required")
        combined = "\n".join(part for part in (call["transcript"], text) if part)
        conn.execute(
            "UPDATE helpline_calls SET transcript=?, last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (combined, call_id),
        )
        _event(conn, call_id, "TRANSCRIPT_RECEIVED", {"characters": len(text)})
    elif event_type == "hangup":
        _release_vet(conn, call)
        _event(conn, call_id, "HANGUP", {"provider_status": payload.get("status")})
        conn.commit()
        useful = bool(call["transcript"] or _loads(call["survey_data"], {}).get("symptoms") or call["status"] in {"VET_CONNECTED", "SURVEY_COMPLETED"})
        report = finalize_report(conn, call_id) if useful else None
        final_status = "COMPLETED" if report and call["status"] in {"VET_CONNECTED", "SURVEY_COMPLETED"} else ("PARTIAL" if report or call["farmer_id"] else "ABANDONED")
        conn.execute(
            "UPDATE helpline_calls SET status=?, ended_at=datetime('now'), last_activity_at=datetime('now'), updated_at=datetime('now') WHERE call_id=?",
            (final_status, call_id),
        )
    else:
        raise ValueError("Unsupported call event")

    conn.commit()
    updated = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    return call_response(conn, updated)


def list_reports_for_user(conn, role: str, user_id: int) -> list[dict]:
    base = """
        SELECT hr.*, hc.status call_status, u.full_name farmer_name, a.animal_code,
               v.full_name vet_name
        FROM helpline_reports hr
        JOIN helpline_calls hc ON hc.call_id=hr.call_id
        LEFT JOIN users u ON u.id=hr.farmer_id
        LEFT JOIN animals a ON a.id=hr.animal_id
        LEFT JOIN users v ON v.id=hr.assigned_vet_id
    """
    if role == "owner":
        rows = conn.execute(base + " WHERE hr.farmer_id=? ORDER BY hr.id DESC", (user_id,)).fetchall()
    elif role == "vet":
        rows = conn.execute(base + " WHERE hr.assigned_vet_id=? ORDER BY hr.id DESC", (user_id,)).fetchall()
    elif role == "govt":
        rows = conn.execute(base + " ORDER BY hr.id DESC").fetchall()
    else:
        raise PermissionError("Helpline reports are not available for this role")
    result = []
    for row in rows:
        item = dict(row)
        item["structured_summary"] = _loads(item["structured_summary"], {})
        result.append(item)
    return result


def get_call_for_user(conn, call_id: str, role: str, user_id: int) -> dict:
    call = conn.execute("SELECT * FROM helpline_calls WHERE call_id=?", (call_id,)).fetchone()
    if not call:
        raise LookupError("Call session not found")
    allowed = role == "govt" or (role == "owner" and call["farmer_id"] == user_id) or (role == "vet" and call["vet_id"] == user_id)
    if not allowed:
        raise PermissionError("Not authorized to view this call")
    events = conn.execute(
        "SELECT id, event_type, created_at FROM ivr_call_events WHERE call_id=? ORDER BY id", (call_id,)
    ).fetchall()
    result = call_response(conn, call)
    result["events"] = [dict(event) for event in events]
    return result


def helpline_analytics(conn) -> dict:
    totals = conn.execute(
        """
        SELECT COUNT(*) total_calls,
          SUM(CASE WHEN status='VET_CONNECTED' OR routing_status='CONNECTED' THEN 1 ELSE 0 END) vet_connections,
          SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed_calls,
          SUM(CASE WHEN fallback_reason IS NOT NULL THEN 1 ELSE 0 END) unavailable_vet_cases,
          SUM(CASE WHEN status IN ('SURVEY_STARTED','SURVEY_COMPLETED','COMPLETED') AND menu_option='2' OR fallback_reason IS NOT NULL THEN 1 ELSE 0 END) survey_starts,
          SUM(CASE WHEN status IN ('SURVEY_COMPLETED','COMPLETED') THEN 1 ELSE 0 END) survey_completions,
          SUM(CASE WHEN status='PARTIAL' THEN 1 ELSE 0 END) partial_calls,
          AVG(CASE WHEN answered_at IS NOT NULL THEN (julianday(answered_at)-julianday(started_at))*86400 END) avg_response_seconds
        FROM helpline_calls
        """
    ).fetchone()
    reports = conn.execute(
        "SELECT COUNT(*) reports_created, SUM(CASE WHEN status='DUPLICATE_FLAGGED' THEN 1 ELSE 0 END) duplicate_reports FROM helpline_reports"
    ).fetchone()
    by_region = conn.execute(
        "SELECT COALESCE(NULLIF(district,''),'Unknown') label, COUNT(*) value FROM helpline_calls GROUP BY LOWER(COALESCE(district,'Unknown')) ORDER BY value DESC"
    ).fetchall()
    by_language = conn.execute(
        "SELECT COALESCE(NULLIF(language,''),'unknown') label, COUNT(*) value FROM helpline_calls GROUP BY language ORDER BY value DESC"
    ).fetchall()
    result = {key: (value or 0) for key, value in dict(totals).items()}
    result.update({key: (value or 0) for key, value in dict(reports).items()})
    result["average_response_time_seconds"] = round(float(result.pop("avg_response_seconds", 0)), 2)
    result["calls_by_region"] = [dict(row) for row in by_region]
    result["calls_by_language"] = [dict(row) for row in by_language]
    return result
