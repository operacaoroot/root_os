import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from client import (ClientError, ConsentRequired, LocalConnectorClient, LocalState, TokenUnavailable, TransportError,
                    api_hash, approve_selection, normalize_body)
from preview import preview
from secure_reader import ApprovedVersionMismatch
from secure_store import MemoryVault


class FakeTransport:
    base_url = "https://connector.synthetic"

    def __init__(self):
        self.calls = []
        self.fail_next_batch = False
        self.malformed_batch = False
        self.malformed_open = False
        self.malformed_finish = False
        self.timeout_after_batch = False
        self.timeout_after_open = False
        self.timeout_after_finish = False
        self.batch_applied = False
        self.open_applied = False
        self.finish_applied = False
        self.pair_response = None
        self.source = {
            "id": "source-a", "tipo": "pasta", "raizLogica": "docs",
            "incluir": ["**/*.md"], "excluir": ["private/**"],
            "tiposPermitidos": [".md"], "modo": "importacao",
            "regraExclusao": "arquivar", "tamanhoMaximo": 2 * 1024 * 1024,
            "escopoVersao": 3,
        }

    def post(self, path, body, *, token=None):
        self.calls.append((path, body, token))
        if path == "/api/conector/pareamento":
            return self.pair_response or {
                "id": "device-1", "orgId": body["orgId"], "nome": body["nomeDispositivo"],
                "token": f"rcon1.{body['orgId']}.device-1.synthetic-secret",
            }
        if path == "/api/conector/pulso":
            return {"revogado": False, "fontes": [self.source]}
        if path == "/api/conector/remessa":
            if self.malformed_open:
                return {}
            if self.timeout_after_open and not self.open_applied:
                self.open_applied = True
                raise TransportError("timeout após abertura sintética")
            return {"remessaId": "delivery-1", "fonteId": "source-a"}
        if path.endswith("/lote"):
            if self.fail_next_batch:
                self.fail_next_batch = False
                raise TransportError("timeout sintético")
            if self.malformed_batch:
                return {}
            count = len(body["itens"])
            if self.timeout_after_batch and not self.batch_applied:
                self.batch_applied = True
                raise TransportError("timeout após lote aplicado")
            if self.batch_applied:
                return {"remessaId": "delivery-1", "aceitos": 0, "duplicados": count}
            return {"remessaId": "delivery-1", "aceitos": count, "duplicados": 0}
        if path.endswith("/fim"):
            if self.malformed_finish:
                return {"status": "concluida", "snapshotCompleto": True}
            if self.timeout_after_finish and not self.finish_applied:
                self.finish_applied = True
                raise TransportError("timeout após fim aplicado")
            return {"remessaId": "delivery-1", "fonteId": "source-a", "status": "concluida",
                    "snapshotCompleto": True, "itensEnviados": 1, "itensVistos": 1, "erros": 0}
        raise AssertionError(path)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "selection"
        self.root.mkdir()
        (self.root / "note.md").write_text("BOM não é conteúdo?\r\n", encoding="utf-8")
        self.transport = FakeTransport()
        self.vault = MemoryVault()
        self.state = LocalState(Path(self.temp.name).resolve() / "state.json")
        self.vault.set(LocalConnectorClient(self.transport, vault=self.vault, state=self.state)._token_key("device-1"), "synthetic-token")
        report = preview(self.root, extensions=[".md"])
        self.consent = approve_selection(
            self.root, report, target_url=self.transport.base_url, org_id="org-a",
            device_id="device-1", source_id="source-a", scope_version=3,
            mode="importacao", source_config=self.transport.source,
        )

    def client(self):
        return LocalConnectorClient(self.transport, vault=self.vault, state=self.state)

    def test_hash_matches_ecmascript_trim_and_crlf(self):
        body = "\ufeff\t\r\nvalor\r\n\u00a0"
        expected = hashlib.sha256("valor".encode()).hexdigest()
        self.assertEqual(normalize_body(body), "valor")
        self.assertEqual(api_hash(body), expected)

    def test_sync_imports_and_state_has_no_token_or_content(self):
        result = self.client().sync(self.consent, device_id="device-1")
        self.assertEqual(result, {"remessaId": "delivery-1", "status": "concluida", "itens": 1})
        saved = self.state.load()
        serialized = json.dumps(saved, ensure_ascii=False)
        self.assertNotIn("synthetic-token", serialized)
        self.assertNotIn("BOM não é conteúdo", serialized)
        self.assertEqual([call[0] for call in self.transport.calls], [
            "/api/conector/pulso", "/api/conector/remessa", "/api/conector/pulso",
            "/api/conector/remessa/delivery-1/lote",
            "/api/conector/pulso", "/api/conector/remessa/delivery-1/fim",
        ])

    def test_timeout_keeps_delivery_and_pending_for_idempotent_resume(self):
        self.transport.fail_next_batch = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        pending = self.state.load()
        request_key = pending["requestKey"]
        self.assertTrue(request_key)
        self.assertEqual(pending["deliveryId"], "delivery-1")
        self.assertEqual(pending["pending"]["paths"], ["note.md"])
        result = self.client().sync(self.consent, device_id="device-1")
        self.assertEqual(result["status"], "concluida")
        opened = [call for call in self.transport.calls if call[0] == "/api/conector/remessa"]
        self.assertEqual(len(opened), 1)

    def test_timeout_after_server_applied_batch_is_deduplicated_on_new_instance(self):
        self.transport.timeout_after_batch = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        self.assertEqual(self.client().sync(self.consent, device_id="device-1")["status"], "concluida")

    def test_timeout_after_open_reuses_persisted_request_key(self):
        self.transport.timeout_after_open = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        request_key = self.state.load()["requestKey"]
        self.assertEqual(self.client().sync(self.consent, device_id="device-1")["status"], "concluida")
        openings = [call for call in self.transport.calls if call[0] == "/api/conector/remessa"]
        self.assertEqual(openings[0][1]["chaveRequisicao"], request_key)
        self.assertEqual(openings[1][1]["chaveRequisicao"], request_key)

    def test_timeout_after_server_applied_finish_is_retried_by_new_instance(self):
        self.transport.timeout_after_finish = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        self.assertEqual(self.client().sync(self.consent, device_id="device-1")["status"], "concluida")

    def test_malformed_receipt_does_not_mark_items_sent(self):
        self.transport.malformed_batch = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        self.assertEqual(self.state.load()["pending"]["paths"], ["note.md"])

    def test_malformed_open_does_not_create_delivery_state(self):
        self.transport.malformed_open = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")
        state = self.state.load()
        self.assertNotIn("deliveryId", state)
        self.assertTrue(state["requestKey"])

    def test_changed_file_requires_new_consent(self):
        (self.root / "note.md").write_text("mudou", encoding="utf-8")
        with self.assertRaises(ApprovedVersionMismatch):
            self.client().sync(self.consent, device_id="device-1")
        self.assertFalse(any(call[0].endswith("/lote") for call in self.transport.calls))

    def test_target_and_device_are_bound_before_token_use(self):
        wrong_target = self.consent.__class__(
            self.consent.root, "https://other.synthetic", self.consent.org_id, self.consent.device_id,
            self.consent.source_id, self.consent.scope_version, self.consent.mode,
            self.consent.destination, self.consent.source_config, self.consent.files,
        )
        with self.assertRaises(ConsentRequired):
            self.client().sync(wrong_target, device_id="device-1")
        with self.assertRaises(ConsentRequired):
            self.client().sync(self.consent, device_id="device-2")
        self.assertEqual(self.transport.calls, [])

    def test_missing_vault_token_fails_closed(self):
        self.vault.delete(self.client()._token_key("device-1"))
        with self.assertRaises(TokenUnavailable):
            self.client().pulse(device_id="device-1")

    def test_pulse_origin_is_bound_to_the_vault_key(self):
        other = FakeTransport()
        other.base_url = "https://other.synthetic"
        with self.assertRaises(TokenUnavailable):
            LocalConnectorClient(other, vault=self.vault, state=self.state).pulse(device_id="device-1")

    def test_pair_rejects_mismatched_org_or_token(self):
        self.transport.pair_response = {"id": "device-1", "orgId": "other-org", "token": "rcon1.other-org.device-1.x"}
        with self.assertRaises(ClientError):
            self.client().pair(org_id="org-a", pairing_id="pair-1", code="synthetic-code", name="Fixture")

    def test_finish_receipt_must_bind_delivery_source_and_counts(self):
        self.transport.malformed_finish = True
        with self.assertRaises(TransportError):
            self.client().sync(self.consent, device_id="device-1")

    def test_scope_change_and_sync_mode_are_not_silently_widened(self):
        changed = dict(self.transport.source)
        changed["excluir"] = []
        changed_consent = self.consent.__class__(
            self.consent.root, self.consent.target_url, self.consent.org_id, self.consent.device_id,
            self.consent.source_id, self.consent.scope_version, self.consent.mode,
            self.consent.destination, changed, self.consent.files,
        )
        with self.assertRaises(ConsentRequired):
            self.client().sync(changed_consent, device_id="device-1")


if __name__ == "__main__":
    unittest.main()
