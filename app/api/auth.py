import psycopg2
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import settings
from app.middleware.auth import (
    User,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.middleware.rate_limiter import is_allowed_ip
from app.models import AuthRequest
from app.security.token_budget import budget_status

router = APIRouter(tags=["auth"])


def _get_db_conn():
    return psycopg2.connect(settings.database_url, connect_timeout=5)


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(request: Request, body: AuthRequest) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    allowed, _, _ = is_allowed_ip(
        client_ip,
        "/auth/register",
        limit=settings.auth_register_rate_limit_per_hour,
        window_seconds=3600,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    password_hash = hash_password(body.password)
    conn = _get_db_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING id",
            (body.username, password_hash),
        )
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=409, detail="User already exists") from None
    finally:
        cur.close()
        conn.close()

    token = create_access_token(body.username)
    return {"token": token, "username": body.username, "is_admin": False}


@router.post("/auth/login")
def login(request: Request, body: AuthRequest) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    allowed, _, _ = is_allowed_ip(
        client_ip,
        "/auth/login",
        limit=settings.auth_login_rate_limit_per_min,
        window_seconds=60,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    conn = _get_db_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT password_hash, is_admin FROM users WHERE username = %s",
            (body.username,),
        )
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if row is None or not verify_password(body.password, row[0]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(body.username, is_admin=bool(row[1]))
    return {"token": token, "username": body.username, "is_admin": bool(row[1])}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {"username": user.username, "is_admin": user.is_admin, "token_budget": budget_status(user.username)}
