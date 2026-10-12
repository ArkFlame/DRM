"""Regression tests for immutable Maven release history and metadata correctness."""
import importlib.util
from pathlib import Path
import shutil
import hashlib
import tempfile
import unittest
import xml.etree.ElementTree as ET

SOURCE = Path(__file__).resolve().parents[1] / 'publish-maven.py'
spec = importlib.util.spec_from_file_location('publish_maven', SOURCE)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class MavenPublicationTest(unittest.TestCase):
    def test_versions_remain_resolvable_after_new_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client').mkdir()
            pom = root / 'client/pom.xml'
            artifact = 'arkflame-drm-client'
            group = 'com.arkflame'
            for version in ('0.4.0', '0.4.1'):
                pom.write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                               '<groupId>com.arkflame</groupId><artifactId>arkflame-drm-client</artifactId>'
                               f'<version>{version}</version></project>')
                jar = root / f'test-{version}.jar'
                jar.write_bytes(version.encode())
                publisher.publish(root, jar)
                # dist is excluded from source control; next release must not rely on it.
                shutil.rmtree(root / 'dist')
            base = root / 'web/public/maven/com/arkflame/arkflame-drm-client'
            metadata = ET.parse(base / 'maven-metadata.xml').getroot()
            self.assertEqual([v.text for v in metadata.findall('./versioning/versions/version')], ['0.4.0', '0.4.1'])
            self.assertEqual(metadata.findtext('./versioning/release'), '0.4.1')
            for version in ('0.4.0', '0.4.1'):
                output = base / version / f'{artifact}-{version}.jar'
                self.assertEqual(output.read_bytes(), version.encode())
                self.assertEqual(output.with_suffix(output.suffix + '.sha256').read_text(), hashlib.sha256(version.encode()).hexdigest())

    def test_same_version_is_idempotent_but_cannot_overwrite_different_jar(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client').mkdir()
            (root / 'client/pom.xml').write_text('<project xmlns="http://maven.apache.org/POM/4.0.0">'
                  '<groupId>com.arkflame</groupId><artifactId>arkflame-drm-client</artifactId>'
                  '<version>0.4.2</version></project>')
            jar = root / 'release.jar'
            jar.write_bytes(b'original artifact')
            publisher.publish(root, jar)
            publisher.publish(root, jar)
            jar.write_bytes(b'changed artifact')
            with self.assertRaisesRegex(ValueError, 'increment version'):
                publisher.publish(root, jar)
            saved = root / 'web/public/maven/com/arkflame/arkflame-drm-client/0.4.2/arkflame-drm-client-0.4.2.jar'
            self.assertEqual(saved.read_bytes(), b'original artifact')
            jar.write_bytes(b'original artifact')
            (root / 'client/pom.xml').write_text((root / 'client/pom.xml').read_text() + '<!-- altered -->')
            with self.assertRaisesRegex(ValueError, 'increment version'):
                publisher.publish(root, jar)
            self.assertNotIn('altered', (saved.parent / 'arkflame-drm-client-0.4.2.pom').read_text())


if __name__ == '__main__':
    unittest.main()
