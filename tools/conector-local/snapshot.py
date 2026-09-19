"""Snapshots manuais da fonte inteira; não há relógio nem sincronização automática."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import stat
from typing import Any

from client import MAX_FILE_BYTES, _glob_matches
from secure_reader import SecureReadError, _open_anchored_root, read_secure

STABLE_SOURCE_KEYS = ("id", "tipo", "raizLogica", "incluir", "excluir", "tiposPermitidos",
                      "modo", "regraExclusao", "tamanhoMaximo", "escopoVersao")


def stable_source_config(value: dict[str, Any]) -> dict[str, Any]:
    return {key: value.get(key) for key in STABLE_SOURCE_KEYS}


class SnapshotError(RuntimeError):
    pass


@dataclass(frozen=True)
class SnapshotFile:
    path: str
    size: int
    modified_ns: int
    raw_sha256: str

    def as_dict(self) -> dict[str, Any]:
        return {"path": self.path, "size": self.size, "modifiedNs": self.modified_ns,
                "rawSha256": self.raw_sha256}


@dataclass(frozen=True)
class Snapshot:
    root: str
    source_config: dict[str, Any]
    files: tuple[SnapshotFile, ...]
    complete: bool
    errors: tuple[dict[str, str], ...]
    skipped: tuple[dict[str, str], ...]
    tree_fingerprint: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1, "operation": "snapshot", "complete": self.complete,
            "root": self.root, "sourceConfig": self.source_config,
            "files": [item.as_dict() for item in self.files],
            "errors": list(self.errors), "skipped": list(self.skipped),
            "treeFingerprint": self.tree_fingerprint,
        }


def _sig(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _fingerprint(signatures: dict[str, tuple[int, int, int, int, int]]) -> str:
    encoded = "\n".join(f"{path}|{value}" for path, value in sorted(signatures.items()))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _allowed(path: str, config: dict[str, Any]) -> bool:
    ext = Path(path).suffix.lower()
    allowed = {str(item).lower() for item in config.get("tiposPermitidos", [])}
    if ext not in allowed:
        return False
    includes = config.get("incluir", [])
    excludes = config.get("excluir", [])
    return (not includes or any(_glob_matches(path, str(pattern)) for pattern in includes)) and not any(
        _glob_matches(path, str(pattern)) for pattern in excludes
    )


def snapshot_source(root: str | os.PathLike[str], source_config: dict[str, Any], *, max_entries: int = 10000,
                    max_depth: int = 32) -> Snapshot:
    """Varre toda a fonte anunciada; qualquer lacuna conhecida invalida o snapshot."""
    if os.name != "posix":
        raise SnapshotError("snapshot bloqueado: leitor seguro Windows ainda não foi validado")
    if source_config.get("modo") != "sincronizacao":
        raise SnapshotError("snapshot manual exige fonte em modo sincronizacao")
    if source_config.get("tipo") not in {"pasta", "arquivo"}:
        raise SnapshotError("tipo de fonte não comprovado")
    if max_entries < 1 or max_depth < 0:
        raise SnapshotError("limites do snapshot inválidos")
    root_path = Path(root).expanduser().absolute()
    source_config = stable_source_config(source_config)
    files: list[SnapshotFile] = []
    errors: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    signatures: dict[str, tuple[int, int, int, int, int]] = {}
    visited = 0

    def error(path: str, reason: str) -> None:
        errors.append({"path": path, "reason": reason})

    stopped = False

    def read_file(parent_fd: int, name: str, relative: str, info: os.stat_result) -> None:
        maximum = min(int(source_config.get("tamanhoMaximo", MAX_FILE_BYTES)), MAX_FILE_BYTES)
        if info.st_size > maximum:
            error(relative, "known_skip_file_too_large")
            return
        fd = -1
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                         getattr(os, "O_CLOEXEC", 0), dir_fd=parent_fd)
            before = os.fstat(fd)
            if _sig(before) != _sig(info) or not stat.S_ISREG(before.st_mode):
                error(relative, "unreadable_or_changed")
                return
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = os.read(fd, min(1024 * 1024, maximum - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum:
                    error(relative, "known_skip_file_too_large")
                    return
                chunks.append(chunk)
            after = os.fstat(fd)
            if _sig(before) != _sig(after):
                error(relative, "unreadable_or_changed")
                return
            raw = b"".join(chunks)
            files.append(SnapshotFile(relative, len(raw), after.st_mtime_ns, hashlib.sha256(raw).hexdigest()))
        except OSError:
            error(relative, "unreadable_or_changed")
        finally:
            if fd >= 0:
                os.close(fd)

    def scan_dir(directory_fd: int, relative: str, depth: int) -> None:
        nonlocal visited, stopped
        if stopped:
            return
        if depth >= max_depth:
            error(relative or ".", "depth_limit")
            return
        directory_before = os.fstat(directory_fd)
        try:
            with os.scandir(directory_fd) as entries:
                for entry in entries:
                    if stopped:
                        break
                    visited += 1
                    child_relative = f"{relative}/{entry.name}" if relative else entry.name
                    if visited > max_entries:
                        error(child_relative, "entry_limit")
                        stopped = True
                        break
                    try:
                        info = os.stat(entry.name, dir_fd=directory_fd, follow_symlinks=False)
                        signatures[child_relative] = _sig(info)
                    except OSError:
                        error(child_relative, "unreadable_metadata")
                        continue
                    if stat.S_ISLNK(info.st_mode):
                        error(child_relative, "known_skip_symbolic_link")
                    elif stat.S_ISDIR(info.st_mode):
                        child_fd = -1
                        try:
                            child_fd = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW |
                                               os.O_NONBLOCK |
                                               getattr(os, "O_CLOEXEC", 0), dir_fd=directory_fd)
                            if _sig(os.fstat(child_fd)) != _sig(info):
                                error(child_relative, "tree_changed")
                            scan_dir(child_fd, child_relative, depth + 1)
                        except OSError:
                            error(child_relative, "unreadable_directory")
                        finally:
                            if child_fd >= 0:
                                os.close(child_fd)
                    elif not stat.S_ISREG(info.st_mode):
                        error(child_relative, "known_skip_unsafe_type")
                    elif not _allowed(child_relative, source_config):
                        skipped.append({"path": child_relative, "reason": "outside_source_filters"})
                    else:
                        read_file(directory_fd, entry.name, child_relative, info)
        except OSError:
            error(relative or ".", "unreadable_directory")
        if _sig(os.fstat(directory_fd)) != _sig(directory_before):
            error(relative or ".", "tree_changed")

    try:
        if source_config.get("tipo") == "arquivo":
            parent_fd, tracked = _open_anchored_root(root_path.parent)
            try:
                root_info = os.stat(root_path.name, dir_fd=parent_fd, follow_symlinks=False)
                signatures[root_path.name] = _sig(root_info)
                if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISREG(root_info.st_mode):
                    error(root_path.name, "source_not_regular")
                elif not _allowed(root_path.name, source_config):
                    error(root_path.name, "source_outside_filters")
                else:
                    read_file(parent_fd, root_path.name, root_path.name, root_info)
            finally:
                for tracked_fd, expected in tracked:
                    try:
                        if _sig(os.fstat(tracked_fd)) != expected:
                            error(".", "tree_changed")
                    except OSError:
                        error(".", "tree_changed")
                for tracked_fd, _ in reversed(tracked):
                    try:
                        os.close(tracked_fd)
                    except OSError:
                        pass
            root_info = None
        else:
            root_info = os.stat(root_path, follow_symlinks=False)
            root_fd, tracked = _open_anchored_root(root_path)
            try:
                signatures["."] = _sig(root_info)
                if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
                    error(".", "source_invalid")
                else:
                    scan_dir(root_fd, "", 0)
                for tracked_fd, expected in tracked:
                    try:
                        if _sig(os.fstat(tracked_fd)) != expected:
                            error(".", "tree_changed")
                    except OSError:
                        error(".", "tree_changed")
            finally:
                for tracked_fd, _ in reversed(tracked):
                    try:
                        os.close(tracked_fd)
                    except OSError:
                        pass
            root_info = None
    except OSError:
        error(".", "source_unavailable")

    # A directory being changed while it is scanned invalidates the complete
    # claim; it is never interpreted as an absence.
    changed = False
    for relative, before in list(signatures.items()):
        path = root_path if source_config.get("tipo") == "arquivo" else (root_path if relative == "." else root_path / relative)
        try:
            if _sig(path.lstat()) != before:
                changed = True
        except OSError:
            changed = True
    if changed:
        error(".", "tree_changed")
    files.sort(key=lambda item: item.path)
    errors.sort(key=lambda item: (item["path"], item["reason"]))
    skipped.sort(key=lambda item: (item["path"], item["reason"]))
    return Snapshot(str(root_path), dict(source_config), tuple(files), not errors and not changed,
                    tuple(errors), tuple(skipped), _fingerprint(signatures))


def compare_snapshots(current: Snapshot, previous: dict[str, Any] | None) -> dict[str, list[str]]:
    old = {str(item.get("path")): item for item in (previous or {}).get("files", []) if isinstance(item, dict)}
    new = {item.path: item for item in current.files}
    return {
        "new": sorted(path for path in new if path not in old),
        "changed": sorted(path for path in new if path in old and (
            int(old[path].get("size", -1)) != new[path].size or
            int(old[path].get("modifiedNs", -1)) != new[path].modified_ns or
            str(old[path].get("rawSha256", "")) != new[path].raw_sha256)),
        "absent": sorted(path for path in old if path not in new),
    }
