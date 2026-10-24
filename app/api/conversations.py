"""Saved conversations for the chat console. Every route is scoped to the signed-in
user: another user's conversation id behaves exactly like one that does not exist."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import User, get_current_user
from app.services import conversation_service as conversations

router = APIRouter(tags=["conversations"])


class RenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


@router.get("/conversations")
def list_conversations(user: User = Depends(get_current_user)) -> dict:
    return {"conversations": conversations.list_conversations(user.username)}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, user: User = Depends(get_current_user)) -> dict:
    conv = conversations.get_conversation(user.username, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: str, body: RenameRequest, user: User = Depends(get_current_user)) -> dict:
    if not conversations.rename_conversation(user.username, conversation_id, body.title):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "renamed"}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, user: User = Depends(get_current_user)) -> dict:
    if not conversations.delete_conversation(user.username, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted"}
