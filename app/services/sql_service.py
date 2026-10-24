import datetime
import decimal
import json
import re
import uuid
from typing import Any

import psycopg2

from app.config import settings
from app.services.llm_service import generate
from app.services.query_cache_service import query_cache

# Only the operational tables are visible to (and queryable by) the LLM. The
# original code introspected *every* public table, which exposed `users`
# (password hashes) to Text2SQL.
ALLOWED_TABLES = (
    "clusters",
    "nodes",
    "deployments",
    "pods",
    "incidents",
    "alerts",
    "oncall_logs",
)

_FORBIDDEN_KEYWORDS = [
    "insert", "update", "delete", "drop", "alter", "create", "truncate", "grant",
    "revoke", "copy", "vacuum", "call", "do", "execute", "prepare", "listen", "notify",
    "set", "reset", "lock", "comment", "security", "pg_sleep", "pg_read_file", "dblink",
]
_FORBIDDEN_RELATIONS = re.compile(r"\b(users|pg_\w+|information_schema)\b", re.IGNORECASE)


def _serialize_value(value: Any) -> Any:
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, datetime.time):
        return value.isoformat()
    if isinstance(value, datetime.timedelta):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    """Serialize all values in a row dict for JSON compatibility."""
    return {k: _serialize_value(v) for k, v in row.items()}


def _strip_sql_literals(sql: str) -> str:
    """Remove quoted strings so keywords inside literals ('Update failed') don't trip the check."""
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


def normalize_sql(sql: str) -> str:
    sql = sql.strip()
    if sql.startswith("```"):
        sql = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("```"))
    return sql.strip().rstrip(";").strip()


def check_sql(sql: str) -> tuple[bool, str]:
    """Return (ok, reason). Only a single read-only SELECT (or WITH ... SELECT)
    over the operational tables is allowed."""
    cleaned = _strip_sql_literals(normalize_sql(sql)).lower()
    if not cleaned:
        return False, "empty SQL"
    if not (cleaned.startswith("select") or cleaned.startswith("with")):
        return False, "only SELECT statements are allowed"
    if ";" in cleaned:
        return False, "multiple statements are not allowed"
    if "--" in cleaned or "/*" in cleaned:
        return False, "SQL comments are not allowed"
    for kw in _FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{kw}\b", cleaned):
            return False, f"forbidden keyword: {kw.upper()}"
    match = _FORBIDDEN_RELATIONS.search(cleaned)
    if match:
        return False, f"table not allowed: {match.group(0)}"
    return True, ""


def is_select_only(sql: str) -> bool:
    """Return True if the SQL is a single read-only SELECT statement."""
    return check_sql(sql)[0]


