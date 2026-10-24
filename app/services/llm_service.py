from openai import OpenAI

from app.config import settings

# One client for chat + embeddings. OPENAI_BASE_URL lets the same code talk to
# any OpenAI-compatible server (Ollama, vLLM, LM Studio, Azure-compatible proxies).
openai_client = OpenAI(
    api_key=settings.openai_api_key or "not-needed-for-local-endpoints",
    base_url=settings.openai_base_url or None,
    timeout=settings.llm_timeout_seconds,
)


def _usage(response) -> dict:
    return {
        "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
        "completion_tokens": response.usage.completion_tokens if response.usage else 0,
        "total_tokens": response.usage.total_tokens if response.usage else 0,
    }


def generate(
    system_prompt: str,
    user_message: str,
    model: str | None = None,
    temperature: float = 0.0,
    json_mode: bool = False,
) -> dict:
    if model is None:
        model = settings.llm_model_answer

    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        **kwargs,
    )

    text = response.choices[0].message.content or ""
    return {"text": text, "usage": _usage(response)}


def generate_with_json(
    system_prompt: str,
    user_message: str,
    model: str | None = None,
    temperature: float = 0.0,
) -> dict:
    return generate(
        system_prompt,
        user_message,
        model=model or settings.llm_model_grader,
        temperature=temperature,
        json_mode=True,
    )
