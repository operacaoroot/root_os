from types import SimpleNamespace
import ctypes
import unittest
from unittest.mock import Mock, patch

from secure_store import MacKeychainVault, MemoryVault, SecretToolVault, SecureStoreError


class SecureStoreTests(unittest.TestCase):
    def test_memory_vault_is_only_an_injected_fixture(self):
        vault = MemoryVault()
        vault.set("device-token-fixture", "synthetic-token")
        self.assertEqual(vault.get("device-token-fixture"), "synthetic-token")
        vault.delete("device-token-fixture")
        self.assertIsNone(vault.get("device-token-fixture"))

    def test_secret_tool_uses_exact_stdin_without_newline(self):
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            if command[1] == "lookup":
                return SimpleNamespace(returncode=0, stdout="synthetic-token\n")
            return SimpleNamespace(returncode=0, stdout="")

        with patch("secure_store.shutil.which", return_value="/synthetic/secret-tool"), \
             patch("secure_store.subprocess.run", side_effect=run):
            vault = SecretToolVault()
            vault.set("device-token-1", "synthetic-token")
            self.assertEqual(vault.get("device-token-1"), "synthetic-token")
        store_call = next(kwargs for command, kwargs in calls if command[1] == "store")
        self.assertEqual(store_call["input"], "synthetic-token")
        self.assertNotIn("synthetic-token", calls[0][0])

    def test_secret_tool_error_does_not_look_like_missing_secret(self):
        with patch("secure_store.shutil.which", return_value="/synthetic/secret-tool"), \
             patch("secure_store.subprocess.run", return_value=SimpleNamespace(returncode=1, stdout="")):
            vault = SecretToolVault()
            with self.assertRaises(SecureStoreError):
                vault.get("device-token-1")

    def test_keychain_adapter_fails_closed_off_macos_without_loading_real_keychain(self):
        with patch("secure_store.sys.platform", "linux"):
            with self.assertRaises(SecureStoreError):
                MacKeychainVault()

    def test_keychain_native_calls_are_mocked_for_read_update_add_and_errors(self):
        vault = MacKeychainVault.__new__(MacKeychainVault)
        vault._account = MacKeychainVault._account
        content = ctypes.create_string_buffer(b"synthetic-token")
        vault._free = Mock()
        vault._cf_release = Mock()
        vault._modify = Mock(return_value=0)
        vault._add = Mock(return_value=0)

        def found(_keychain, _service_len, _service, _account_len, _account, length, data, item):
            length._obj.value = len(b"synthetic-token")
            data._obj.value = ctypes.addressof(content)
            item._obj.value = 99
            return 0

        vault._find = Mock(side_effect=found)
        self.assertEqual(vault.get("device-token-1"), "synthetic-token")
        vault.set("device-token-1", "replacement")
        vault._modify.assert_called_once()
        self.assertGreaterEqual(vault._cf_release.call_count, 2)

        vault._find.reset_mock()
        vault._cf_release.reset_mock()
        vault._find.side_effect = None
        vault._find.return_value = -25300
        vault.set("device-token-2", "new-token")
        vault._add.assert_called_once()

        vault._find.return_value = -1
        with self.assertRaises(SecureStoreError):
            vault.get("device-token-3")
        vault._modify.return_value = -1
        vault._find.side_effect = found
        with self.assertRaises(SecureStoreError):
            vault.set("device-token-1", "replacement")


if __name__ == "__main__":
    unittest.main()
