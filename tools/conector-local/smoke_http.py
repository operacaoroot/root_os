#!/usr/bin/env python3
"""Ensaio E3b.2a: cliente real contra o harness Nest em loopback.

Entrada sensível chega exclusivamente por stdin do runner; nada é argumento ou
saída. O processo usa cofre em memória apenas porque é explicitamente um teste.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse

from client import ConsentRequired, HttpTransport, LocalConnectorClient, LocalState, TransportError, approve_selection
from preview import preview
from secure_store import MemoryVault

current_stage = "parse"

def main() -> int:
    global current_stage
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    args = parser.parse_args()
    payload = json.load(__import__("sys").stdin)
    required = ("orgId", "pairingId", "code", "sourceId", "humanToken")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
        raise RuntimeError("fixture de integração incompleta")
    parsed_api = urlparse(args.api)
    if parsed_api.scheme != "http" or parsed_api.hostname != "127.0.0.1" or not parsed_api.port:
        raise RuntimeError("smoke Python só aceita HTTP loopback explícito")

    with tempfile.TemporaryDirectory(prefix="rootos-conector-python-") as directory:
        current_stage = "fixture"
        root = Path(directory).resolve() / "selected"
        root.mkdir()
        (root / "docs").mkdir()
        (root / "docs" / "fixture.md").write_text("frase exclusiva do cliente Python\r\n", encoding="utf-8")
        state = LocalState(Path(directory).resolve() / "state.json")
        vault = MemoryVault()
        transport = HttpTransport(args.api, allow_http_test=True, timeout=10)
        captured_bodies: list[dict[str, object]] = []
        original_post = transport.post

        def recording_post(path: str, body: dict[str, object], *, token: str | None = None) -> dict[str, object]:
            captured_bodies.append(dict(body))
            return original_post(path, body, token=token)

        transport.post = recording_post  # type: ignore[method-assign]
        client = LocalConnectorClient(transport, vault=vault, state=state)
        current_stage = "pair"
        paired = client.pair(org_id=payload["orgId"], pairing_id=payload["pairingId"], code=payload["code"], name="Python fixture")
        device_id = paired["id"]
        current_stage = "pulse"
        pulse = client.pulse(device_id=device_id)
        source = next((item for item in pulse.get("fontes", []) if item.get("id") == payload["sourceId"]), None)
        if not source:
            raise RuntimeError("fonte de integração não apareceu no pulso")
        current_stage = "preview"
        report = preview(root, recursive=True, extensions=[".md"])
        # Confirmação humana é uma entrada separada no CLI; aqui o runner injeta
        # explicitamente a decisão sintética para não abrir prompt no servidor.
        confirmacao = "sim"
        if confirmacao != "sim":
            raise RuntimeError("fixture não confirmou a seleção")
        current_stage = "approve"
        consent = approve_selection(
            root, report, target_url=args.api, org_id=payload["orgId"], device_id=device_id,
            source_id=source["id"], scope_version=source["escopoVersao"], mode=source["modo"],
            source_config=source,
        )
        current_stage = "sync"
        result = client.sync(consent, device_id=device_id)
        if result.get("status") != "concluida":
            raise RuntimeError("importação Python não foi concluída")
        serialized_bodies = json.dumps(captured_bodies, ensure_ascii=False)
        if str(root) in serialized_bodies:
            raise RuntimeError("a raiz local não pode atravessar o request")
        serialized_state = json.dumps(state.load(), ensure_ascii=False)
        if str(root) in serialized_state or "frase exclusiva do cliente Python" in serialized_state:
            raise RuntimeError("estado local não pode conter raiz ou conteúdo")
        current_stage = "revoke-source"
        transport.post(f"/api/conector/fontes/{source['id']}/revogar", {}, token=payload["humanToken"])
        after_source_revoke = transport.post(
            "/api/conector/pulso",
            {"versao": "rootos-local-1", "so": "posix", "usuarioLocal": "fixture", "relogio": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
            token=client._token(device_id),
        )
        if not after_source_revoke.get("revogado") or after_source_revoke.get("fontes"):
            raise RuntimeError("revogação da fonte não bloqueou o pulso")
        try:
            client.pulse(device_id=device_id)
        except ConsentRequired:
            pass
        else:
            raise RuntimeError("client.pulse não recusou fonte revogada")
        current_stage = "revoke-device"
        transport.post(f"/api/conector/dispositivos/{device_id}/revogar", {}, token=payload["humanToken"])
        try:
            client.pulse(device_id=device_id)
        except TransportError as exc:
            if "HTTP 401" not in str(exc):
                raise RuntimeError("revogação do dispositivo não retornou 401") from None
        else:
            raise RuntimeError("revogação do dispositivo não bloqueou o pulso")

    print(json.dumps({"marker": "PYTHON_CLIENT_SMOKE_OK", "deviceId": device_id,
                      "sourceId": source["id"], "sourceRef": f"{source['id']}/docs/fixture.md",
                      "status": result["status"], "revocations": "ok"}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"marker": "PYTHON_CLIENT_SMOKE_ERROR", "stage": current_stage,
                          "kind": type(exc).__name__}))
        raise SystemExit(2)
