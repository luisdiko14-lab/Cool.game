import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    def test_duplicate_email_or_username_is_rejected_case_insensitively(self):
        self.store.register("pilot_one", "pilot@example.test", "long-test-password-123")
        with self.assertRaises(auth.AccountError):
            self.store.register("pilot_two", "PILOT@example.test", "another-long-password")
        with self.assertRaises(auth.AccountError):
            self.store.register("PILOT_ONE", "other@example.test", "another-long-password")

    def test_registration_rejects_invalid_username_email_and_password(self):
        invalid_accounts = (
            ("ab", "pilot@example.test", "long-test-password-123"),
            ("pilot_one", "not-an-email", "long-test-password-123"),
            ("pilot_one", "pilot@example.test", "short"),
        )
        for username, email, password in invalid_accounts:
            with self.subTest(username=username, email=email):
                with self.assertRaises(auth.AccountError):
                    self.store.register(username, email, password)

    def test_corrupted_encrypted_account_file_is_rejected(self):
        self.store.register("pilot_one", "pilot@example.test", "long-test-password-123")
        self.path.write_bytes(b"not-a-valid-fernet-token")
        with self.assertRaisesRegex(RuntimeError, "could not be read"):
            self.store.authenticate("pilot@example.test", "long-test-password-123")

    def test_account_storage_without_key_is_disabled_safely(self):
        self.assertEqual(auth.read_encrypted_json(self.path, None), {})
        with self.assertRaisesRegex(RuntimeError, "storage is disabled"):
            auth.write_encrypted_json(self.path, {"users": {}}, None)

    def test_session_lifecycle_and_expiration(self):
        sessions = auth.SessionStore()
        token = sessions.create("user-123")
        self.assertEqual(sessions.get(token), "user-123")
        sessions.revoke(token)
        self.assertIsNone(sessions.get(token))

        expired = sessions.create("user-456")
        with mock.patch("auth.time.time", return_value=auth.time.time() + auth.SESSION_SECONDS + 1):
            self.assertIsNone(sessions.get(expired))

    def test_return_path_must_be_local(self):
        self.assertEqual(auth.safe_return_path("/"), "/")
        self.assertEqual(auth.safe_return_path("/profile?tab=scores"), "/profile?tab=scores")
        self.assertEqual(auth.safe_return_path("//example.test/path"), "/")
        self.assertEqual(auth.safe_return_path("https://example.test/"), "/")
        self.assertEqual(auth.safe_return_path("/\\\\example.test"), "/")
        self.assertEqual(auth.safe_return_path("/safe\npath"), "/")


if __name__ == "__main__":
    unittest.main()
