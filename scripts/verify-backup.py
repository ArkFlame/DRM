#!/usr/bin/env python3
"""Inspect backup members before extraction; never trust archive-controlled paths."""
import json
import pathlib
import sys
import tarfile

ALLOWED = {'.env', 'data/drm.json', 'data/graph.json'}
if len(sys.argv) != 3:
    raise SystemExit('Usage: verify-backup.py archive.tar.gz safe-empty-output-directory')
archive, out = sys.argv[1:]
target = pathlib.Path(out)
target.mkdir(parents=True, exist_ok=True)
seen = set()
with tarfile.open(archive, 'r:gz') as tf:
    for member in tf.getmembers():
        name = member.name
        if name not in ALLOWED or not member.isfile() or member.size > 128 * 1024 * 1024 or name in seen:
            raise ValueError('Unexpected or unsafe backup member: ' + name)
        seen.add(name)
        value = tf.extractfile(member).read()
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open('xb') as f:
            f.write(value)
        dest.chmod(0o600)
if seen != ALLOWED:
    raise ValueError('Incomplete backup members: ' + str(ALLOWED - seen))
for name in ('data/drm.json', 'data/graph.json'):
    with (target / name).open('rb') as f:
        if not isinstance(json.load(f), dict):
            raise ValueError('Invalid JSON object in ' + name)
print('BACKUP_ARCHIVE_STRUCTURE_PASS')
