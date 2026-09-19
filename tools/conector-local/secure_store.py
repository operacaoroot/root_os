"""Adaptadores de cofre do sistema para o conector local.

O módulo não tem fallback em arquivo, variável de ambiente ou prompt para o
segredo. Os testes injetam ``MemoryVault``; a execução real exige Keychain do
macOS ou Secret Service via ``secret-tool`` no Linux.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
import shutil
import subprocess
import sys
from typing import Protocol


class SecureStoreError(RuntimeError):
    """O cofre não está disponível ou recusou a operação."""


class Vault(Protocol):
    def get(self, key: str) -> str | None: ...
    def set(self, key: str, value: str) -> None: ...
    def delete(self, key: str) -> None: ...


class MemoryVault:
    """Cofre somente para fixtures injetadas; nunca é o padrão de produção."""

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._values.get(key)

    def set(self, key: str, value: str) -> None:
        self._values[key] = value

    def delete(self, key: str) -> None:
        self._values.pop(key, None)


class SecretToolVault:
    """Secret Service através do CLI, sem passar o segredo em argv."""

    def __init__(self, *, executable: str = "secret-tool") -> None:
        if shutil.which(executable) is None:
            raise SecureStoreError("secret-tool indisponível; envio bloqueado")
        self.executable = executable

    @staticmethod
    def _parts(key: str) -> list[str]:
        if not key or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in key):
            raise SecureStoreError("chave de cofre inválida")
        return ["service", "rootos-conector-local", "account", key]

    def get(self, key: str) -> str | None:
        result = subprocess.run(
            [self.executable, "lookup", *self._parts(key)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=5, check=False,
        )
        if result.returncode != 0:
            raise SecureStoreError("secret-tool não conseguiu ler o cofre")
        value = result.stdout.rstrip("\r\n")
        return value or None

    def set(self, key: str, value: str) -> None:
        if not value:
            raise SecureStoreError("segredo vazio")
        result = subprocess.run(
            [self.executable, "store", "--label", "ROOT OS connector token", *self._parts(key)],
            input=value, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            text=True, timeout=5, check=False,
        )
        if result.returncode != 0:
            raise SecureStoreError("secret-tool recusou o segredo")

    def delete(self, key: str) -> None:
        subprocess.run(
            [self.executable, "clear", *self._parts(key)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=5, check=False,
        )


class MacKeychainVault:
    """Keychain nativo via Security.framework; senha nunca vira argumento."""

    SERVICE = b"rootos-conector-local"

    def __init__(self) -> None:
        if sys.platform != "darwin":
            raise SecureStoreError("Keychain do macOS indisponível nesta plataforma")
        try:
            self._security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
            self._corefoundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        except OSError as exc:
            raise SecureStoreError("Security.framework indisponível; envio bloqueado") from exc
        pointer = ctypes.POINTER(ctypes.c_void_p)
        self._find = self._security.SecKeychainFindGenericPassword
        self._find.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), pointer, pointer]
        self._find.restype = ctypes.c_int32
        self._add = self._security.SecKeychainAddGenericPassword
        self._add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, pointer]
        self._add.restype = ctypes.c_int32
        self._modify = self._security.SecKeychainItemModifyContent
        self._modify.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
        self._modify.restype = ctypes.c_int32
        self._free = self._security.SecKeychainItemFreeContent
        self._free.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self._free.restype = ctypes.c_int32
        self._delete = self._security.SecKeychainItemDelete
        self._delete.argtypes = [ctypes.c_void_p]
        self._delete.restype = ctypes.c_int32
        self._cf_release = self._corefoundation.CFRelease
        self._cf_release.argtypes = [ctypes.c_void_p]
        self._cf_release.restype = None

    @staticmethod
    def _account(key: str) -> bytes:
        if not key or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in key):
            raise SecureStoreError("chave de cofre inválida")
        return key.encode("ascii")

    def get(self, key: str) -> str | None:
        account = self._account(key)
        length = ctypes.c_uint32(0)
        data = ctypes.c_void_p()
        item = ctypes.c_void_p()
        status = self._find(
            None, len(self.SERVICE), self.SERVICE, len(account), account,
            ctypes.byref(length), ctypes.byref(data), ctypes.byref(item),
        )
        if status == -25300:  # errSecItemNotFound
            return None
        if status != 0:
            raise SecureStoreError("Keychain não conseguiu ler o cofre")
        try:
            return ctypes.string_at(data, length.value).decode("utf-8")
        finally:
            self._free(None, data)
            self._cf_release(item)

    def set(self, key: str, value: str) -> None:
        if not value:
            raise SecureStoreError("segredo vazio")
        account = self._account(key)
        value_bytes = value.encode("utf-8")
        length = ctypes.c_uint32(0)
        data = ctypes.c_void_p()
        item = ctypes.c_void_p()
        status_find = self._find(None, len(self.SERVICE), self.SERVICE, len(account), account, ctypes.byref(length), ctypes.byref(data), ctypes.byref(item))
        if status_find == 0:
            try:
                status = self._modify(item, None, len(value_bytes), value_bytes)
            finally:
                self._free(None, data)
                self._cf_release(item)
        elif status_find == -25300:
            status = self._add(None, len(self.SERVICE), self.SERVICE, len(account), account, len(value_bytes), value_bytes, ctypes.byref(item))
            if item:
                self._cf_release(item)
        else:
            raise SecureStoreError("Keychain não conseguiu atualizar o cofre")
        if status != 0:
            raise SecureStoreError("Keychain recusou o segredo")

    def delete(self, key: str) -> None:
        account = self._account(key)
        length = ctypes.c_uint32(0)
        data = ctypes.c_void_p()
        item = ctypes.c_void_p()
        status = self._find(
            None, len(self.SERVICE), self.SERVICE, len(account), account,
            ctypes.byref(length), ctypes.byref(data), ctypes.byref(item),
        )
        if status == -25300:
            return
        if status != 0:
            raise SecureStoreError("Keychain não conseguiu localizar o segredo")
        if item:
            try:
                if self._delete(item) != 0:
                    raise SecureStoreError("Keychain recusou remoção")
            finally:
                self._free(None, data)
                self._cf_release(item)


def open_system_vault() -> Vault:
    """Retorna somente cofre do SO; ausência é falha fechada."""
    if sys.platform == "darwin":
        return MacKeychainVault()
    if sys.platform.startswith("linux"):
        return SecretToolVault()
    raise SecureStoreError("plataforma sem cofre comprovado; envio bloqueado")
