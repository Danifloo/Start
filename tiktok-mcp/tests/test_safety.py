"""Offline guardrail tests. These never publish videos to TikTok."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ACCOUNT, MAX_FILE_SIZE, validated_path  # noqa: E402


class FileValidationTests(unittest.TestCase):
    def test_accepts_safe_hex_video_id(self):
        file_path = validated_path("0123456789abcdef0123456789abcdef")
        self.assertEqual(file_path.name, "0123456789abcdef0123456789abcdef.mp4")

    def test_rejects_directory_traversal(self):
        for bad_id in ("../secret", "../../secrets", "/etc/passwd", "", "a" * 31, "a" * 33):
            with self.subTest(bad_id=bad_id):
                with self.assertRaises(ValueError):
                    validated_path(bad_id)

    def test_account_config_normalization(self):
        self.assertNotIn("@", ACCOUNT)

    def test_video_upload_has_explicit_prototype_size_limit(self):
        self.assertEqual(MAX_FILE_SIZE, 64 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
