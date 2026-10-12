#!/usr/bin/env python3
"""Publish versioned Java artifacts to the static Maven repository without dropping history."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import re
import shutil
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MODEL = {'m': 'http://maven.apache.org/POM/4.0.0'}
VERSION = re.compile(r'\d+\.\d+\.\d+')


def checksum(path: Path) -> None:
    payload = path.read_bytes()
    for algorithm in ('sha1', 'sha256'):
        path.with_name(path.name + '.' + algorithm).write_text(hashlib.new(algorithm, payload).hexdigest())


def publish(root: Path, jar: Path) -> str:
    pom = root / 'client/pom.xml'
    xml = ET.parse(pom).getroot()
    coordinates = [xml.findtext(f'm:{key}', namespaces=MODEL) for key in ('groupId', 'artifactId', 'version')]
    if any(not value for value in coordinates):
        raise ValueError('Maven coordinates missing from client/pom.xml')
    group, artifact, version = coordinates
    if not VERSION.fullmatch(version) or not jar.is_file():
        raise ValueError('Expected release version X.Y.Z and existing client JAR')
    base = root / 'web/public/maven' / Path(*group.split('.')) / artifact
    out = base / version
    artifacts = ((jar, f'{artifact}-{version}.jar'), (pom, f'{artifact}-{version}.pom'))
    if out.exists():
        # Maven coordinates are immutable: replacing an existing release silently
        # creates different dependency bytes for consumers with cached artifacts.
        for source, name in artifacts:
            dest = out / name
            if not dest.is_file() or source.read_bytes() != dest.read_bytes():
                raise ValueError(f'Published release {version} differs: {name}; increment version')
    out.mkdir(parents=True, exist_ok=True)
    for source, name in artifacts:
        dest = out / name
        if source.resolve() != dest.resolve():
            shutil.copyfile(source, dest)
        checksum(dest)

    # Only advertise fully published versions, never a stale/incomplete directory.
    versions = sorted((entry.name for entry in base.iterdir()
                       if entry.is_dir() and VERSION.fullmatch(entry.name)
                       and (entry / f'{artifact}-{entry.name}.jar').is_file()
                       and (entry / f'{artifact}-{entry.name}.pom').is_file()),
                      key=lambda item: tuple(map(int, item.split('.'))))
    latest = versions[-1]
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    metadata = ET.Element('metadata')
    ET.SubElement(metadata, 'groupId').text = group
    ET.SubElement(metadata, 'artifactId').text = artifact
    v = ET.SubElement(metadata, 'versioning')
    ET.SubElement(v, 'latest').text = latest
    ET.SubElement(v, 'release').text = latest
    items = ET.SubElement(v, 'versions')
    for item in versions:
        ET.SubElement(items, 'version').text = item
    ET.SubElement(v, 'lastUpdated').text = stamp
    descriptor = base / 'maven-metadata.xml'
    ET.ElementTree(metadata).write(descriptor, encoding='utf-8', xml_declaration=True)
    checksum(descriptor)

    # Static web/public is the durable publication source; dist is generated output.
    # Builds from Git may have no dist directory, but older public releases still exist.
    shutil.copytree(root / 'web/public/maven', root / 'dist/maven', dirs_exist_ok=True)
    return f'{group}:{artifact}:{version}'


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/publish-maven.py <client-jar>')
    print('MAVEN_COORDINATES=' + publish(ROOT, Path(sys.argv[1])))
    print('MAVEN_REPOSITORY=https://drm.arkflame.com/maven/')
