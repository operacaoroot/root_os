#!/usr/bin/env python3
"""Prévia local de metadados. Não lê conteúdo, não envia e não autoriza coleta."""
import argparse
import fnmatch
import json
import os
from pathlib import Path
import stat
import sys


DEFAULT_EXTENSIONS = (".md", ".txt", ".csv")
BLOCKED_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".sqlite", ".db"}
BLOCKED_NAMES = {"credentials", "credentials.json", "secrets.json", "id_rsa", "id_ed25519"}
FILE_ATTRIBUTE_HIDDEN = 0x2
IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003
IO_REPARSE_TAG_SYMLINK = 0xA000000C
INCOMPLETE_EXIT = 3


def is_link(info):
    """Reconhece links e junctions, sem bloquear todo arquivo sob demanda.

    No Windows, vários recursos (por exemplo placeholders do OneDrive) usam o
    atributo REPARSE_POINT sem redirecionar o caminho. Só os tags de symlink e
    mount point/junction representam a travessia que precisamos recusar aqui.
    """
    if stat.S_ISLNK(info.st_mode):
        return True
    tag = getattr(info, "st_reparse_tag", 0)
    return tag in {IO_REPARSE_TAG_SYMLINK, IO_REPARSE_TAG_MOUNT_POINT}


def is_hidden(name, info):
    return name.startswith('.') or bool(getattr(info, 'st_file_attributes', 0) & FILE_ATTRIBUTE_HIDDEN)


def matches_exclusion(relative, pattern, *, windows=None):
    if windows is None:
        windows = sys.platform == 'win32'
    if windows:
        relative, pattern = relative.casefold(), pattern.casefold()
    return fnmatch.fnmatchcase(relative, pattern)


def preview(source, *, recursive=False, extensions=DEFAULT_EXTENSIONS,
            exclude=(), max_bytes=5 * 1024 * 1024, max_entries=10000, max_depth=32):
    """A seleção é um arquivo ou uma pasta. Symlinks nunca são percorridos.

    Incompleta => nenhuma futura rotina de envio deve aceitar esta prévia.
    O limite conta TODAS as entradas, não só os arquivos elegíveis.
    """
    if max_bytes < 1 or max_entries < 1 or max_depth < 0:
        raise ValueError("Limites inválidos.")
    extensions = tuple(e.lower() for e in extensions)
    if not extensions or any(not e.startswith('.') or '/' in e or '\\' in e for e in extensions):
        raise ValueError("Extensões devem começar com ponto e não conter caminhos.")
    source = Path(source).expanduser().absolute()
    result = {"schemaVersion": 1, "operation": "preview", "complete": True,
              "authorizesUpload": False, "recursive": recursive,
              "extensions": list(extensions), "exclude": list(exclude),
              "limits": {"maxBytesPerFile": max_bytes, "maxEntries": max_entries,
                         "maxDepth": max_depth},
              "files": [], "skipped": [], "errors": []}
    visited = 0

    def error(path, code):
        result["complete"] = False
        result["errors"].append({"path": path, "reason": code})

    def inspect(path, relative, depth):
        nonlocal visited
        visited += 1
        if visited > max_entries:
            error(".", "entry_limit")
            return False
        name = path.name
        if name.startswith('.') or name.lower() in BLOCKED_NAMES or path.suffix.lower() in BLOCKED_EXTENSIONS:
            result["skipped"].append({"path": relative, "reason": "protected_name"})
            return True
        if any(matches_exclusion(relative, pattern) for pattern in exclude):
            result["skipped"].append({"path": relative, "reason": "excluded"})
            return True
        try:
            info = path.lstat()
        except OSError:
            error(relative, "unreadable_metadata")
            return True
        if is_hidden(name, info):
            result["skipped"].append({"path": relative, "reason": "protected_name"})
        elif is_link(info):
            result["skipped"].append({"path": relative, "reason": "symbolic_link"})
        elif stat.S_ISDIR(info.st_mode):
            if not recursive:
                result["skipped"].append({"path": relative, "reason": "subfolder_not_selected"})
            elif depth >= max_depth:
                error(relative, "depth_limit")
            else:
                return walk(path, relative, depth + 1)
        elif not stat.S_ISREG(info.st_mode):
            result["skipped"].append({"path": relative, "reason": "not_regular_file"})
        elif path.suffix.lower() not in extensions:
            result["skipped"].append({"path": relative, "reason": "unsupported_type"})
        elif info.st_size > max_bytes:
            result["skipped"].append({"path": relative, "reason": "file_too_large"})
        else:
            result["files"].append({"path": relative, "size": info.st_size,
                                    "modifiedNs": info.st_mtime_ns})
        return True

    def walk(directory, prefix, depth):
        try:
            # Não materializa uma pasta enorme antes de aplicar o limite.
            with os.scandir(directory) as entries:
                for entry in entries:
                    relative = f"{prefix}/{entry.name}" if prefix else entry.name
                    if not inspect(Path(entry.path), relative, depth):
                        return False
        except OSError:
            error(prefix or ".", "unreadable_directory")
        return True

    try:
        info = source.lstat()
        if is_link(info):
            error(".", "source_is_symbolic_link")
        elif stat.S_ISDIR(info.st_mode):
            if is_hidden(source.name, info):
                error(".", "protected_source")
            else:
                walk(source, "", 0)
        elif stat.S_ISREG(info.st_mode):
            inspect(source, source.name, 0)
        else:
            error(".", "invalid_source")
    except OSError:
        error(".", "source_unavailable")
    for key in ("files", "skipped", "errors"):
        result[key].sort(key=lambda item: (item["path"], item.get("reason", "")))
    result["summary"] = {"selectedFiles": len(result["files"]),
                         "selectedBytes": sum(f["size"] for f in result["files"]),
                         "skippedEntries": len(result["skipped"]),
                         "visitedEntries": min(visited, max_entries)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Arquivo ou pasta selecionado explicitamente")
    parser.add_argument("--recursive", action="store_true", help="Incluir subpastas")
    parser.add_argument("--extension", action="append", help="Extensão permitida; repetível")
    parser.add_argument("--exclude", action="append", default=[], help="Glob relativo à pasta; repetível")
    parser.add_argument("--max-bytes", type=int, default=5 * 1024 * 1024)
    parser.add_argument("--max-entries", type=int, default=10000)
    parser.add_argument("--max-depth", type=int, default=32)
    args = parser.parse_args()
    try:
        report = preview(args.source, recursive=args.recursive,
                         extensions=args.extension or DEFAULT_EXTENSIONS, exclude=args.exclude,
                         max_bytes=args.max_bytes, max_entries=args.max_entries,
                         max_depth=args.max_depth)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["complete"] else INCOMPLETE_EXIT


if __name__ == "__main__":
    sys.exit(main())
