"""Leitura POSIX ancorada em descritores, sem seguir links ou TOCTOU simples."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import stat


class SecureReadError(RuntimeError):
    pass


class UnsupportedPlatform(SecureReadError):
    pass


class ApprovedVersionMismatch(SecureReadError):
    pass


def validate_relative(relative: str) -> list[str]:
    if not relative or relative.startswith(("/", "\\")) or "\\" in relative:
        raise SecureReadError("caminho relativo inválido")
    parts = relative.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise SecureReadError("caminho relativo inválido")
    return parts


def _signature(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _open_flags(*, directory: bool = False) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    if directory:
        flags |= getattr(os, "O_DIRECTORY", 0)
    return flags


def _open_anchored_root(root_path: Path) -> tuple[int, list[tuple[int, tuple[int, int, int, int, int]]]]:
    """Abre desde ``/`` para que nenhum ancestral seja resolvido por caminho."""
    current = os.open(os.sep, _open_flags(directory=True))
    opened_fds = [current]
    try:
        tracked: list[tuple[int, tuple[int, int, int, int, int]]] = [(current, _signature(os.fstat(current)))]
        for part in root_path.parts[1:]:
            parent_before = os.fstat(current)
            child = os.open(part, _open_flags(directory=True), dir_fd=current)
            # Registre o descritor antes de qualquer fstat: falha de fstat não
            # pode deixar o componente recém-aberto vivo.
            opened_fds.append(child)
            parent_after = os.fstat(current)
            if _signature(parent_before) != _signature(parent_after):
                raise SecureReadError("ancestral mudou durante a abertura da raiz")
            child_stat = os.fstat(child)
            if not stat.S_ISDIR(child_stat.st_mode):
                raise SecureReadError("raiz local não é diretório")
            tracked.append((child, _signature(child_stat)))
            current = child
        return current, tracked
    except Exception:
        for fd in reversed(opened_fds):
            try:
                os.close(fd)
            except OSError:
                pass
        raise


def read_secure(root: str | os.PathLike[str], relative: str, *, max_bytes: int,
                expected_size: int | None = None, expected_mtime_ns: int | None = None,
                expected_raw_sha256: str | None = None) -> tuple[bytes, os.stat_result]:
    """Lê um arquivo sob ``root`` e verifica identidade de todos os diretórios.

    Windows não entra neste caminho até haver um leitor equivalente validado.
    O retorno inclui o ``stat`` final para que o chamador registre a versão sem
    guardar conteúdo no estado local.
    """
    if os.name != "posix":
        raise UnsupportedPlatform("leitor seguro não validado nesta plataforma")
    if max_bytes < 1:
        raise ValueError("limite inválido")
    parts = validate_relative(relative)
    root_path = Path(root)
    if not root_path.is_absolute():
        raise SecureReadError("raiz local precisa ser absoluta")

    fds: list[tuple[int, tuple[int, int, int, int, int]]] = []
    opened_fds: list[int] = []
    current = -1
    try:
        current, anchored = _open_anchored_root(root_path)
        fds.extend(anchored)
        opened_fds.extend(fd for fd, _ in anchored)
        root_stat = os.fstat(current)
        if not stat.S_ISDIR(root_stat.st_mode):
            raise SecureReadError("raiz local não é diretório")

        for part in parts[:-1]:
            parent_before = os.fstat(current)
            child = os.open(part, _open_flags(directory=True), dir_fd=current)
            opened_fds.append(child)
            parent_after = os.fstat(current)
            if _signature(parent_before) != _signature(parent_after):
                raise SecureReadError("ancestral mudou durante a abertura")
            child_stat = os.fstat(child)
            if not stat.S_ISDIR(child_stat.st_mode):
                raise SecureReadError("componente não é diretório")
            fds.append((child, _signature(child_stat)))
            current = child

        parent_before = os.fstat(current)
        file_fd = os.open(parts[-1], _open_flags() | getattr(os, "O_NONBLOCK", 0), dir_fd=current)
        opened_fds.append(file_fd)
        parent_after = os.fstat(current)
        if _signature(parent_before) != _signature(parent_after):
            raise SecureReadError("ancestral mudou durante a abertura")
        fds.append((file_fd, _signature(os.fstat(file_fd))))
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode):
            raise SecureReadError("seleção não é arquivo regular")
        if before.st_size > max_bytes:
            raise SecureReadError("arquivo excede o limite local")
        if expected_size is not None and before.st_size != expected_size:
            raise ApprovedVersionMismatch("tamanho do arquivo mudou após a prévia")
        if expected_mtime_ns is not None and before.st_mtime_ns != expected_mtime_ns:
            raise ApprovedVersionMismatch("versão do arquivo mudou após a prévia")

        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(file_fd, min(1024 * 1024, max_bytes - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise SecureReadError("arquivo excede o limite local")
            chunks.append(chunk)
        data = b"".join(chunks)
        after = os.fstat(file_fd)
        if _signature(before) != _signature(after):
            raise ApprovedVersionMismatch("arquivo mudou durante a leitura")
        for fd, signature in fds:
            if _signature(os.fstat(fd)) != signature:
                raise ApprovedVersionMismatch("ancestral mudou durante a leitura")
        if expected_raw_sha256 and hashlib.sha256(data).hexdigest() != expected_raw_sha256:
            raise ApprovedVersionMismatch("hash bruto não coincide com a aprovação")
        return data, after
    except FileNotFoundError as exc:
        raise SecureReadError("arquivo não encontrado sob a raiz aprovada") from exc
    except OSError as exc:
        raise SecureReadError("não foi possível ler a seleção com segurança") from exc
    finally:
        for fd in reversed(opened_fds):
            try:
                os.close(fd)
            except OSError:
                pass
