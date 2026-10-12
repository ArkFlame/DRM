"""Build failures cannot publish an unverified immutable Maven version."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


class BuildPipelineTest(unittest.TestCase):
    def test_failed_frontend_build_does_not_publish(self):
        root = Path(__file__).resolve().parents[2]
        pom = ET.parse(root / 'client/pom.xml').getroot()
        version = pom.findtext('{http://maven.apache.org/POM/4.0.0}version')
        artifact = f'arkflame-drm-client-{version}.jar'
        with tempfile.TemporaryDirectory(prefix='drm-build-failure-') as workspace:
            dest = Path(workspace)
            (dest / 'scripts/tests').mkdir(parents=True)
            (dest / 'client').mkdir()
            (dest / 'web').mkdir()
            (dest / 'web/package-lock.json').write_text('{"lockfileVersion":3,"packages":{}}')
            (dest / 'bin').mkdir()
            for path in ('scripts/build.sh', 'scripts/init-env.sh', 'scripts/publish-maven.py',
                         'scripts/test-java-wire.mjs', 'scripts/tests/test_publish_maven.py', 'client/pom.xml'):
                target = dest / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(root / path, target)
            commands = {
                'mvn': f'#!/bin/sh\nmkdir -p client/target\nprintf "fixture" > client/target/{artifact}\n',
                'java': '#!/bin/sh\nexit 0\n',
                'node': '#!/bin/sh\nexit 0\n',
                'npm': '#!/bin/sh\nif [ "$1" = run ] && [ "$2" = build ]; then exit 42; fi\nexit 0\n',
            }
            for name, script in commands.items():
                path = dest / 'bin' / name
                path.write_text(script)
                path.chmod(0o755)
            env = {**os.environ, 'PATH': str(dest / 'bin') + os.pathsep + os.environ['PATH']}
            result = subprocess.run(['bash', 'scripts/build.sh'], cwd=dest, env=env,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 42, result.stderr)
            self.assertFalse((dest / 'web/public/maven/com/arkflame/arkflame-drm-client' / version).exists())
            self.assertFalse((dest / 'dist' / artifact).exists())
