"""Regression for importing a WAL backup from a read-only Linux mount.

Run with: python3 tests/test_sqlite_backup.py
The permission regression requires a non-root POSIX user, without sudo.
"""

from contextlib import closing
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "prepare_sqlite_backup", Path(__file__).resolve().parents[1] / "scripts" / "prepare-sqlite-backup.py"
)
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)


class SqliteBackupPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="timeteknika-backup-test-")
        self.directory = Path(self.temporary.name)
        self.active = self.directory / "active.sqlite"
        self.source = sqlite3.connect(self.active)
        self.source.execute("PRAGMA journal_mode=WAL")
        self.source.execute("PRAGMA wal_autocheckpoint=0")
        self.source.executescript("""
            CREATE TABLE entries(id TEXT PRIMARY KEY, start INTEGER, end INTEGER);
            CREATE TABLE event_log(seq INTEGER PRIMARY KEY, details_json TEXT, hash TEXT);
        """)
        self.source.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        details = '{ "description": "Étude façade", "version": 7 }'
        self.checkpoint = hashlib.sha256(details.encode()).hexdigest()
        self.source.execute("INSERT INTO entries VALUES(?,?,?)", ("preserved", 1770710400123, 1770714000456))
        self.source.execute("INSERT INTO event_log VALUES(?,?,?)", (1, details, self.checkpoint))
        self.source.commit()
        # Keep the source connection open: committed rows remain in its WAL.
        self.assertGreater(Path(str(self.active) + "-wal").stat().st_size, 32)
        self.source_bytes = self.active.read_bytes()
        self.wal_bytes = Path(str(self.active) + "-wal").read_bytes()
        self.expected = self.contents(self.source)
        self.backup = self.directory / "trial.sqlite"
        with closing(sqlite3.connect(self.backup)) as destination:
            self.source.backup(destination)
        self.assertEqual(self.backup.read_bytes()[18:20], b"\x02\x02")
        self.assertFalse(Path(str(self.backup) + "-wal").exists())
        self.assertFalse(Path(str(self.backup) + "-shm").exists())

    def tearDown(self):
        self.source.close()
        self.temporary.cleanup()

    @staticmethod
    def contents(connection):
        return {
            "entries": connection.execute("SELECT * FROM entries ORDER BY id").fetchall(),
            "event_log": connection.execute("SELECT * FROM event_log ORDER BY seq").fetchall(),
        }

    def assert_source_unchanged(self):
        self.assertEqual(self.active.read_bytes(), self.source_bytes)
        self.assertEqual(Path(str(self.active) + "-wal").read_bytes(), self.wal_bytes)
        self.assertEqual(self.contents(self.source), self.expected)
        self.assertEqual(self.source.execute("PRAGMA journal_mode").fetchone()[0], "wal")

    def test_normalizes_only_backup_preserving_committed_wal_rows_and_checkpoint(self):
        self.assertEqual(preparation.prepare_backup(self.backup)["journalMode"], "delete")
        self.assertEqual(self.backup.read_bytes()[18:20], b"\x01\x01")
        with closing(sqlite3.connect(self.backup.as_uri() + "?mode=ro", uri=True)) as snapshot:
            self.assertEqual(self.contents(snapshot), self.expected)
            self.assertEqual(snapshot.execute("SELECT hash FROM event_log WHERE seq=1").fetchone()[0], self.checkpoint)
        self.assertFalse(Path(str(self.backup) + "-wal").exists())
        self.assertFalse(Path(str(self.backup) + "-shm").exists())
        self.assert_source_unchanged()
        # Repeating preparation is harmless and keeps the same logical data.
        self.assertEqual(preparation.prepare_backup(self.backup)["integrity"], "ok")

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "geteuid") and os.geteuid() != 0,
                         "requires an unprivileged POSIX user to exercise directory permissions")
    def test_readonly_directory_reproduces_failure_then_allows_coherent_import_snapshot(self):
        readonly = self.directory / "readonly"
        readonly.mkdir()
        snapshot = readonly / "trial.sqlite"
        shutil.copyfile(self.backup, snapshot)
        try:
            snapshot.chmod(0o400)
            readonly.chmod(0o500)
            with self.assertRaises(sqlite3.OperationalError):
                with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as connection:
                    connection.execute("SELECT * FROM entries").fetchall()
            self.assertEqual(sorted(path.name for path in readonly.iterdir()), ["trial.sqlite"])
            readonly.chmod(0o700)
            snapshot.chmod(0o600)
            preparation.prepare_backup(snapshot)
            normalized = snapshot.read_bytes()
            snapshot.chmod(0o400)
            readonly.chmod(0o500)
            # Match the importer: open read-only, then SQLite's coherent backup
            # API copies it into a writable private temporary working directory.
            imported = self.directory / "import-snapshot.sqlite"
            with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as source:
                with closing(sqlite3.connect(imported)) as destination:
                    source.backup(destination)
                    self.assertEqual(self.contents(destination), self.expected)
                    self.assertEqual(destination.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(snapshot.read_bytes(), normalized)
            self.assertEqual(sorted(path.name for path in readonly.iterdir()), ["trial.sqlite"])
            self.assert_source_unchanged()
        finally:
            readonly.chmod(0o700)
            snapshot.chmod(0o600)

    def test_missing_or_invalid_file_is_not_created_or_replaced(self):
        missing = self.directory / "missing.sqlite"
        with self.assertRaises(FileNotFoundError):
            preparation.prepare_backup(missing)
        self.assertFalse(missing.exists())
        invalid = self.directory / "invalid.sqlite"
        invalid.write_bytes(b"not a SQLite backup")
        with self.assertRaises(preparation.BackupPreparationError):
            preparation.prepare_backup(invalid)
        self.assertEqual(invalid.read_bytes(), b"not a SQLite backup")
        with self.assertRaises(preparation.BackupPreparationError):
            preparation.prepare_backup(self.directory)

    def test_links_are_refused_without_changing_backup(self):
        before = self.backup.read_bytes()
        alias = self.directory / "alias.sqlite"
        try:
            alias.symlink_to(self.backup)
        except (OSError, NotImplementedError):
            self.skipTest("symbolic links unavailable for this account")
        with self.assertRaises(preparation.BackupPreparationError):
            preparation.prepare_backup(alias)
        alias.unlink()
        os.link(self.backup, alias)
        with self.assertRaises(preparation.BackupPreparationError):
            preparation.prepare_backup(alias)
        self.assertEqual(self.backup.read_bytes(), before)
        self.assert_source_unchanged()


if __name__ == "__main__":
    unittest.main(verbosity=2)
