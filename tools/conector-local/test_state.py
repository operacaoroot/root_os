import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from client import ClientError, LocalState


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    @unittest.skipUnless(os.name == "posix", "permissões POSIX não disponíveis")
    def test_state_file_is_private_and_roundtrips_metadata(self):
        path = self.root / "private" / "state.json"
        state = LocalState(path)
        state.save({"requestKey": "synthetic", "sent": ["note.md"]})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        self.assertEqual(state.load()["requestKey"], "synthetic")

    def test_parent_symlink_and_state_symlink_fail_closed(self):
        real_parent = self.root / "real"
        real_parent.mkdir()
        (self.root / "parent-link").symlink_to(real_parent, target_is_directory=True)
        with self.assertRaises(ClientError):
            LocalState(self.root / "parent-link" / "state.json").save({"ok": True})

        real_state = self.root / "real-state.json"
        real_state.write_text('{"ok":true}', encoding="utf-8")
        link = self.root / "state-link.json"
        link.symlink_to(real_state)
        with self.assertRaises(ClientError):
            LocalState(link).load()

    @unittest.skipUnless(os.name == "posix", "permissões POSIX não disponíveis")
    def test_existing_group_readable_state_is_rejected(self):
        path = self.root / "state.json"
        path.write_text('{"ok":true}', encoding="utf-8")
        path.chmod(0o644)
        with self.assertRaises(ClientError):
            LocalState(path).load()

    def test_save_open_fstat_replace_and_fsync_fail_closed_without_temp_leftovers(self):
        path = self.root / "state.json"
        state = LocalState(path)
        with patch("client.os.open", side_effect=OSError("open")):
            with self.assertRaises(ClientError):
                state.save({"ok": True})

        parent_fd = os.open(self.root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        tracked = [(parent_fd, (0, 0, 0, 0, 0))]
        with patch("client._open_anchored_root", return_value=(parent_fd, tracked)), patch("client.os.fstat", side_effect=OSError("fstat")):
            with self.assertRaises(ClientError):
                state.save({"ok": True})
        with self.assertRaises(OSError):
            os.fstat(parent_fd)

        for failing in ("fsync", "replace"):
            with patch(f"client.os.{failing}", side_effect=OSError(failing)):
                with self.assertRaises(ClientError):
                    state.save({"ok": True})
            self.assertFalse(path.exists())
            self.assertEqual(list(self.root.glob(".state.json.*")), [])


if __name__ == "__main__":
    unittest.main()
