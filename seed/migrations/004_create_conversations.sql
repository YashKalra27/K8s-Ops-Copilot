-- Saved chat conversations for the console (follow-up questions use this history).
-- Idempotent: safe to run on every `make seed`.
CREATE TABLE IF NOT EXISTS conversations (
    id          UUID PRIMARY KEY,
    username    VARCHAR(64) NOT NULL,
    title       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (username, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id               UUID PRIMARY KEY,
    conversation_id  UUID        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role             VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT        NOT NULL,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    query_id         VARCHAR(64),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_query ON chat_messages (query_id) WHERE query_id IS NOT NULL;
