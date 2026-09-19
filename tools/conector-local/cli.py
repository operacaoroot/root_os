#!/usr/bin/env python3
"""CLI seguro do conector local; não imprime nem recebe bearer em argv."""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import warnings

from client import ClientError, Consent, LocalConnectorClient, LocalState, approve_selection
from preview import preview
from secure_reader import ApprovedVersionMismatch, SecureReadError
from secure_store import SecureStoreError


def _write_json(path: str, value: dict) -> None:
    LocalState(path).save(value)


def _read_json(path: str) -> dict:
    value = LocalState(path).load()
    if not value:
        raise SystemExit("arquivo JSON local ausente ou vazio")
    return value


def _source_json(path: str, source_id: str) -> dict:
    value = _read_json(path)
    if isinstance(value.get("fontes"), list):
        matches = [item for item in value["fontes"] if isinstance(item, dict) and item.get("id") == source_id]
        if len(matches) != 1:
            raise SystemExit("fonte não encontrada de forma única no pulso")
        return matches[0]
    return value


def _consent(value: dict) -> Consent:
    try:
        files = tuple(
            __import__("client", fromlist=["ApprovedFile"]).ApprovedFile(
                str(item["path"]), int(item["size"]), int(item["modified_ns"]), str(item["raw_sha256"]),
            ) for item in value["files"]
        )
        return Consent(str(value["root"]), str(value["target_url"]), str(value["org_id"]),
                       str(value["device_id"]), str(value["source_id"]), int(value["scope_version"]),
                       str(value["mode"]), str(value["destination"]), dict(value["source_config"]), files)
    except (KeyError, TypeError, ValueError) as exc:
        raise SystemExit("consentimento local inválido") from exc


def _approval_summary(value: Consent) -> dict:
    config = value.source_config
    return {
        "api": value.target_url,
        "orgId": value.org_id,
        "deviceId": value.device_id,
        "fonte": {
            "id": value.source_id,
            "tipo": config["tipo"],
            "raizLogica": config["raizLogica"],
            "incluir": config["incluir"],
            "excluir": config["excluir"],
            "tiposPermitidos": config["tiposPermitidos"],
            "tamanhoMaximo": config["tamanhoMaximo"],
            "modo": config["modo"],
            "regraExclusao": config["regraExclusao"],
            "escopoVersao": config["escopoVersao"],
        },
        "destino": value.destination,
        "arquivos": [{"path": item.path, "bytes": item.size} for item in value.files],
    }


def _confirm(summary: dict) -> None:
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    try:
        answer = input("Confirma esta importação? Digite 'sim' para continuar: ")
    except (EOFError, KeyboardInterrupt) as exc:
        raise ClientError("confirmação humana não recebida") from exc
    if answer.strip().casefold() != "sim":
        raise ClientError("importação não confirmada")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--api", required=True, help="URL da API HTTPS; HTTP só com --allow-http-test")
    root.add_argument("--allow-http-test", action="store_true", help="permite HTTP somente para 127.0.0.1")
    root.add_argument("--state", default=str(Path.home() / ".config/rootos-conector/state.json"))
    sub = root.add_subparsers(dest="command", required=True)
    p = sub.add_parser("preview"); p.add_argument("source"); p.add_argument("--recursive", action="store_true"); p.add_argument("--exclude", action="append", default=[]); p.add_argument("--extension", action="append"); p.add_argument("--max-bytes", type=int, default=5 * 1024 * 1024); p.add_argument("--max-entries", type=int, default=10000); p.add_argument("--max-depth", type=int, default=32); p.add_argument("--output")
    a = sub.add_parser("approve"); a.add_argument("--root", required=True); a.add_argument("--preview-json", required=True); a.add_argument("--output", required=True); a.add_argument("--org-id", required=True); a.add_argument("--device-id", required=True); a.add_argument("--source-id", required=True); a.add_argument("--scope-version", required=True, type=int); a.add_argument("--source-json", required=True, help="JSON da fonte exata recebido no pulso"); a.add_argument("--mode", choices=["importacao", "sincronizacao"], required=True)
    pair = sub.add_parser("pair"); pair.add_argument("--org-id", required=True); pair.add_argument("--pairing-id", required=True); pair.add_argument("--name", required=True)
    pulse = sub.add_parser("pulse"); pulse.add_argument("--device-id", required=True); pulse.add_argument("--output")
    sync = sub.add_parser("sync"); sync.add_argument("--consent", required=True); sync.add_argument("--device-id", required=True); sync.add_argument("--request-key")
    return root


def _run(args: argparse.Namespace) -> int:
    if args.command == "preview":
        value = preview(args.source, recursive=args.recursive, extensions=args.extension or (".md", ".txt", ".csv"), exclude=args.exclude, max_bytes=args.max_bytes, max_entries=args.max_entries, max_depth=args.max_depth)
        if args.output:
            _write_json(args.output, value)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0 if value["complete"] else 3
    if args.command == "approve":
        value = approve_selection(args.root, _read_json(args.preview_json), target_url=args.api, org_id=args.org_id,
                                  device_id=args.device_id, source_id=args.source_id, scope_version=args.scope_version,
                                  mode=args.mode, source_config=_source_json(args.source_json, args.source_id))
        _confirm(_approval_summary(value))
        _write_json(args.output, {"root": value.root, "target_url": value.target_url, "org_id": value.org_id,
                                  "device_id": value.device_id, "source_id": value.source_id,
                                  "scope_version": value.scope_version, "mode": value.mode,
                                  "destination": value.destination, "source_config": value.source_config,
                                  "files": [{"path": file.path, "size": file.size, "modified_ns": file.modified_ns,
                                             "raw_sha256": file.raw_sha256} for file in value.files]})
        print(json.dumps({"approvedFiles": len(value.files), "consentFingerprint": value.fingerprint()}))
        return 0
    if args.command == "pair":
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            try:
                code = getpass.getpass("Código de pareamento (não será exibido): ")
            except getpass.GetPassWarning as exc:
                raise ClientError("prompt sem ocultação segura; pareamento bloqueado") from exc
        client = LocalConnectorClient.production(args.api, args.state, allow_http_test=args.allow_http_test)
        print(json.dumps(client.pair(org_id=args.org_id, pairing_id=args.pairing_id, code=code, name=args.name), ensure_ascii=False))
        return 0
    client = LocalConnectorClient.production(args.api, args.state, allow_http_test=args.allow_http_test)
    if args.command == "pulse":
        response = client.pulse(device_id=args.device_id)
        if args.output:
            _write_json(args.output, response)
        print(json.dumps({"revogado": response.get("revogado"), "fontes": len(response.get("fontes", []))}))
        return 0
    if args.command == "sync":
        result = client.sync(_consent(_read_json(args.consent)), device_id=args.device_id, request_key=args.request_key)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    raise SystemExit("comando desconhecido")


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return _run(args)
    except (ClientError, SecureStoreError, SecureReadError, ApprovedVersionMismatch, OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
