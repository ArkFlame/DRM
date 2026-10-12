"""Backup parser must reject unsafe or incomplete archives before any restore."""
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


class BackupToolTests(unittest.TestCase):
    def test_verifier_rejects_traversal_and_symlink(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='drm-backup-unsafe-') as tmp:
            for invalid_name, symlink in (('../.env', False), ('data/drm.json', True)):
                archive = Path(tmp) / ('invalid-link.tgz' if symlink else 'invalid-path.tgz')
                with tarfile.open(archive, 'w:gz') as tf:
                    member = tarfile.TarInfo(invalid_name)
                    if symlink:
                        member.type = tarfile.SYMTYPE
                        member.linkname = '/etc/passwd'
                    else:
                        data = b'{}'
                        member.size = len(data)
                    tf.addfile(member, None if symlink else io.BytesIO(data))
                result = subprocess.run(['python3', str(root/'scripts/verify-backup.py'), str(archive), str(Path(tmp)/'out')], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)

    def test_verifier_requires_all_members(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='drm-backup-partial-') as tmp:
            archive = Path(tmp) / 'incomplete.tgz'
            with tarfile.open(archive, 'w:gz') as tf:
                data = b'{}'
                member = tarfile.TarInfo('data/drm.json')
                member.size = len(data)
                tf.addfile(member, io.BytesIO(data))
            result = subprocess.run(['python3', str(root/'scripts/verify-backup.py'), str(archive), str(Path(tmp)/'out')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
