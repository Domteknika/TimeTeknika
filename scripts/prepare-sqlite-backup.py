#!/usr/bin/env python3
"""Make a private, frozen SQLite backup readable on a read-only mount.

Only call this on the migration's trial/final backup copies, never the live
database. SQLite's backup API preserves WAL mode in its destination header;
reading that destination can otherwise require creating WAL/SHM sidecars.
"""

import json
import os
from pathlib import Path
import sqlite3
import stat
import sys


class BackupPreparationError(ValueError):
    pass


def prepare_backup(filename):
    path = Path(os.path.abspath(os.fspath(filename)))
    # These files are created in a private migration directory. Refuse aliases
    # so changing a copy's journal mode cannot change another file by accident.
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise BackupPreparationError("Un lien ne peut pas être une sauvegarde privée.")
    metadata = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise BackupPreparationError("Une copie de sauvegarde régulière et unique est requise.")
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(str(path) + suffix)
        if sidecar.is_symlink():
            raise BackupPreparationError("Un fichier annexe ne doit pas être un lien.")
        if sidecar.exists():
            details = sidecar.stat(follow_symlinks=False)
            if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
                raise BackupPreparationError("Fichier annexe de sauvegarde incompatible.")
    with path.open("rb") as source:
        if source.read(16) != b"SQLite format 3\x00":
            raise BackupPreparationError("Le fichier ne contient pas une sauvegarde SQLite.")

    # mode=rw refuses to create a missing database. This connection is closed
    # before the caller mounts the backup read-only for validation and import.
    connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=5)
    try:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupPreparationError("Intégrité de la sauvegarde SQLite invalide.")
        mode = connection.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
        if mode != "delete":
            raise BackupPreparationError("Impossible de préparer une sauvegarde SQLite autonome.")
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupPreparationError("Intégrité de la sauvegarde SQLite invalide après préparation.")
    finally:
        connection.close()
    with path.open("rb") as source:
        source.seek(18)
        if source.read(2) != b"\x01\x01":
            raise BackupPreparationError("Le mode de la sauvegarde SQLite est inattendu.")
    if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise BackupPreparationError("La sauvegarde SQLite conserve des fichiers annexes.")
    return {"status": "prepared", "journalMode": "delete", "integrity": "ok"}


def main(arguments):
    if len(arguments) != 1:
        raise BackupPreparationError("Indiquer uniquement le chemin de la copie de sauvegarde privée.")
    print(json.dumps(prepare_backup(arguments[0])))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, sqlite3.Error, BackupPreparationError) as error:
        # Never expose source rows, filesystem paths or a raw SQLite exception.
        diagnostic = {"status": "failed", "code": "SQLITE_BACKUP_PREPARATION_FAILED"}
        if isinstance(error, sqlite3.Error) and isinstance(getattr(error, "sqlite_errorcode", None), int):
            diagnostic["sqliteCode"] = error.sqlite_errorcode
        if isinstance(error, OSError) and isinstance(error.errno, int):
            diagnostic["systemCode"] = error.errno
        print(json.dumps(diagnostic), file=sys.stderr)
        sys.exit(1)
