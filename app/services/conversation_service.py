"""Saved conversations: each user's chats and their messages, stored in Postgres.

Assistant messages keep the full response (sources, passages, SQL rows, trace)
in ``metadata`` so a reloaded conversation looks exactly as it did live. User
messages are stored *after* PII redaction (L7a), so personal data typed into a
question is never persisted.
"""

from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from app.config import settings

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "seed" / "migrations" / "004_create_conversations.sql"
_schema_ready = False
_schema_lock = threading.Lock()

MAX_TITLE = 60


def _connect():
    return psycopg2.connect(settings.database_url, connect_timeout=5)


def ensure_schema() -> None:
    """Create the tables on first use, so existing installs need no re-seed."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = _connect()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(_SCHEMA_SQL.read_text())
        finally:
            conn.close()
        _schema_ready = True


def make_title(question: str) -> str:
    text = " ".join(question.split())
    if len(text) <= MAX_TITLE:
        return text
    cut = text.rfind(" ", 0, MAX_TITLE)
    return text[: cut if cut > 20 else MAX_TITLE].rstrip(",.;:") + "..."


def _iso(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None:
            out[key] = out[key].isoformat()
    for key in ("id", "conversation_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    return out


def create_conversation(username: str, first_question: str) -> str:
    ensure_schema()
    conv_id = str(uuid.uuid4())
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (id, username, title) VALUES (%s, %s, %s)",
                (conv_id, username, make_title(first_question)),
            )
    finally:
        conn.close()
    return conv_id


def owns(username: str, conversation_id: str) -> bool:
    ensure_schema()
    try:
        uuid.UUID(conversation_id)
    except ValueError:
        return False
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM conversations WHERE id = %s AND username = %s", (conversation_id, username)
            )
            return cur.fetchone() is not None
    finally:
        conn.close()


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    metadata: dict[str, Any] | None = None,
    query_id: str | None = None,
) -> str:
    ensure_schema()
    msg_id = str(uuid.uuid4())
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (id, conversation_id, role, content, metadata, query_id) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (msg_id, conversation_id, role, content, Json(metadata or {}), query_id),
            )
            cur.execute("UPDATE conversations SET updated_at = now() WHERE id = %s", (conversation_id,))
    finally:
        conn.close()
    return msg_id


def update_message_by_query(query_id: str, content: str, metadata: dict[str, Any]) -> tuple[str, str] | None:
    """Replace the pending assistant message of a paused SQL query with the final
    answer. Returns (conversation_id, message_id), or None if nothing matched."""
    ensure_schema()
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_messages SET content = %s, metadata = %s "
                "WHERE query_id = %s AND role = 'assistant' RETURNING conversation_id, id",
                (content, Json(metadata), query_id),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute("UPDATE conversations SET updated_at = now() WHERE id = %s", (row[0],))
            return str(row[0]), str(row[1])
    finally:
        conn.close()


def history_for_followup(conversation_id: str, limit_turns: int = 3) -> list[tuple[str, str]]:
    """The last few completed exchanges, oldest first, for understanding a follow-up.
    Blocked replies and SQL still waiting for approval are left out."""
    ensure_schema()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role, content, metadata FROM chat_messages WHERE conversation_id = %s "
                "ORDER BY created_at DESC LIMIT %s",
                (conversation_id, limit_turns * 2 + 2),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    turns: list[tuple[str, str]] = []
    for role, content, metadata in reversed(rows):
        meta = metadata or {}
        if role == "assistant" and (meta.get("error") or meta.get("pending_sql") or not content.strip()):
            # A blocked or unanswered turn: drop the question too, so an attack that was
            # stopped can never leak into the next question's context.
            if turns and turns[-1][0] == "user":
                turns.pop()
            continue
        turns.append((role, content))
    return turns[-limit_turns * 2 :]


def list_conversations(username: str, limit: int = 100) -> list[dict[str, Any]]:
    ensure_schema()
    conn = _connect()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS message_count
                FROM conversations c LEFT JOIN chat_messages m ON m.conversation_id = c.id
                WHERE c.username = %s
                GROUP BY c.id ORDER BY c.updated_at DESC LIMIT %s
                """,
                (username, limit),
            )
            return [_iso(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_conversation(username: str, conversation_id: str) -> dict[str, Any] | None:
    if not owns(username, conversation_id):
        return None
    conn = _connect()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, title, created_at, updated_at FROM conversations WHERE id = %s", (conversation_id,)
            )
            conv = _iso(cur.fetchone())
            cur.execute(
                "SELECT id, role, content, metadata, created_at FROM chat_messages "
                "WHERE conversation_id = %s ORDER BY created_at",
                (conversation_id,),
            )
            conv["messages"] = [_iso(r) for r in cur.fetchall()]
            return conv
    finally:
        conn.close()


def rename_conversation(username: str, conversation_id: str, title: str) -> bool:
    if not owns(username, conversation_id):
        return False
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("UPDATE conversations SET title = %s WHERE id = %s", (make_title(title), conversation_id))
    finally:
        conn.close()
    return True


def delete_conversation(username: str, conversation_id: str) -> bool:
    if not owns(username, conversation_id):
        return False
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
    finally:
        conn.close()
    return True
