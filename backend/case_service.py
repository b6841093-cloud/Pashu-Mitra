"""Shared case creation used by web, voice and helpline reporting channels."""
from __future__ import annotations

from database import audit_log, next_code


def _notify(conn, user_id: int, message: str, type_: str = "case") -> None:
    conn.execute(
        "INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)",
        (user_id, message, type_),
    )


def create_case_record(
    conn,
    *,
    animal,
    owner_id: int,
    data: dict,
    source: str,
    actor_name: str,
    actor_role: str,
    actor_id: int | None = None,
    assigned_vet_id: int | None = None,
    notify_veterinarians: bool = True,
):
    """Create a case in the existing case system and return its SQLite row.

    The caller owns transaction commit/rollback so helpline report metadata and
    the clinical case can be committed atomically.
    """
    district = (animal["district"] or "PUN").strip()
    case_no = next_code(conn, "CASE", "cases", "case_no", district=district[:3].upper())
    cur = conn.execute(
        """
        INSERT INTO cases
        (case_no, animal_id, herd_id, owner_id, vet_id, symptoms,
         disease_suspected, severity, description, reported_through, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            case_no,
            animal["id"],
            animal["herd_id"],
            owner_id,
            assigned_vet_id,
            data.get("symptoms"),
            data.get("disease_suspected"),
            data.get("severity") or "Medium",
            data.get("description"),
            source,
            "NEW",
        ),
    )
    case_id = cur.lastrowid
    conn.execute(
        "INSERT INTO case_updates (case_id, status, note, updated_by) VALUES (?,?,?,?)",
        (case_id, "NEW", f"Case reported through {source}", actor_name),
    )
    conn.execute("UPDATE animals SET status='Under Observation' WHERE id=?", (animal["id"],))

    if notify_veterinarians:
        if assigned_vet_id:
            _notify(
                conn,
                assigned_vet_id,
                f"New {source.lower()} case assigned: {case_no} for {animal['animal_code']}",
            )
        else:
            regional_vets = conn.execute(
                "SELECT id FROM users WHERE role='vet' AND LOWER(COALESCE(district,''))=LOWER(?)",
                (district,),
            ).fetchall()
            for vet in regional_vets:
                _notify(conn, vet["id"], f"New {source.lower()} report in your district: {case_no}")

    audit_log(
        conn,
        "CREATE_CASE",
        "case",
        case_id,
        actor_id=actor_id,
        actor_name=actor_name,
        actor_role=actor_role,
        details={
            "case_no": case_no,
            "animal_code": animal["animal_code"],
            "source": source,
        },
    )
    return conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
