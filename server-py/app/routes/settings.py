from fastapi import APIRouter, Request

from app.http import error, read_json
from app.services.llm import (
    check_llm_health,
    get_chat_options,
    get_llm_settings_snapshot,
    set_chat_model,
    set_provider_api_key,
)

router = APIRouter()


def _settings_body(snap: dict) -> dict:
    return {
        "model": snap["optionId"],
        "apiModel": snap["apiModel"],
        "label": snap["label"],
        "provider": snap["provider"],
    }


@router.get("/settings/llm")
async def get_settings():
    try:
        health = await check_llm_health()
        snap = get_llm_settings_snapshot()
        return {
            **_settings_body(snap),
            "options": get_chat_options(),
            "keyStatus": snap["keyStatus"],
            "keyHints": snap["keyHints"],
            "llmOk": health["ok"],
            "llmState": health["state"],
        }
    except Exception as e:  # noqa: BLE001
        return error(500, str(e) or "settings error")


@router.put("/settings/llm")
async def put_settings(request: Request):
    try:
        body = await read_json(request)

        if "providerApiKey" in body:
            target = str(body.get("keyProvider") or "").strip()
            if not target:
                raise ValueError("keyProvider 값이 필요합니다.")
            set_provider_api_key(target, body["providerApiKey"])

        model = body.get("model")
        if model is not None and str(model).strip() != "":
            set_chat_model(model)

        snap = get_llm_settings_snapshot()
        return {**_settings_body(snap), "keyStatus": snap["keyStatus"], "keyHints": snap["keyHints"]}
    except Exception as e:  # noqa: BLE001
        return error(400, str(e) or "invalid settings")
