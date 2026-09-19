import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from secure_reader import ApprovedVersionMismatch, SecureReadError, _open_anchored_root, read_secure


class SecureReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # macOS costuma ter /var -> /private/var; o leitor deve recusar esse
        # ancestral não ancorado, então a fixture usa a identidade física.
        self.root = Path(self.temp.name).resolve() / "approved"
        self.root.mkdir()
        (self.root / "nested").mkdir()
        self.file = self.root / "nested" / "note.md"
        self.file.write_bytes(b"linha 1\r\nlinha 2\n")

    def test_reads_relative_file_and_checks_raw_version(self):
        info = self.file.stat()
        raw, after = read_secure(self.root, "nested/note.md", max_bytes=1024,
                                 expected_size=info.st_size, expected_mtime_ns=info.st_mtime_ns,
                                 expected_raw_sha256=hashlib.sha256(self.file.read_bytes()).hexdigest())
        self.assertEqual(raw, b"linha 1\r\nlinha 2\n")
        self.assertEqual(after.st_ino, info.st_ino)

    def test_changed_file_after_approval_is_refused(self):
        info = self.file.stat()
        self.file.write_bytes(b"conteudo novo")
        with self.assertRaises(ApprovedVersionMismatch):
            read_secure(self.root, "nested/note.md", max_bytes=1024,
                        expected_size=info.st_size, expected_mtime_ns=info.st_mtime_ns)

    def test_absolute_or_traversal_or_symlink_components_are_refused(self):
        with self.assertRaises(SecureReadError):
            read_secure(self.root, "../outside", max_bytes=1024)
        with self.assertRaises(SecureReadError):
            read_secure(self.root, "/etc/passwd", max_bytes=1024)
        alias = self.root / "alias"
        alias.symlink_to(self.root / "nested", target_is_directory=True)
        with self.assertRaises(SecureReadError):
            read_secure(self.root, "alias/note.md", max_bytes=1024)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO não disponível")
    def test_fifo_is_nonblocking_and_not_regular_content(self):
        fifo = self.root / "pipe.txt"
        os.mkfifo(fifo)
        with self.assertRaises(SecureReadError):
            read_secure(self.root, "pipe.txt", max_bytes=1024)

    def test_root_symlink_is_refused_from_anchored_open(self):
        link = Path(self.temp.name) / "root-link"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(SecureReadError):
            read_secure(link, "nested/note.md", max_bytes=1024)

    def test_file_mutation_during_read_is_refused(self):
        original_read = os.read
        mutated = False

        def read_and_mutate(fd, size):
            nonlocal mutated
            data = original_read(fd, size)
            if data and not mutated:
                mutated = True
                self.file.write_bytes(b"conteudo trocado durante a leitura")
            return data

        with patch("secure_reader.os.read", side_effect=read_and_mutate):
            with self.assertRaises(ApprovedVersionMismatch):
                read_secure(self.root, "nested/note.md", max_bytes=1024)

    def test_anchored_open_closes_root_when_initial_fstat_fails(self):
        with patch("secure_reader.os.open", return_value=100), patch("secure_reader.os.fstat", side_effect=OSError("synthetic")), patch("secure_reader.os.close") as close:
            with self.assertRaises(OSError):
                _open_anchored_root(Path("/synthetic"))
        close.assert_called_once_with(100)

    def test_anchored_open_closes_child_when_child_fstat_fails(self):
        info = SimpleNamespace(st_dev=1, st_ino=2, st_size=0, st_mtime_ns=3, st_ctime_ns=4, st_mode=0o40755)
        calls = [info, info, info, OSError("synthetic child fstat")]
        with patch("secure_reader.os.open", side_effect=[100, 101]), patch("secure_reader.os.fstat", side_effect=calls), patch("secure_reader.os.close") as close:
            with self.assertRaises(OSError):
                _open_anchored_root(Path("/synthetic"))
        self.assertEqual({call.args[0] for call in close.call_args_list}, {100, 101})
        self.assertEqual(len(close.call_args_list), 2)


if __name__ == "__main__":
    unittest.main()
