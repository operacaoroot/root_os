import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
import sys
import stat
from types import SimpleNamespace

from preview import preview, is_hidden, is_link, matches_exclusion


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'context.md').write_text('Contexto sintético', encoding='utf-8')

    def paths(self, result):
        return [f['path'] for f in result['files']]

    def test_metadata_only_and_no_absolute_path(self):
        with patch.object(Path, 'read_text', side_effect=AssertionError('Conteúdo lido')):
            result = preview(self.root)
        self.assertEqual(self.paths(result), ['context.md'])
        self.assertFalse(result['authorizesUpload'])
        self.assertNotIn(str(self.root), str(result))
        self.assertNotIn('Contexto sintético', str(result))

    def test_subfolders_require_selection_and_exclusions_apply(self):
        (self.root / 'team').mkdir()
        (self.root / 'team' / 'guide.txt').write_text('Guia')
        self.assertEqual(self.paths(preview(self.root)), ['context.md'])
        self.assertEqual(self.paths(preview(self.root, recursive=True)), ['context.md', 'team/guide.txt'])
        self.assertEqual(self.paths(preview(self.root, recursive=True, exclude=['team/*'])), ['context.md'])

    def test_protected_names_and_symlinks_are_not_selected(self):
        (self.root / '.env').write_text('synthetic')
        (self.root / 'credentials.json').write_text('{}')
        (self.root / 'private.key').write_text('synthetic')
        (self.root / 'alias.md').symlink_to(self.root / 'context.md')
        (self.root / 'loop').symlink_to(self.root, target_is_directory=True)
        result = preview(self.root, recursive=True, extensions=['.md', '.json', '.key'])
        self.assertEqual(self.paths(result), ['context.md'])
        self.assertEqual(len(result['skipped']), 5)

    def test_single_file_and_missing_source(self):
        self.assertEqual(self.paths(preview(self.root / 'context.md')), ['context.md'])
        self.assertFalse(preview(self.root / 'missing')['complete'])

    def test_source_symlink_is_refused(self):
        (self.root / 'alias').symlink_to(self.root, target_is_directory=True)
        self.assertFalse(preview(self.root / 'alias')['complete'])

    def test_windows_only_symlink_and_junction_reparse_tags_are_links(self):
        self.assertTrue(is_link(SimpleNamespace(st_mode=stat.S_IFDIR, st_reparse_tag=0xA0000003)))
        self.assertTrue(is_link(SimpleNamespace(st_mode=stat.S_IFREG, st_reparse_tag=0xA000000C)))
        self.assertFalse(is_link(SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=0x400,
                                                 st_reparse_tag=0x9000001A)))
        self.assertFalse(is_link(SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0)))

    def test_windows_hidden_attribute_and_case_insensitive_exclusion(self):
        self.assertTrue(is_hidden('visible.txt', SimpleNamespace(st_file_attributes=0x2)))
        self.assertFalse(is_hidden('visible.txt', SimpleNamespace(st_file_attributes=0)))
        self.assertTrue(matches_exclusion('Privado/Plano.TXT', 'privado/*.txt', windows=True))
        self.assertFalse(matches_exclusion('Privado/Plano.TXT', 'privado/*.txt', windows=False))

    def test_link_to_outside_selection_does_not_list_external_content(self):
        with tempfile.TemporaryDirectory() as outside:
            (Path(outside) / 'outside-only.txt').write_text('Não autorizado')
            (self.root / 'external').symlink_to(outside, target_is_directory=True)
            result = preview(self.root, recursive=True)
        self.assertEqual(self.paths(result), ['context.md'])
        self.assertNotIn('outside-only', str(result))

    def test_unreadable_directory_is_not_a_successful_empty_snapshot(self):
        with patch('preview.os.scandir', side_effect=PermissionError('private path')):
            result = preview(self.root)
        self.assertFalse(result['complete'])
        self.assertEqual(result['errors'], [{'path': '.', 'reason': 'unreadable_directory'}])
        self.assertNotIn('private path', str(result))

    def test_cli_signals_incomplete_preview(self):
        process = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('preview.py')), str(self.root / 'absent')],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(process.returncode, 3)
        self.assertIn('"complete": false', process.stdout)
        self.assertEqual(process.stderr, '')

    def test_limits_do_not_silently_complete(self):
        (self.root / 'more.txt').write_text('Teste')
        self.assertFalse(preview(self.root, max_entries=1)['complete'])
        self.assertEqual(self.paths(preview(self.root, max_bytes=1)), [])
        (self.root / 'deep').mkdir()
        self.assertFalse(preview(self.root, recursive=True, max_depth=0)['complete'])

    def test_unsupported_file_is_explicit(self):
        (self.root / 'report.pdf').write_bytes(b'synthetic')
        result = preview(self.root)
        self.assertIn({'path': 'report.pdf', 'reason': 'unsupported_type'}, result['skipped'])

    def test_invalid_limits(self):
        with self.assertRaises(ValueError):
            preview(self.root, max_entries=0)

    def test_cli_exposes_depth_limit_and_argparse_keeps_distinct_exit(self):
        invalid = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('preview.py')), str(self.root), '--max-depth', '-1'],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(invalid.returncode, 2)
        self.assertIn('Limites inválidos', invalid.stderr)


if __name__ == '__main__':
    unittest.main()
