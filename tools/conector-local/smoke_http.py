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

from client import ConsentRequired, HttpTransport, LocalConnectorClient, LocalState, TransportError, approve_selection, approve_snapshot
from preview import preview
from snapshot import snapshot_source
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
        if payload.get("snapshot"):
            if source.get("modo") != "sincronizacao":
                raise RuntimeError("fixture de snapshot exige fonte sincronizacao")
            snapshot_results = []
            previous_consent = None
            loss_paths = ("/api/conector/remessa", "/lote", "/fim")
            for index, content in enumerate(("snapshot A", "snapshot B", "snapshot A")):
                current_stage = f"snapshot-{index}-preview"
                (root / "docs" / "fixture.md").write_text(content, encoding="utf-8")
                report = snapshot_source(root, source)
                consent = approve_snapshot(root, report.as_dict(), target_url=args.api, org_id=payload["orgId"],
                                           device_id=device_id, source_id=source["id"],
                                           scope_version=source["escopoVersao"], source_config=source,
                                           previous=previous_consent,
                                           approve_new=index == 0, approve_changed=index > 0,
                                           absence_rule=source["regraExclusao"])
                previous_consent = {"snapshot": consent.snapshot,
                                    "consentEnvelope": {"target_url": args.api, "org_id": payload["orgId"],
                                                         "device_id": device_id, "source_id": source["id"],
                                                         "scope_version": source["escopoVersao"]}}
                snapshot_client = LocalConnectorClient(transport, vault=vault,
                                                       state=LocalState(Path(directory).resolve() / f"snapshot-{index}.json"))
                snapshot_state_path = Path(directory).resolve() / f"snapshot-{index}.json"
                current_stage = f"snapshot-{index}-sync"
                loss_path = loss_paths[index]
                original_snapshot_post = transport.post
                lost = {"done": False}
                wire_receipts: list[dict[str, object]] = []
                def loss_once(path: str, body: dict[str, object], *, token: str | None = None) -> dict[str, object]:
                    response = original_snapshot_post(path, body, token=token)
                    if path == "/api/conector/remessa" or path.endswith("/lote") or path.endswith("/fim"):
                        wire_receipts.append({
                            "path": path,
                            "requestKey": body.get("chaveRequisicao"),
                            "deliveryId": response.get("remessaId"),
                            "status": response.get("status"),
                        })
                    if not lost["done"] and (path == loss_path or (loss_path == "/lote" and path.endswith("/lote")) or (loss_path == "/fim" and path.endswith("/fim"))):
                        lost["done"] = True
                        raise TransportError("perda de recibo injetada após HTTP real")
                    return response
                transport.post = loss_once  # type: ignore[method-assign]
                try:
                    snapshot_client.sync(consent, device_id=device_id)
                except TransportError as exc:
                    if "perda de recibo injetada" not in str(exc):
                        raise
                    snapshot_client = LocalConnectorClient(transport, vault=vault,
                                                           state=LocalState(snapshot_state_path))
                    state_before_resume = LocalState(snapshot_state_path).load()
                    snapshot_results.append(snapshot_client.sync(consent, device_id=device_id))
                    state_after_resume = LocalState(snapshot_state_path).load()
                else:
                    raise RuntimeError("perda de recibo fixture não foi injetada")
                transport.post = original_snapshot_post  # type: ignore[method-assign]
                keys = {item["requestKey"] for item in wire_receipts if isinstance(item["requestKey"], str) and item["requestKey"]}
                deliveries = {item["deliveryId"] for item in wire_receipts if isinstance(item["deliveryId"], str) and item["deliveryId"]}
                if (len(keys) != 1 or len(deliveries) != 1 or wire_receipts[-1]["status"] != "concluida" or
                        not isinstance(state_before_resume.get("requestKey"), str) or
                        not isinstance(state_after_resume.get("requestKey"), str) or
                        state_before_resume.get("requestKey") not in keys or
                        state_after_resume.get("requestKey") != state_before_resume.get("requestKey") or
                        (loss_path != "/api/conector/remessa" and state_before_resume.get("deliveryId") not in deliveries) or
                        state_after_resume.get("deliveryId") not in deliveries):
                    raise RuntimeError("recibos HTTP não conservaram chave/remessa única após perda injetada")
            (root / "docs" / "fixture.md").unlink()
            report = snapshot_source(root, source)
            consent = approve_snapshot(root, report.as_dict(), target_url=args.api, org_id=payload["orgId"],
                                       device_id=device_id, source_id=source["id"],
                                       scope_version=source["escopoVersao"], source_config=source,
                                       previous=previous_consent,
                                       approve_new=False, approve_changed=False,
                                       absence_rule=source["regraExclusao"])
            snapshot_client = LocalConnectorClient(transport, vault=vault,
                                                   state=LocalState(Path(directory).resolve() / "snapshot-empty.json"))
            current_stage = "snapshot-empty-sync"
            snapshot_results.append(snapshot_client.sync(consent, device_id=device_id))
            serialized_bodies = json.dumps(captured_bodies, ensure_ascii=False)
            if str(root) in serialized_bodies:
                raise RuntimeError("a raiz local não pode atravessar o request")
            print(json.dumps({"marker": "PYTHON_SNAPSHOT_SMOKE_OK", "statuses": [item["status"] for item in snapshot_results]}))
            return 0
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
