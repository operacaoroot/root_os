from contextlib import redirect_stderr, redirect_stdout
import getpass
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings

import cli
from client import LocalConnectorClient, LocalState
from preview import preview
from secure_store import MemoryVault
from test_client import FakeTransport


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "selection"
        self.root.mkdir()
        (self.root / "note.md").write_text("fixture CLI\n", encoding="utf-8")
        self.api = "https://connector.synthetic"
        self.source = FakeTransport().source

    def test_approve_summary_requires_human_confirmation_and_syncs_from_saved_files(self):
        preview_path = Path(self.temp.name).resolve() / "preview.json"
        pulse_path = Path(self.temp.name).resolve() / "pulse.json"
        consent_path = Path(self.temp.name).resolve() / "consent.json"
        state_path = Path(self.temp.name).resolve() / "state.json"
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["--api", self.api, "preview", str(self.root), "--output", str(preview_path)]), 0)
        LocalState(pulse_path).save({"fontes": [self.source], "revogado": False})

        output = io.StringIO()
        with patch("builtins.input", return_value="sim"), redirect_stdout(output):
            self.assertEqual(cli.main([
                "--api", self.api, "approve", "--root", str(self.root),
                "--preview-json", str(preview_path), "--source-json", str(pulse_path),
                "--output", str(consent_path), "--org-id", "org-a", "--device-id", "device-1",
                "--source-id", "source-a", "--scope-version", "3", "--mode", "importacao",
            ]), 0)
        shown = output.getvalue()
        self.assertIn(self.api, shown)
        self.assertIn("org-a", shown)
        self.assertIn("device-1", shown)
        self.assertIn("private/**", shown)
        self.assertIn("note.md", shown)
        self.assertNotIn("synthetic-token", shown)

        transport = FakeTransport()
        vault = MemoryVault()
        client = LocalConnectorClient(transport, vault=vault, state=LocalState(state_path))
        vault.set(client._token_key("device-1"), "synthetic-token")
        with patch("cli.LocalConnectorClient.production", return_value=client), redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["--api", self.api, "--state", str(state_path), "sync",
                                       "--consent", str(consent_path), "--device-id", "device-1"]), 0)
        self.assertEqual(json.loads(consent_path.read_text(encoding="utf-8"))["source_id"], "source-a")

    def test_approval_without_sim_does_not_write_consent(self):
        preview_path = Path(self.temp.name).resolve() / "preview.json"
        pulse_path = Path(self.temp.name).resolve() / "pulse.json"
        consent_path = Path(self.temp.name).resolve() / "consent.json"
        LocalState(preview_path).save(preview(self.root, extensions=[".md"]))
        LocalState(pulse_path).save({"fontes": [self.source], "revogado": False})
        with patch("builtins.input", return_value="não"), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main([
                "--api", self.api, "approve", "--root", str(self.root), "--preview-json", str(preview_path),
                "--source-json", str(pulse_path), "--output", str(consent_path), "--org-id", "org-a",
                "--device-id", "device-1", "--source-id", "source-a", "--scope-version", "3", "--mode", "importacao",
            ]), 4)
        self.assertFalse(consent_path.exists())

    def test_getpass_warning_is_error_before_fallback_can_read(self):
        marker = []

        def insecure_prompt(_prompt):
            warnings.warn("echo fallback", getpass.GetPassWarning)
            marker.append("must-not-run")
            return "secret"

        stderr = io.StringIO()
        with patch("cli.LocalConnectorClient.production", side_effect=AssertionError("must not build client")), \
             patch("cli.getpass.getpass", side_effect=insecure_prompt), redirect_stderr(stderr):
            result = cli.main(["--api", self.api, "pair", "--org-id", "org-a", "--pairing-id", "pair-1", "--name", "Fixture"])
        self.assertEqual(result, 4)
        self.assertEqual(marker, [])
        self.assertNotIn("secret", stderr.getvalue())

    def test_sync_changed_file_returns_sanitized_error(self):
        preview_path = Path(self.temp.name).resolve() / "preview.json"
        pulse_path = Path(self.temp.name).resolve() / "pulse.json"
        consent_path = Path(self.temp.name).resolve() / "consent.json"
        state_path = Path(self.temp.name).resolve() / "state.json"
        LocalState(preview_path).save(preview(self.root, extensions=[".md"]))
        LocalState(pulse_path).save({"fontes": [self.source], "revogado": False})
        with patch("builtins.input", return_value="sim"), redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main([
                "--api", self.api, "approve", "--root", str(self.root), "--preview-json", str(preview_path),
                "--source-json", str(pulse_path), "--output", str(consent_path), "--org-id", "org-a",
                "--device-id", "device-1", "--source-id", "source-a", "--scope-version", "3", "--mode", "importacao",
            ]), 0)
        (self.root / "note.md").write_text("changed", encoding="utf-8")
        transport = FakeTransport(); vault = MemoryVault()
        client = LocalConnectorClient(transport, vault=vault, state=LocalState(state_path))
        vault.set(client._token_key("device-1"), "synthetic-token")
        stderr = io.StringIO()
        with patch("cli.LocalConnectorClient.production", return_value=client), redirect_stdout(io.StringIO()), redirect_stderr(stderr):
            result = cli.main(["--api", self.api, "--state", str(state_path), "sync",
                               "--consent", str(consent_path), "--device-id", "device-1"])
        self.assertEqual(result, 4)
        self.assertNotIn("Traceback", stderr.getvalue())
        self.assertNotIn(str(self.root), stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
