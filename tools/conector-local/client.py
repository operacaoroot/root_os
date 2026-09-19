"""Cliente local mínimo do receptor de conector.

O cliente conhece apenas a fonte lógica recebida pelo servidor. A raiz absoluta
fica no estado local; requests carregam caminhos relativos e conteúdo aprovado.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener
import uuid

from secure_reader import ApprovedVersionMismatch, SecureReadError, read_secure
from secure_reader import _open_anchored_root
from secure_store import SecureStoreError, Vault, open_system_vault


MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_BATCH_BYTES = 10 * 1024 * 1024
MAX_WIRE_BYTES = 12 * 1024 * 1024
MAX_ITEMS = 100
ALLOWED_EXTENSIONS = {".md", ".txt", ".csv"}


class ClientError(RuntimeError):
    pass


class ConsentRequired(ClientError):
    pass


class TokenUnavailable(ClientError):
    pass


class TransportError(ClientError):
    pass


_JS_TRIM = "\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"


def normalize_body(text: str) -> str:
    import re
    normalized = text.replace("\r\n", "\n")
    return re.sub(f"^[{_JS_TRIM}]+|[{_JS_TRIM}]+$", "", normalized)


def api_hash(text: str) -> str:
    return hashlib.sha256(normalize_body(text).encode("utf-8")).hexdigest()


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str | None = None) -> None:
        return None


class HttpTransport:
    """HTTPS-only transport with a hard body/response limit and no redirects."""

    def __init__(self, base_url: str, *, token: str | None = None, timeout: float = 15,
                 allow_http_test: bool = False, opener: Any | None = None) -> None:
        parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(base_url)
        if parsed.scheme == "http":
            if not allow_http_test or parsed.hostname != "127.0.0.1":
                raise TransportError("HTTP só é permitido explicitamente para 127.0.0.1 em teste")
        elif parsed.scheme != "https":
            raise TransportError("URL do conector precisa usar HTTPS")
        if parsed.username or parsed.password or not parsed.hostname:
            raise TransportError("URL do conector não pode conter credenciais")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.opener = opener or build_opener(HTTPSHandler(), _NoRedirect())

    def post(self, path: str, body: dict[str, Any], *, token: str | None = None) -> dict[str, Any]:
        payload = _json_bytes(body)
        if len(payload) > MAX_WIRE_BYTES:
            raise TransportError("request excede o teto de wire")
        bearer = self.token if token is None else token
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        request = Request(f"{self.base_url}{path}", data=payload, headers=headers, method="POST")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_WIRE_BYTES + 1)
                if len(raw) > MAX_WIRE_BYTES:
                    raise TransportError("resposta excede o teto de wire")
                status = getattr(response, "status", 200)
                if status < 200 or status >= 300:
                    raise TransportError(f"servidor recusou a operação (HTTP {status})")
        except HTTPError as exc:
            # Não devolver corpo da resposta, que poderia conter dados sensíveis.
            exc.close()
            raise TransportError(f"servidor recusou a operação (HTTP {exc.code})") from None
        except (URLError, TimeoutError, OSError) as exc:
            raise TransportError("não foi possível concluir a chamada segura") from exc
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise TransportError("resposta inválida do servidor") from exc
        if not isinstance(parsed, dict):
            raise TransportError("resposta inválida do servidor")
        return parsed


def _safe_json(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in {"token", "secret", "password", "senha", "body", "texto", "content"}:
                raise ClientError("estado local não pode conter segredo ou conteúdo")
            _safe_json(child)
    elif isinstance(value, list):
        for child in value:
            _safe_json(child)


def _glob_regex(pattern: str) -> re.Pattern[str]:
    """Traduz o glob do receptor sem deixar * ou ? virarem regex livre."""
    out: list[str] = []
    index = 0
    while index < len(pattern):
        if pattern.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
        elif pattern.startswith("**", index):
            out.append(".*")
            index += 2
        elif pattern[index] == "*":
            out.append("[^/]*")
            index += 1
        elif pattern[index] == "?":
            out.append("[^/]")
            index += 1
        else:
            out.append(re.escape(pattern[index]))
            index += 1
    return re.compile("^" + "".join(out) + "$", re.ASCII)


def _glob_matches(path: str, pattern: str) -> bool:
    return bool(_glob_regex(pattern).fullmatch(path))


def _validate_source_filter(path: str, config: dict[str, Any]) -> None:
    """Aplica localmente o mesmo filtro fechado que o receptor anunciar."""
    if not path or path.startswith("/") or "\\" in path or ".." in path.split("/"):
        raise ConsentRequired("caminho fora da fonte lógica")
    allowed_types = config.get("tiposPermitidos")
    if not isinstance(allowed_types, list) or Path(path).suffix.lower() not in {str(x).lower() for x in allowed_types}:
        raise ConsentRequired("tipo de arquivo fora do escopo da fonte")
    maximum = config.get("tamanhoMaximo")
    if not isinstance(maximum, int) or maximum < 1:
        raise ConsentRequired("limite da fonte inválido")
    includes = config.get("incluir")
    excludes = config.get("excluir")
    if not isinstance(includes, list) or not isinstance(excludes, list):
        raise ConsentRequired("filtros da fonte não comprovados")
    if includes and not any(_glob_matches(path, str(pattern)) for pattern in includes):
        raise ConsentRequired("arquivo fora do filtro de inclusão")
    if any(_glob_matches(path, str(pattern)) for pattern in excludes):
        raise ConsentRequired("arquivo bloqueado pelo filtro de exclusão")
class LocalState:
    """JSON de metadados com permissão 0600; não contém token nem conteúdo."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path).expanduser().absolute()

    def _parent(self) -> tuple[int, list[tuple[int, tuple[int, int, int, int, int]]]]:
        parent = self.path.parent
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            fd, tracked = _open_anchored_root(parent)
        except (OSError, SecureReadError) as exc:
            raise ClientError("diretório do estado não é seguro") from exc
        try:
            info = os.fstat(fd)
        except OSError as exc:
            for tracked_fd, _ in reversed(tracked):
                try:
                    os.close(tracked_fd)
                except OSError:
                    pass
            raise ClientError("diretório do estado não é seguro") from exc
        if os.name == "posix" and (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077):
            for tracked_fd, _ in reversed(tracked):
                os.close(tracked_fd)
            raise ClientError("diretório do estado tem dono/permissões inseguros")
        return fd, tracked

    def load(self) -> dict[str, Any]:
        tracked: list[tuple[int, tuple[int, int, int, int, int]]] = []
        try:
            parent_fd, tracked = self._parent()
            fd = os.open(self.path.name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), dir_fd=parent_fd)
        except FileNotFoundError:
            for tracked_fd, _ in reversed(tracked):
                try:
                    os.close(tracked_fd)
                except OSError:
                    pass
            return {}
        except OSError as exc:
            for tracked_fd, _ in reversed(tracked):
                try:
                    os.close(tracked_fd)
                except OSError:
                    pass
            raise ClientError("estado local não está disponível com segurança") from exc
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077)):
                raise ClientError("estado local tem dono/permissão inseguros")
            with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as handle:
                value = json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ClientError("estado local inválido") from exc
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
            for tracked_fd, _ in reversed(tracked):
                try:
                    os.close(tracked_fd)
                except OSError:
                    pass
        if not isinstance(value, dict):
            raise ClientError("estado local inválido")
        _safe_json(value)
        return value

    def save(self, value: dict[str, Any]) -> None:
        _safe_json(value)
        parent_fd, tracked = self._parent()
        temp_name = f".{self.path.name}.{secrets.token_hex(12)}"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(temp_name, flags, 0o600, dir_fd=parent_fd)
        except OSError as exc:
            for tracked_fd, _ in reversed(tracked):
                os.close(tracked_fd)
            raise ClientError("não foi possível criar estado local seguro") from exc
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8", closefd=False) as handle:
                json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        except OSError as exc:
            raise ClientError("não foi possível salvar o estado local com segurança") from exc
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
            try:
                os.unlink(temp_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
            for tracked_fd, _ in reversed(tracked):
                try:
                    os.close(tracked_fd)
                except OSError:
                    pass


@dataclass(frozen=True)
class ApprovedFile:
    path: str
    size: int
    modified_ns: int
    raw_sha256: str


@dataclass(frozen=True)
class Consent:
    root: str
    target_url: str
    org_id: str
    device_id: str
    source_id: str
    scope_version: int
    mode: str
    destination: str
    source_config: dict[str, Any]
    files: tuple[ApprovedFile, ...]

    def fingerprint(self) -> str:
        data = {
            "root": self.root, "target": self.target_url, "org": self.org_id, "device": self.device_id,
            "source": self.source_id, "scope": self.scope_version, "mode": self.mode,
            "destination": self.destination, "sourceConfig": self.source_config,
            "files": [file.__dict__ for file in self.files],
        }
        return hashlib.sha256(_json_bytes(data)).hexdigest()


@dataclass(frozen=True)
class SnapshotConsent:
    root: str
    target_url: str
    org_id: str
    device_id: str
    source_id: str
    scope_version: int
    destination: str
    source_config: dict[str, Any]
    snapshot: dict[str, Any]
    files: tuple[ApprovedFile, ...]
    new: tuple[str, ...]
    changed: tuple[str, ...]
    absent: tuple[str, ...]
    absence_rule: str
    approve_new: bool
    approve_changed: bool

    @property
    def mode(self) -> str:
        return "sincronizacao"

    def fingerprint(self) -> str:
        data = {
            "root": self.root, "target": self.target_url, "org": self.org_id,
            "device": self.device_id, "source": self.source_id, "scope": self.scope_version,
            "destination": self.destination, "sourceConfig": self.source_config,
            "snapshot": self.snapshot, "new": self.new, "changed": self.changed,
            "absent": self.absent, "absenceRule": self.absence_rule,
            "approveNew": self.approve_new, "approveChanged": self.approve_changed,
            "files": [file.__dict__ for file in self.files],
        }
        return hashlib.sha256(_json_bytes(data)).hexdigest()


def approve_snapshot(root: str | os.PathLike[str], snapshot: dict[str, Any], *, target_url: str,
                     org_id: str, device_id: str, source_id: str, scope_version: int,
                     source_config: dict[str, Any], previous: dict[str, Any] | None = None,
                     approve_new: bool = False, approve_changed: bool = False,
                     absence_rule: str = "ignorar", destination: str = "agente_externo") -> SnapshotConsent:
    """Congela uma varredura integral; aprovação de novos/alterados é separada."""
    from snapshot import compare_snapshots, stable_source_config
    if destination != "agente_externo":
        raise ConsentRequired("destino não comprovado pelo produto")
    if not snapshot.get("complete") or source_config.get("modo") != "sincronizacao":
        raise ConsentRequired("snapshot incompleto ou fonte fora do modo sincronizacao")
    if absence_rule not in {"ignorar", "arquivar"}:
        raise ConsentRequired("regra de ausência inválida")
    source_config = stable_source_config(source_config)
    if snapshot.get("sourceConfig") != source_config or snapshot.get("root") != str(Path(root).expanduser().absolute()):
        raise ConsentRequired("snapshot não corresponde à fonte local aprovada")
    previous_manifest = (previous or {}).get("snapshot") if previous else None
    if previous and (not isinstance(previous_manifest, dict) or
                     previous_manifest.get("root") != snapshot.get("root") or
                     previous_manifest.get("sourceConfig") != source_config):
        raise ConsentRequired("snapshot anterior pertence a outra fonte local")
    envelope = (previous or {}).get("consentEnvelope")
    expected_envelope = {"target_url": target_url, "org_id": org_id, "device_id": device_id,
                         "source_id": source_id, "scope_version": scope_version}
    if previous and (not isinstance(envelope, dict) or envelope != expected_envelope or
                     not isinstance(previous_manifest, dict)):
        raise ConsentRequired("snapshot anterior não pertence ao mesmo consentimento")
    if source_config.get("id") != source_id or source_config.get("escopoVersao") != scope_version:
        raise ConsentRequired("configuração da fonte não corresponde ao escopo aprovado")
    changes = compare_snapshots(type("SnapshotView", (), {"files": tuple(
        ApprovedFile(str(item["path"]), int(item["size"]), int(item["modifiedNs"]), str(item["rawSha256"]))
        for item in snapshot.get("files", [])
    )})(), previous_manifest)
    if absence_rule != source_config.get("regraExclusao"):
        raise ConsentRequired("regra de ausência diverge da fonte aprovada")
    if changes["new"] and not approve_new:
        raise ConsentRequired("arquivos novos exigem aprovação separada")
    if changes["changed"] and not approve_changed:
        raise ConsentRequired("arquivos alterados exigem aprovação separada")
    files = tuple(ApprovedFile(str(item["path"]), int(item["size"]), int(item["modifiedNs"]), str(item["rawSha256"]))
                  for item in snapshot.get("files", []))
    return SnapshotConsent(str(Path(root).expanduser().absolute()), target_url, org_id, device_id,
                           source_id, int(scope_version), destination, dict(source_config), dict(snapshot),
                           files, tuple(changes["new"]), tuple(changes["changed"]), tuple(changes["absent"]),
                           absence_rule, approve_new, approve_changed)


def approve_selection(root: str | os.PathLike[str], preview: dict[str, Any], *, target_url: str,
                      org_id: str, device_id: str, source_id: str, scope_version: int, mode: str,
                      source_config: dict[str, Any],
                      destination: str = "agente_externo") -> Consent:
    """Cria consentimento separado após reler e hashear cada arquivo aprovado."""
    if destination != "agente_externo":
        raise ConsentRequired("destino não comprovado pelo produto")
    if not preview.get("complete") or not preview.get("authorizesUpload") is False:
        raise ConsentRequired("prévia incompleta não pode virar consentimento")
    root_path = Path(root).expanduser().absolute()
    if mode != "importacao":
        raise ConsentRequired("sincronização automática ainda não foi validada; use importação aprovada")
    required_config = ("id", "tipo", "raizLogica", "incluir", "excluir", "tiposPermitidos", "modo", "regraExclusao", "tamanhoMaximo", "escopoVersao")
    if not isinstance(source_config, dict) or any(key not in source_config for key in required_config):
        raise ConsentRequired("configuração completa da fonte é obrigatória")
    stable_config = {key: source_config.get(key) for key in required_config}
    if stable_config.get("id") != source_id or stable_config.get("escopoVersao") != scope_version:
        raise ConsentRequired("configuração da fonte não corresponde ao escopo aprovado")
    if stable_config.get("modo") != mode:
        raise ConsentRequired("modo da fonte mudou")
    approved: list[ApprovedFile] = []
    for entry in preview.get("files", []):
        path = str(entry.get("path", ""))
        _validate_source_filter(path, stable_config)
        raw, info = read_secure(root_path, path, max_bytes=MAX_FILE_BYTES)
        if len(raw) > stable_config["tamanhoMaximo"]:
            raise ConsentRequired("arquivo excede o limite da fonte")
        if len(raw) != int(entry.get("size", -1)) or info.st_mtime_ns != int(entry.get("modifiedNs", -1)):
            raise ConsentRequired("arquivo mudou desde a prévia")
        approved.append(ApprovedFile(path, len(raw), info.st_mtime_ns, hashlib.sha256(raw).hexdigest()))
    return Consent(str(root_path), target_url, org_id, device_id, source_id, int(scope_version), mode, destination, stable_config, tuple(approved))


def _mime(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ConsentRequired("extensão não autorizada")
    return {".md": "text/markdown", ".txt": "text/plain", ".csv": "text/csv"}[ext]


class LocalConnectorClient:
    def __init__(self, transport: HttpTransport, *, vault: Vault, state: LocalState,
                 reader: Callable[..., tuple[bytes, os.stat_result]] = read_secure) -> None:
        self.transport = transport
        self.vault = vault
        self.state = state
        self.reader = reader

    @classmethod
    def production(cls, base_url: str, state_path: str, *, allow_http_test: bool = False) -> "LocalConnectorClient":
        vault = open_system_vault()
        return cls(HttpTransport(base_url, allow_http_test=allow_http_test), vault=vault, state=LocalState(state_path))

    def _token_key(self, device_id: str) -> str:
        origin = hashlib.sha256(self.transport.base_url.rstrip("/").encode("utf-8")).hexdigest()[:32]
        return f"device-token-{origin}-{hashlib.sha256(device_id.encode('utf-8')).hexdigest()[:32]}"

    def _token(self, device_id: str) -> str:
        try:
            token = self.vault.get(self._token_key(device_id))
        except Exception as exc:
            raise TokenUnavailable("cofre não disponível") from exc
        if not token:
            raise TokenUnavailable("token do dispositivo indisponível")
        return token

    def pair(self, *, org_id: str, pairing_id: str, code: str, name: str) -> dict[str, Any]:
        if not code or not name.strip():
            raise ClientError("pareamento incompleto")
        response = self.transport.post("/api/conector/pareamento", {
            "orgId": org_id, "pairingId": pairing_id, "code": code, "nomeDispositivo": name,
        }, token=None)
        token = response.get("token")
        device_id = response.get("id")
        returned_org = response.get("orgId")
        expected_prefix = f"rcon1.{org_id}.{device_id}." if isinstance(device_id, str) else ""
        if (not isinstance(token, str) or not token or not isinstance(device_id, str) or not device_id or
                returned_org != org_id or not token.startswith(expected_prefix)):
            raise ClientError("pareamento não devolveu credencial válida")
        try:
            self.vault.set(self._token_key(device_id), token)
        except Exception as exc:
            raise TokenUnavailable("não foi possível guardar token no cofre") from exc
        return {"id": device_id, "orgId": response.get("orgId"), "nome": response.get("nome")}

    def pulse(self, *, device_id: str, version: str = "rootos-local-1") -> dict[str, Any]:
        token = self._token(device_id)
        response = self.transport.post("/api/conector/pulso", {
            "versao": version, "so": os.name, "usuarioLocal": "local", "relogio": _utc_now(),
        }, token=token)
        if response.get("revogado"):
            raise ConsentRequired("dispositivo/fonte revogado pelo servidor")
        return response

    def sync(self, consent: Consent, *, device_id: str, request_key: str | None = None,
             batch_size: int = MAX_ITEMS) -> dict[str, Any]:
        if consent.destination != "agente_externo":
            raise ConsentRequired("destino não autorizado")
        if consent.target_url.rstrip("/") != self.transport.base_url.rstrip("/"):
            raise ConsentRequired("destino da aprovação diverge da API selecionada")
        if consent.device_id != device_id:
            raise ConsentRequired("dispositivo diverge do consentimento")
        is_snapshot = isinstance(consent, SnapshotConsent)
        if consent.mode != "importacao" and not is_snapshot:
            raise ConsentRequired("sincronização ainda não foi validada; use importação aprovada")
        if is_snapshot:
            expected_files = tuple(ApprovedFile(str(item.get("path")), int(item.get("size")),
                                           int(item.get("modifiedNs")), str(item.get("rawSha256")))
                             for item in consent.snapshot.get("files", []) if isinstance(item, dict))
            if not consent.snapshot.get("complete") or not isinstance(consent.approve_new, bool) or not isinstance(consent.approve_changed, bool) or consent.files != expected_files:
                raise ConsentRequired("consentimento de snapshot não corresponde ao manifesto")
            if consent.absence_rule != consent.source_config.get("regraExclusao"):
                raise ConsentRequired("regra de ausência diverge da fonte aprovada")
            if consent.new and not consent.approve_new:
                raise ConsentRequired("arquivos novos não foram aprovados")
            if consent.changed and not consent.approve_changed:
                raise ConsentRequired("arquivos alterados não foram aprovados")
            if not consent.snapshot.get("complete"):
                raise ConsentRequired("snapshot incompleto não pode ser enviado")
        if os.name != "posix":
            raise ConsentRequired("envio bloqueado: leitor seguro Windows ainda não validado")
        if not consent.files and not is_snapshot:
            raise ConsentRequired("seleção vazia não pode abrir remessa")
        if batch_size < 1 or batch_size > MAX_ITEMS:
            raise ClientError("tamanho de lote inválido")
        state = self.state.load()
        fingerprint = consent.fingerprint()
        if state and state.get("consentFingerprint") not in {None, fingerprint}:
            raise ConsentRequired("escopo/destino/seleção mudou; aprovação nova obrigatória")
        pulse = self.pulse(device_id=device_id)
        source = next((item for item in pulse.get("fontes", []) if item.get("id") == consent.source_id), None)
        stable_source = {key: source.get(key) for key in ("id", "tipo", "raizLogica", "incluir", "excluir", "tiposPermitidos", "modo", "regraExclusao", "tamanhoMaximo", "escopoVersao")} if source else None
        if (not source or stable_source != consent.source_config or source.get("revokedAt") is not None):
            raise ConsentRequired("fonte ou versão de escopo não está autorizada no pulso")
        if is_snapshot:
            from snapshot import snapshot_source
            current = snapshot_source(consent.root, consent.source_config)
            if not current.complete or current.as_dict() != consent.snapshot:
                raise ConsentRequired("árvore mudou desde a prévia; snapshot e aprovação novos são obrigatórios")
        sent = set(state.get("sent", [])) if state else set()
        if request_key is None:
            request_key = state.get("requestKey") if state else None
        request_key = request_key or uuid.uuid4().hex
        delivery_id = state.get("deliveryId") if state else None
        base_state = {"version": 1, "deviceId": device_id, "orgId": consent.org_id,
                      "sourceId": consent.source_id, "scopeVersion": consent.scope_version,
                      "consentFingerprint": fingerprint, "requestKey": request_key,
                      "sent": sorted(sent)}
        # Persistir a chave antes de qualquer abertura torna timeout/reexecução idempotente.
        self.state.save(base_state)
        if not delivery_id:
            opened = self.transport.post("/api/conector/remessa", {
                "fonteId": consent.source_id, "modo": consent.mode, "chaveRequisicao": request_key,
            }, token=self._token(device_id))
            delivery_id = opened.get("remessaId")
            if not isinstance(delivery_id, str) or opened.get("fonteId") != consent.source_id:
                raise TransportError("abertura de remessa inválida")
            base_state["deliveryId"] = delivery_id
            self.state.save(base_state)
        else:
            base_state["deliveryId"] = delivery_id
            self.state.save(base_state)

        # Primeira passagem: revalida toda a seleção sem manter conteúdo em memória.
        # A segunda passagem envia no máximo um lote; uma mudança entre passagens
        # falha fechada pelo mesmo leitor/versionamento.
        read_root = (str(Path(consent.root).parent)
                     if is_snapshot and consent.source_config.get("tipo") == "arquivo" else consent.root)
        for approved in consent.files:
            read_path = (Path(approved.path).name
                         if is_snapshot and consent.source_config.get("tipo") == "arquivo" else approved.path)
            raw, info = self.reader(read_root, read_path, max_bytes=MAX_FILE_BYTES,
                                    expected_size=approved.size, expected_mtime_ns=approved.modified_ns,
                                    expected_raw_sha256=approved.raw_sha256)
            if len(raw) > consent.source_config["tamanhoMaximo"]:
                raise ConsentRequired("arquivo excede o limite da fonte")
            try:
                raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ConsentRequired("arquivo não é UTF-8 aprovado") from exc

        def item_for(approved: ApprovedFile) -> tuple[dict[str, Any], int]:
            read_path = (Path(approved.path).name
                         if is_snapshot and consent.source_config.get("tipo") == "arquivo" else approved.path)
            raw, _ = self.reader(read_root, read_path, max_bytes=MAX_FILE_BYTES,
                                 expected_size=approved.size, expected_mtime_ns=approved.modified_ns,
                                 expected_raw_sha256=approved.raw_sha256)
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ConsentRequired("arquivo não é UTF-8 aprovado") from exc
            return ({"caminhoRelativo": approved.path, "texto": text,
                     "hashConteudo": api_hash(text), "tamanho": len(raw), "mime": _mime(approved.path)}, len(raw))

        pending: list[dict[str, Any]] = []
        pending_paths: list[str] = []
        pending_bytes = 0
        for approved in consent.files:
            if approved.path in sent:
                continue
            item, raw_size = item_for(approved)
            candidate = pending + [item]
            wire = _json_bytes({"itens": candidate})
            bytes_total = pending_bytes + raw_size
            if len(_json_bytes({"itens": [item]})) > MAX_WIRE_BYTES:
                raise ConsentRequired("item excede o limite de wire do receptor")
            if pending and (len(candidate) > batch_size or bytes_total > MAX_BATCH_BYTES or len(wire) > MAX_WIRE_BYTES):
                base_state["pending"] = {"paths": pending_paths}
                self.state.save(base_state)
                self.pulse(device_id=device_id)
                self._send_batch(delivery_id, pending, device_id)
                sent.update(pending_paths)
                base_state["sent"] = sorted(sent)
                base_state.pop("pending", None)
                self.state.save(base_state)
                pending, pending_paths, pending_bytes = [], [], 0
            pending.append(item)
            pending_paths.append(approved.path)
            pending_bytes += raw_size
        if pending:
            base_state["pending"] = {"paths": pending_paths}
            self.state.save(base_state)
            self.pulse(device_id=device_id)
            self._send_batch(delivery_id, pending, device_id)
            sent.update(pending_paths)
            base_state["sent"] = sorted(sent)
            base_state.pop("pending", None)
            self.state.save(base_state)
        if sent != {file.path for file in consent.files}:
            raise ConsentRequired("nem todos os recibos foram confirmados; fim bloqueado")
        if is_snapshot:
            from snapshot import snapshot_source
            current = snapshot_source(consent.root, consent.source_config)
            if not current.complete or current.as_dict() != consent.snapshot:
                raise ConsentRequired("árvore mudou antes do fim; snapshot não foi concluído")
        self.pulse(device_id=device_id)
        result = self.transport.post(f"/api/conector/remessa/{delivery_id}/fim", {
            "itensVistos": [{"caminhoRelativo": file.path} for file in consent.files],
            "itensEnviados": len(consent.files), "erros": [], "manifestoCompleto": True,
        }, token=self._token(device_id))
        if (result.get("remessaId") != delivery_id or result.get("fonteId") != consent.source_id or
                result.get("status") != "concluida" or result.get("snapshotCompleto") is not True or
                result.get("itensEnviados") != len(consent.files) or
                result.get("itensVistos") != len(consent.files) or result.get("erros") != 0):
            raise TransportError("servidor não confirmou remessa completa")
        base_state.update({"status": result.get("status", "concluida"), "sent": sorted(sent)})
        self.state.save(base_state)
        return {"remessaId": delivery_id, "status": result.get("status"), "itens": len(sent)}

    def _send_batch(self, delivery_id: str, items: list[dict[str, Any]], device_id: str) -> dict[str, Any]:
        response = self.transport.post(
            f"/api/conector/remessa/{delivery_id}/lote", {"itens": items}, token=self._token(device_id)
        )
        if response.get("remessaId") != delivery_id:
            raise TransportError("recibo de lote pertence a outra remessa")
        accepted = response.get("aceitos")
        duplicates = response.get("duplicados")
        if (not isinstance(accepted, int) or isinstance(accepted, bool) or
                not isinstance(duplicates, int) or isinstance(duplicates, bool) or
                accepted < 0 or duplicates < 0 or accepted + duplicates != len(items)):
            raise TransportError("recibo de lote inválido")
        return response


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_system_client(base_url: str, state_path: str, *, allow_http_test: bool = False) -> LocalConnectorClient:
    return LocalConnectorClient.production(base_url, state_path, allow_http_test=allow_http_test)
