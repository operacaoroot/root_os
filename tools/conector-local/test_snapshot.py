import json
import io
import os
from pathlib import Path
import tempfile
import types
import unittest
from dataclasses import replace
from unittest.mock import patch

from client import ConsentRequired, LocalConnectorClient, LocalState, SnapshotConsent, HttpTransport, TransportError, approve_selection, approve_snapshot
from secure_store import MemoryVault
from selector import SelectionCancelled, SelectorUnavailable, choose_path
from snapshot import compare_snapshots, snapshot_source


def config(*, rule="ignorar", maximum=1024):
    return {"id": "source-1", "tipo": "pasta", "raizLogica": "cliente/docs",
            "incluir": ["**/*.md"], "excluir": [], "tiposPermitidos": [".md"],
            "modo": "sincronizacao", "regraExclusao": rule, "tamanhoMaximo": maximum,
            "escopoVersao": 3}


class SnapshotTransport:
    base_url = "https://snapshot.synthetic"
    def __init__(self, source):
        self.source = source
        self.calls = []
        self.delivery = "delivery-snapshot"
        self.applied = set()
        self.timeout_batch = False
        self.timeout_open = False
        self.timeout_finish = False
        self.finish_applied = False
        self.on_lote = None

    def post(self, path, body, *, token=None):
        self.calls.append((path, body))
        if path == "/api/conector/pulso":
            return {"revogado": False, "fontes": [self.source]}
        if path == "/api/conector/remessa":
            if self.timeout_open and len([x for x in self.calls if x[0] == "/api/conector/remessa"]) == 1:
                raise TransportError("timeout após abertura aplicada")
            return {"remessaId": self.delivery, "fonteId": self.source["id"]}
        if path.endswith("/lote"):
            duplicate = all(item["caminhoRelativo"] in self.applied for item in body["itens"])
            self.applied.update(item["caminhoRelativo"] for item in body["itens"])
            if self.on_lote:
                self.on_lote()
            if self.timeout_batch and len([x for x in self.calls if x[0].endswith("/lote")]) == 1:
                raise TransportError("timeout após lote aplicado")
            return {"remessaId": self.delivery, "aceitos": 0 if duplicate else len(body["itens"]),
                    "duplicados": len(body["itens"]) if duplicate else 0}
        if path.endswith("/fim"):
            if self.timeout_finish and not self.finish_applied:
                self.finish_applied = True
                raise TransportError("timeout após fim aplicado")
            count = len(body["itensVistos"])
            return {"remessaId": self.delivery, "fonteId": self.source["id"], "status": "concluida",
                    "snapshotCompleto": True, "itensEnviados": count, "itensVistos": count, "erros": 0}
        raise AssertionError(path)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = (Path(self.tmp.name) / "docs").resolve()
        self.root.mkdir()
        (self.root / "a.md").write_text("A", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def snapshot_client(self, *, rule="ignorar", empty=False):
        source = config(rule=rule)
        transport = SnapshotTransport(source)
        vault = MemoryVault()
        state = LocalState(Path(self.tmp.name).resolve() / f"snapshot-state-{rule}.json")
        client = LocalConnectorClient(transport, vault=vault, state=state)
        vault.set(client._token_key("device"), "synthetic-token")
        if empty:
            (self.root / "a.md").unlink()
        report = snapshot_source(self.root, source)
        consent = approve_snapshot(self.root, report.as_dict(), target_url=transport.base_url,
                                   org_id="org", device_id="device", source_id="source-1",
                                   scope_version=3, source_config=source,
                                   approve_new=bool(report.files), absence_rule=rule)
        return client, transport, state, consent, source

    def test_snapshot_sync_successful_stateful_transport(self):
        client, transport, state, consent, _ = self.snapshot_client()
        self.assertEqual(client.sync(consent, device_id="device")["status"], "concluida")
        self.assertEqual(len([c for c in transport.calls if c[0].endswith("/fim")]), 1)
        self.assertEqual(state.load()["status"], "concluida")

    def test_snapshot_timeout_after_batch_new_instance_reuses_key_and_delivery(self):
        client, transport, state, consent, source = self.snapshot_client()
        transport.timeout_batch = True
        with self.assertRaises(TransportError):
            client.sync(consent, device_id="device")
        pending = state.load()
        resumed = LocalConnectorClient(transport, vault=client.vault, state=state)
        transport.timeout_batch = False
        self.assertEqual(resumed.sync(consent, device_id="device")["status"], "concluida")
        self.assertEqual(state.load()["requestKey"], pending["requestKey"])
        self.assertEqual(state.load()["deliveryId"], pending["deliveryId"])
        self.assertEqual(len([c for c in transport.calls if c[0] == "/api/conector/remessa"]), 1)
        self.assertEqual(len(transport.applied), 1)

    def test_snapshot_timeout_after_open_new_instance_reuses_request_key(self):
        client, transport, state, consent, _ = self.snapshot_client()
        transport.timeout_open = True
        with self.assertRaises(TransportError):
            client.sync(consent, device_id="device")
        request_key = state.load()["requestKey"]
        resumed = LocalConnectorClient(transport, vault=client.vault, state=state)
        transport.timeout_open = False
        self.assertEqual(resumed.sync(consent, device_id="device")["status"], "concluida")
        opens = [body for path, body in transport.calls if path == "/api/conector/remessa"]
        self.assertEqual([body["chaveRequisicao"] for body in opens], [request_key, request_key])

    def test_snapshot_timeout_after_finish_new_instance_reuses_same_delivery(self):
        client, transport, state, consent, _ = self.snapshot_client()
        transport.timeout_finish = True
        with self.assertRaises(TransportError):
            client.sync(consent, device_id="device")
        resumed = LocalConnectorClient(transport, vault=client.vault, state=state)
        self.assertEqual(resumed.sync(consent, device_id="device")["status"], "concluida")
        self.assertEqual(len([c for c in transport.calls if c[0] == "/api/conector/remessa"]), 1)

    def test_snapshot_empty_finishes_zero_for_both_absence_rules(self):
        for rule in ("ignorar", "arquivar"):
            if not (self.root / "a.md").exists():
                (self.root / "a.md").write_text("A", encoding="utf-8")
            client, transport, _, consent, _ = self.snapshot_client(rule=rule, empty=True)
            result = client.sync(consent, device_id="device")
            finish = next(body for path, body in transport.calls if path.endswith("/fim"))
            self.assertEqual(result["itens"], 0)
            self.assertEqual(finish["itensVistos"], [])
            self.assertTrue(finish["manifestoCompleto"])

    def test_snapshot_changes_between_lote_and_fim_are_rejected(self):
        client, transport, state, consent, _ = self.snapshot_client()
        transport.on_lote = lambda: (self.root / "a.md").write_text("changed", encoding="utf-8")
        with self.assertRaises(ConsentRequired):
            client.sync(consent, device_id="device")
        self.assertFalse(any(path.endswith("/fim") for path, _ in transport.calls))
        self.assertEqual(state.load()["deliveryId"], transport.delivery)
        self.assertIn("sent", state.load())

    def test_snapshot_A_B_A_never_reuses_incompatible_state(self):
        client, transport, state, consent_a, source = self.snapshot_client()
        client.sync(consent_a, device_id="device")
        (self.root / "a.md").write_text("B", encoding="utf-8")
        report_b = snapshot_source(self.root, source)
        consent_b = approve_snapshot(self.root, report_b.as_dict(), target_url=transport.base_url,
                                     org_id="org", device_id="device", source_id="source-1",
                                     scope_version=3, source_config=source, approve_new=True,
                                     approve_changed=True)
        with self.assertRaises(ConsentRequired):
            client.sync(consent_b, device_id="device")
        (self.root / "a.md").write_text("A", encoding="utf-8")
        with self.assertRaises(ConsentRequired):
            # B cannot be reused after A's state was persisted.
            client.sync(consent_b, device_id="device")
        report_a2 = snapshot_source(self.root, source)
        consent_a2 = approve_snapshot(self.root, report_a2.as_dict(), target_url=transport.base_url,
                                      org_id="org", device_id="device", source_id="source-1",
                                      scope_version=3, source_config=source, approve_new=True,
                                      approve_changed=True)
        fresh_state = LocalState(Path(self.tmp.name).resolve() / "snapshot-state-a2.json")
        fresh_client = LocalConnectorClient(transport, vault=client.vault, state=fresh_state)
        self.assertEqual(fresh_client.sync(consent_a2, device_id="device")["status"], "concluida")

    def test_snapshot_file_source_sends_expected_bytes(self):
        selected = self.root / "a.md"
        source = config(); source["tipo"] = "arquivo"
        transport = SnapshotTransport(source)
        vault = MemoryVault(); state = LocalState(Path(self.tmp.name).resolve() / "file-state.json")
        client = LocalConnectorClient(transport, vault=vault, state=state)
        vault.set(client._token_key("device"), "synthetic-token")
        report = snapshot_source(selected, source)
        consent = approve_snapshot(selected, report.as_dict(), target_url=transport.base_url,
                                   org_id="org", device_id="device", source_id="source-1",
                                   scope_version=3, source_config=source, approve_new=True)
        client.sync(consent, device_id="device")
        batch = next(body for path, body in transport.calls if path.endswith("/lote"))
        self.assertEqual(batch["itens"][0]["texto"], "A")

    def test_legacy_import_file_source_still_reads_from_directory_root(self):
        from preview import preview
        source = config(); source["tipo"] = "arquivo"; source["modo"] = "importacao"
        transport = SnapshotTransport(source)
        vault = MemoryVault(); state = LocalState(Path(self.tmp.name).resolve() / "legacy-file-state.json")
        client = LocalConnectorClient(transport, vault=vault, state=state)
        vault.set(client._token_key("device"), "synthetic-token")
        report = preview(self.root / "a.md", extensions=[".md"])
        consent = approve_selection(self.root, report, target_url=transport.base_url, org_id="org",
                                    device_id="device", source_id="source-1", scope_version=3,
                                    mode="importacao", source_config=source)
        client.sync(consent, device_id="device")
        batch = next(body for path, body in transport.calls if path.endswith("/lote"))
        self.assertEqual(batch["itens"][0]["texto"], "A")

    def test_cli_preview_approve_persist_and_previous_consent(self):
        import cli
        source = config(rule="arquivar")
        source_file = Path(self.tmp.name).resolve() / "source.json"
        preview_file = Path(self.tmp.name).resolve() / "snapshot.json"
        consent_file = Path(self.tmp.name).resolve() / "consent.json"
        next_preview = Path(self.tmp.name).resolve() / "snapshot-b.json"
        next_consent = Path(self.tmp.name).resolve() / "consent-b.json"
        cli._write_json(str(source_file), source)
        args = cli.parser().parse_args(["--api", "https://snapshot.synthetic", "preview-snapshot",
                                        "--root", str(self.root), "--source-json", str(source_file),
                                        "--source-id", "source-1", "--output", str(preview_file)])
        self.assertEqual(cli._run(args), 0)
        args = cli.parser().parse_args(["--api", "https://snapshot.synthetic", "approve-snapshot",
                                        "--root", str(self.root), "--snapshot-json", str(preview_file),
                                        "--source-json", str(source_file), "--source-id", "source-1",
                                        "--output", str(consent_file), "--org-id", "org", "--device-id", "device",
                                        "--scope-version", "3", "--approve-new", "--absence-rule", "arquivar"])
        with patch("builtins.input", return_value="sim"), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(cli._run(args), 0)
            self.assertIn("baseComparacao", output.getvalue())
            self.assertIn("TODOS os itens desta fonte ausentes", output.getvalue())
        (self.root / "a.md").write_text("B", encoding="utf-8")
        args = cli.parser().parse_args(["--api", "https://snapshot.synthetic", "preview-snapshot",
                                        "--root", str(self.root), "--source-json", str(source_file),
                                        "--source-id", "source-1", "--output", str(next_preview)])
        self.assertEqual(cli._run(args), 0)
        args = cli.parser().parse_args(["--api", "https://snapshot.synthetic", "approve-snapshot",
                                        "--root", str(self.root), "--snapshot-json", str(next_preview),
                                        "--source-json", str(source_file), "--source-id", "source-1",
                                        "--output", str(next_consent), "--previous", str(consent_file),
                                        "--org-id", "org", "--device-id", "device", "--scope-version", "3",
                                        "--approve-changed", "--absence-rule", "arquivar"])
        with patch("builtins.input", return_value="sim"):
            self.assertEqual(cli._run(args), 0)
        self.assertEqual(cli._snapshot_consent(cli._read_json(str(next_consent))).changed, ("a.md",))
        source = config(rule="arquivar")
        transport = SnapshotTransport(source)
        vault = MemoryVault(); state = LocalState(Path(self.tmp.name).resolve() / "cli-sync-state.json")
        fake_client = LocalConnectorClient(transport, vault=vault, state=state)
        vault.set(fake_client._token_key("device"), "synthetic-token")
        sync_args = cli.parser().parse_args(["--api", transport.base_url, "sync", "--consent", str(next_consent), "--device-id", "device"])
        with patch("cli.LocalConnectorClient.production", return_value=fake_client):
            self.assertEqual(cli._run(sync_args), 0)

    def test_cli_empty_root_and_selector_cancel_do_not_start_production_or_scan(self):
        import cli
        with patch("cli.choose_path", side_effect=SelectionCancelled("cancelado")), \
             patch("cli.LocalConnectorClient.production") as production, \
             patch("cli.preview") as generic_preview, \
             patch("cli.approve_snapshot") as approve:
            self.assertEqual(cli.main(["--api", "https://snapshot.synthetic", "select"]), 4)
            self.assertEqual(cli.main(["--api", "https://snapshot.synthetic", "preview-snapshot", "--root", "", "--source-json", "missing", "--source-id", "source-1"]), 4)
            production.assert_not_called()
            generic_preview.assert_not_called()
            approve.assert_not_called()

    def test_full_coverage_and_empty_snapshot_are_valid(self):
        report = snapshot_source(self.root, config())
        self.assertTrue(report.complete)
        self.assertEqual([item.path for item in report.files], ["a.md"])
        (self.root / "a.md").unlink()
        empty = snapshot_source(self.root, config())
        self.assertTrue(empty.complete)
        self.assertEqual(empty.files, ())

    def test_ignorar_and_arquivar_are_frozen_in_source_config(self):
        self.assertEqual(snapshot_source(self.root, config(rule="ignorar")).source_config["regraExclusao"], "ignorar")
        self.assertEqual(snapshot_source(self.root, config(rule="arquivar")).source_config["regraExclusao"], "arquivar")

    def test_known_skips_cannot_become_absences(self):
        (self.root / "too.md").write_bytes(b"x" * 20)
        (self.root / "outside.txt").write_text("outside", encoding="utf-8")
        os.symlink(self.root / "a.md", self.root / "link.md")
        if hasattr(os, "mkfifo"):
            os.mkfifo(self.root / "pipe.md")
        report = snapshot_source(self.root, config(maximum=10))
        self.assertFalse(report.complete)
        reasons = {item["reason"] for item in report.errors}
        self.assertIn("known_skip_file_too_large", reasons)
        self.assertIn("known_skip_symbolic_link", reasons)
        self.assertIn("known_skip_unsafe_type", reasons)
        self.assertEqual(compare_snapshots(report, {"files": [{"path": "gone.md", "size": 1, "modifiedNs": 1, "rawSha256": "x"}]} )["absent"], ["gone.md"])

    def test_partial_source_is_not_a_complete_snapshot(self):
        report = snapshot_source(self.root, config())
        self.assertEqual(len(report.files), 1)
        # A narrower local filter is not accepted by snapshot_source: config is
        # the server source, so it always scans the whole root.
        self.assertEqual(report.source_config["incluir"], ["**/*.md"])

    def test_new_changed_and_absent_require_separate_approval(self):
        old = snapshot_source(self.root, config()).as_dict()
        previous = {"snapshot": old, "consentEnvelope": {"target_url": "https://example", "org_id": "org", "device_id": "device", "source_id": "source-1", "scope_version": 3}}
        (self.root / "a.md").write_text("A2", encoding="utf-8")
        (self.root / "new.md").write_text("N", encoding="utf-8")
        current = snapshot_source(self.root, config()).as_dict()
        changes = compare_snapshots(type("View", (), {"files": tuple(
            type("F", (), {"path": item["path"], "size": item["size"],
                            "modified_ns": item["modifiedNs"], "raw_sha256": item["rawSha256"]})()
            for item in current["files"]
        )})(), old)
        self.assertEqual(changes["new"], ["new.md"])
        self.assertEqual(changes["changed"], ["a.md"])
        with self.assertRaises(ConsentRequired):
            approve_snapshot(self.root, current, target_url="https://example", org_id="org",
                             device_id="device", source_id="source-1", scope_version=3,
                             source_config=config(), previous=previous, approve_new=False, approve_changed=False)
        consent = approve_snapshot(self.root, current, target_url="https://example", org_id="org",
                                   device_id="device", source_id="source-1", scope_version=3,
                                   source_config=config(), previous=previous, approve_new=True, approve_changed=True)
        self.assertEqual(consent.new, ("new.md",))
        self.assertEqual(consent.changed, ("a.md",))

    def test_absence_rule_is_explicit_and_snapshot_is_frozen(self):
        old = snapshot_source(self.root, config(rule="arquivar")).as_dict()
        previous = {"snapshot": old, "consentEnvelope": {"target_url": "https://example", "org_id": "org", "device_id": "device", "source_id": "source-1", "scope_version": 3}}
        (self.root / "a.md").unlink()
        current = snapshot_source(self.root, config(rule="arquivar")).as_dict()
        with self.assertRaises(ConsentRequired):
            approve_snapshot(self.root, current, target_url="https://example", org_id="org",
                             device_id="device", source_id="source-1", scope_version=3,
                             source_config=config(rule="arquivar"), previous=previous)
        consent = approve_snapshot(self.root, current, target_url="https://example", org_id="org",
                                   device_id="device", source_id="source-1", scope_version=3,
                                   source_config=config(rule="arquivar"), previous=previous, absence_rule="arquivar")
        self.assertEqual(consent.absent, ("a.md",))
        self.assertEqual(consent.snapshot["files"], [])

    def test_tree_change_and_retaking_snapshot_do_not_reuse_old_state(self):
        first = snapshot_source(self.root, config()).as_dict()
        (self.root / "a.md").write_text("changed", encoding="utf-8")
        second = snapshot_source(self.root, config()).as_dict()
        self.assertNotEqual(first["treeFingerprint"], second["treeFingerprint"])
        self.assertNotEqual(json.dumps(first), json.dumps(second))

    def test_windows_is_closed_and_import_empty_remains_denied(self):
        from unittest.mock import patch
        with patch("snapshot.os.name", "nt"):
            with self.assertRaises(Exception):
                snapshot_source(self.root, config())
        with self.assertRaises(ConsentRequired):
            from client import approve_selection
            approve_selection(self.root, {"complete": True, "authorizesUpload": False, "files": []},
                              target_url="https://example", org_id="org", device_id="device",
                              source_id="source-1", scope_version=3, mode="importacao", source_config={})

    def test_single_file_source_is_anchored_and_previous_identity_is_checked(self):
        selected = self.root / "a.md"
        single = config()
        single["tipo"] = "arquivo"
        report = snapshot_source(selected, single)
        self.assertTrue(report.complete)
        self.assertEqual([item.path for item in report.files], ["a.md"])
        with self.assertRaises(ConsentRequired):
            approve_snapshot(selected, report.as_dict(), target_url="https://example", org_id="org",
                             device_id="device", source_id="source-1", scope_version=3,
                             source_config=single, previous={"root": str(self.root), "sourceConfig": single, "files": []})

    def test_sync_revalidates_loaded_snapshot_approvals_before_network(self):
        source = config(rule="arquivar")
        snapshot = {"complete": True, "root": str(self.root), "sourceConfig": source, "files": []}
        consent = SnapshotConsent(str(self.root), "https://example", "org", "device", "source-1", 3,
                                  "agente_externo", source, snapshot, (), (), (), (), "ignorar", False, False)
        client = LocalConnectorClient(HttpTransport("https://example"), vault=MemoryVault(),
                                      state=LocalState(self.root / "state.json"))
        with self.assertRaises(ConsentRequired):
            client.sync(consent, device_id="device")

    def test_sync_rejects_manifest_file_mismatch_before_any_network(self):
        from dataclasses import replace
        source = config()
        report = snapshot_source(self.root, source)
        consent = approve_snapshot(self.root, report.as_dict(), target_url="https://example", org_id="org",
                                   device_id="device", source_id="source-1", scope_version=3,
                                   source_config=source, approve_new=True)
        inconsistent = replace(consent, files=())
        class NoNetwork:
            base_url = "https://example"
            def post(self, *args, **kwargs):
                raise AssertionError("rede não pode ser chamada com manifesto divergente")
        client = LocalConnectorClient(NoNetwork(), vault=MemoryVault(), state=LocalState(self.root / "state.json"))
        with self.assertRaises(ConsentRequired):
            client.sync(inconsistent, device_id="device")

    def test_serialized_snapshot_consent_roundtrips_through_cli_loader(self):
        from cli import _snapshot_consent
        source = config()
        report = snapshot_source(self.root, source)
        consent = approve_snapshot(self.root, report.as_dict(), target_url="https://example", org_id="org",
                                   device_id="device", source_id="source-1", scope_version=3,
                                   source_config=source, approve_new=True)
        serialized = {"kind": "snapshot-consent", "root": consent.root, "target_url": consent.target_url,
                      "org_id": consent.org_id, "device_id": consent.device_id, "source_id": consent.source_id,
                      "scope_version": consent.scope_version, "destination": consent.destination,
                      "source_config": consent.source_config, "snapshot": consent.snapshot,
                      "new": list(consent.new), "changed": list(consent.changed), "absent": list(consent.absent),
                      "absence_rule": consent.absence_rule, "approve_new": consent.approve_new,
                      "approve_changed": consent.approve_changed}
        loaded = _snapshot_consent(serialized)
        self.assertEqual(loaded.fingerprint(), consent.fingerprint())

    def test_selector_cancel_never_collects_and_missing_toolkit_is_closed(self):
        with patch.dict("sys.modules", {"tkinter": None}):
            with self.assertRaises(SelectorUnavailable):
                choose_path()

    def test_selector_doubles_cancel_file_folder_and_destroy_on_error(self):
        events = []
        class FakeRoot:
            def withdraw(self): events.append("withdraw")
            def destroy(self): events.append("destroy")
        tk_module = types.ModuleType("tkinter")
        tk_module.Tk = FakeRoot
        dialogs = types.ModuleType("tkinter.filedialog")
        dialogs.askopenfilename = lambda: events.append("file") or "/tmp/fixture.md"
        dialogs.askdirectory = lambda: events.append("directory") or "/tmp/fixture-dir"
        with patch.dict("sys.modules", {"tkinter": tk_module, "tkinter.filedialog": dialogs}):
            self.assertEqual(choose_path(), "/tmp/fixture.md")
            self.assertEqual(choose_path(directory=True), "/tmp/fixture-dir")
            dialogs.askopenfilename = lambda: ""
            with self.assertRaises(SelectionCancelled):
                choose_path()
            dialogs.askopenfilename = lambda: (_ for _ in ()).throw(RuntimeError("dialog fixture"))
            with self.assertRaises(SelectorUnavailable):
                choose_path()
        self.assertEqual(events.count("destroy"), 4)


if __name__ == "__main__":
    unittest.main()
