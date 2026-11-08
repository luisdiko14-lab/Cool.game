import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

import auth


class AccountStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "accounts.enc"
        self.store = auth.AccountStore(self.path, Fernet.generate_key())

    def test_account_requires_consent_and_encrypts_records(self):
        user = self.store.register("pilot_one", "pilot@example.test", "long-test-password-123")
        self.assertEqual(user["permissions"], [])
        self.assertEqual(self.store.authenticate("pilot@example.test", "long-test-password-123")["id"], user["id"])
        self.assertEqual(self.store.authorize(user["id"])["permissions"], list(auth.PERMISSIONS))
        self.assertNotIn(b"pilot@example.test", self.path.read_bytes())
        self.assertNotIn(b"long-test-password-123", self.path.read_bytes())

    def test_wrong_password_is_rejected(self):
        self.store.register("pilot_one", "pilot@example.test", "long-test-password-123")
        with self.assertRaises(auth.AccountError):
            self.store.authenticate("pilot@example.test", "not-the-password")

    def test_return_path_must_be_local(self):
        self.assertEqual(auth.safe_return_path("/"), "/")
        self.assertEqual(auth.safe_return_path("//example.test/path"), "/")
        self.assertEqual(auth.safe_return_path("https://example.test/"), "/")


if __name__ == "__main__":
    unittest.main()