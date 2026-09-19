"""Seletor local opcional; nunca chama API nem concede consentimento."""

from __future__ import annotations


class SelectorUnavailable(RuntimeError):
    pass


class SelectionCancelled(RuntimeError):
    pass


def choose_path(*, directory: bool = False) -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except (ImportError, ModuleNotFoundError) as exc:
        raise SelectorUnavailable("seletor visual indisponível; use o CLI com --root") from exc
    root = None
    try:
        root = tk.Tk()
        root.withdraw()
    except Exception as exc:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass
        raise SelectorUnavailable("seletor visual indisponível; use o CLI com --root") from exc
    try:
        try:
            selected = filedialog.askdirectory() if directory else filedialog.askopenfilename()
        except Exception as exc:
            raise SelectorUnavailable("seletor visual indisponível; use o CLI com --root") from exc
    finally:
        try:
            root.destroy()
        except Exception:
            # Falha no teardown não deve transformar uma seleção já cancelada
            # em coleta/aprovação; o recurso foi criado apenas para o diálogo.
            pass
    if not selected:
        raise SelectionCancelled("seleção cancelada; nada foi coletado ou aprovado")
    return selected