class SQLService:
    def __init__(self):
        self._schema_context: str | None = None

    def _connect(self):
        return psycopg2.connect(settings.database_url, connect_timeout=5)

    def _build_schema_context(self) -> str:
        if self._schema_context is not None:
            return self._schema_context

        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ANY(%s)
            ORDER BY table_name, ordinal_position;
            """,
            (list(ALLOWED_TABLES),),
        )
        rows = cur.fetchall()

        tables: dict[str, list[str]] = {}
        text_columns: list[tuple[str, str]] = []
        for table, col, dtype in rows:
            tables.setdefault(table, []).append(f"{col} ({dtype})")
            if dtype in ("character varying", "text") and not col.endswith(("summary", "image")):
                text_columns.append((table, col))

        # Real category values (severity 'P1', status 'CrashLoopBackOff', ...) are
        # what small models most often guess wrong, so list low-cardinality ones.
        samples: list[str] = []
        for table, col in text_columns:
            cur.execute(
                f'SELECT DISTINCT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL LIMIT 13'
            )
            values = [r[0] for r in cur.fetchall()]
            if 0 < len(values) <= 12:
                samples.append(f"  {table}.{col}: {', '.join(repr(v) for v in values)}")
        cur.close()
        conn.close()

        lines = ["Database schema (PostgreSQL):"]
        for table, cols in tables.items():
            lines.append(f"  {table}: {', '.join(cols)}")
        if samples:
            lines.append("Known values for categorical columns:")
            lines.extend(samples)
        lines.append(
            "Primary keys: clusters.cluster_id, nodes.node_id, deployments.deployment_id, pods.pod_id, "
            "incidents.incident_id, alerts.alert_id, oncall_logs.log_id (no table has a column named id)."
        )
        lines.append(
            "Joins: nodes.cluster_id = clusters.cluster_id; deployments.cluster_id = clusters.cluster_id; "
            "incidents.cluster_id = clusters.cluster_id; pods.node_id = nodes.node_id; "
            "pods.deployment_id = deployments.deployment_id; alerts.source_pod_id = pods.pod_id; "
            "oncall_logs.incident_id = incidents.incident_id. Pods have no cluster_id: join through nodes."
        )
        lines.append(
            "Words like 'now', 'currently' or 'right now' mean the current value of a status column, "
            "not a filter on a timestamp."
        )

        self._schema_context = "\n".join(lines)
        return self._schema_context

    def explain_error(self, sql: str) -> str | None:
        """Plan the query with EXPLAIN (nothing is executed) and return Postgres's
        error message, or None if the query is valid."""
        ok, reason = check_sql(sql)
        if not ok:
            return reason
        conn = self._connect()
        try:
            conn.set_session(readonly=True)
            cur = conn.cursor()
            cur.execute(f"SET LOCAL statement_timeout = {int(settings.sql_statement_timeout_ms)}")
            cur.execute(f"EXPLAIN {normalize_sql(sql)}")
            cur.close()
            return None
        except psycopg2.Error as exc:
            return str(exc).strip().splitlines()[0]
        finally:
            conn.rollback()
            conn.close()

    def generate_sql(self, question: str, max_fixes: int = 2) -> dict:
        cached = query_cache.get_sql_generation(question)
        if cached is not None:
            # Cached as JSON (sql + explanation) so the reviewer still sees why
            # the query looks the way it does; older entries hold bare SQL.
            try:
                hit = json.loads(cached)
                sql, explanation = hit["sql"], hit.get("explanation", "")
            except (json.JSONDecodeError, TypeError, KeyError):
                sql, explanation = cached, ""
            return {"sql": sql, "explanation": explanation, "cache_hit": True, "fixes": 0}

        schema = self._build_schema_context()
        system = (
            "You are a PostgreSQL expert for a Kubernetes operations database. Write ONE "
            "read-only SELECT query that answers the question, using only the tables and "
            "columns in the schema. Use the exact categorical values listed. Use now() for "
            "relative dates. Add LIMIT 50 unless the query aggregates to a few rows. "
            'Respond with JSON: {"sql": "<query>", "explanation": "<one sentence>"}.'
        )
        user = f"{schema}\n\nQuestion: {question}"
        payload: dict = {"sql": "", "explanation": "", "cache_hit": False, "fixes": 0}

        # Generate, then validate with EXPLAIN *before* a human is asked to approve.
        # A rejected query goes back to the model with Postgres's error message, so
        # the person only ever reviews SQL that is known to be valid.
        for attempt in range(max_fixes + 1):
            result = generate(
                system,
                user,
                model=settings.vanna_model,
                temperature=settings.vanna_temperature,
                json_mode=True,
            )
            data = json.loads(result["text"])
            payload.update(
                sql=normalize_sql(str(data.get("sql", ""))),
                explanation=str(data.get("explanation", "")),
                fixes=attempt,
            )
            error = self.explain_error(payload["sql"]) if payload["sql"] else "empty SQL"
            if error is None:
                query_cache.set_sql_generation(
                    question, json.dumps({"sql": payload["sql"], "explanation": payload["explanation"]})
                )
                return payload
            payload["error"] = error
            user = (
                f"{schema}\n\nQuestion: {question}\n\nYour previous query was:\n{payload['sql']}\n"
                f"PostgreSQL rejected it: {error}\nReturn a corrected query."
            )
        return payload

    def execute_sql(self, sql: str) -> list[dict]:
        sql = normalize_sql(sql)
        ok, reason = check_sql(sql)
        if not ok:
            raise ValueError(f"SQL rejected: {reason}")

        cached = query_cache.get_sql_result(sql)
        if cached is not None:
            return cached

        conn = self._connect()
        try:
            # Defence in depth: even if a statement slipped past check_sql, the
            # session is read-only and time-boxed.
            conn.set_session(readonly=True)
            cur = conn.cursor()
            cur.execute(f"SET LOCAL statement_timeout = {int(settings.sql_statement_timeout_ms)}")
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchmany(settings.sql_max_rows)
            cur.close()
            conn.rollback()
        finally:
            conn.close()

        result = [_serialize_row(dict(zip(columns, row, strict=True))) for row in rows]
        query_cache.set_sql_result(sql, result)
        return result
