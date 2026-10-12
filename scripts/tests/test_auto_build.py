"""Release bootstrap: missing dependencies and web output are repaired only via validated build."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]


class AutomaticBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='drm-bootstrap-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for relative in ('scripts/build.sh', 'scripts/start.sh', 'scripts/generate-lockfile.sh',
                         'scripts/init-env.sh', 'scripts/publish-maven.py',
                         'scripts/test-java-wire.mjs', 'client/pom.xml', 'web/package.json'):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, target)
        pom = ET.parse(self.root / 'client/pom.xml').getroot()
        self.version = pom.findtext('{http://maven.apache.org/POM/4.0.0}version')
        (self.root / 'scripts/tests').mkdir(parents=True)
        (self.root / 'scripts/tests/test_fixture.py').write_text(
            'import unittest\nclass FixtureTest(unittest.TestCase):\n    def test_fixture(self): self.assertTrue(True)\n')
        (self.root / 'bin').mkdir()
        scripts = {
            'mvn': '''#!/bin/sh
printf '%s\\n' "$*" >> mvn.log
mkdir -p client/target
printf 'fixture jar' > client/target/arkflame-drm-client-0.6.4.jar
''',
            'java': '#!/bin/sh\nexit 0\n',
            'node': '''#!/bin/sh
if [ "$1" = '.next/standalone/server.js' ]; then
  echo SERVER_STARTED
fi
''',
            'npm': '''#!/bin/sh
printf '%s\\n' "$*" >> ../npm.log
if [ "$1" = install ] && [ "$2" = --package-lock-only ]; then
  if [ "${FAIL_LOCK:-}" = 1 ]; then echo 'fixture registry unavailable' >&2; exit 37; fi
  printf '{"name":"fixture","lockfileVersion":3,"packages":{}}\\n' > package-lock.json
fi
if [ "$1" = ci ] && [ ! -f package-lock.json ]; then exit 39; fi
if [ "$1" = run ] && [ "$2" = build ]; then
  if [ "${FAIL_BUILD:-}" = 1 ]; then exit 42; fi
  mkdir -p .next/standalone .next/static
  echo '// fixture' > .next/standalone/server.js
fi
''',
        }
        for name, content in scripts.items():
            path = self.root / 'bin' / name
            path.write_text(content)
            path.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.root / 'bin') + os.pathsep + os.environ['PATH']}

    def command(self, script, **environment):
        return subprocess.run(['bash', f'scripts/{script}.sh'], cwd=self.root,
                              env={**self.env, **environment},
                              text=True, capture_output=True, timeout=30)

    def command_log(self):
        path = self.root / 'npm.log'
        return path.read_text() if path.exists() else ''

    def test_build_generates_missing_lockfile_and_uses_npm_ci(self):
        result = self.command('build')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue((self.root / 'web/package-lock.json').exists())
        self.assertIn('install --package-lock-only', self.command_log())
        self.assertIn('ci --no-audit', self.command_log())
        self.assertIn('BUILD_PASS=1', result.stdout)
        self.assertTrue((self.root / 'web/.next/standalone/.build-complete').is_file())
        self.assertTrue((self.root / 'web/.next/standalone/server.js').is_file())
        self.assertTrue((self.root / f'web/.next/standalone/public/maven/com/arkflame/arkflame-drm-client/{self.version}/arkflame-drm-client-{self.version}.jar').exists())

    def test_build_reuses_existing_lockfile(self):
        (self.root / 'web/package-lock.json').write_text('{"lockfileVersion":3,"packages":{}}')
        result = self.command('build')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('install --package-lock-only', self.command_log())
        self.assertIn('ci --no-audit', self.command_log())

    def test_missing_lockfile_generation_failure_stops_before_build_and_publication(self):
        result = self.command('build', FAIL_LOCK='1')
        self.assertEqual(result.returncode, 2)
        self.assertIn('Dependency lockfile generation failed', result.stderr)
        self.assertFalse((self.root / 'mvn.log').exists())
        self.assertFalse((self.root / 'web/.next/standalone/.build-complete').exists())
        self.assertFalse((self.root / 'web/public/maven').exists())

    def test_start_bootstraps_missing_build_and_launches(self):
        result = self.command('start')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('No completed web release', result.stderr)
        self.assertIn('SERVER_STARTED', result.stdout)
        self.assertTrue((self.root / 'web/.env').exists())
        self.assertTrue((self.root / 'web/.next/standalone/.build-complete').is_file())

    def test_start_uses_existing_complete_build_without_rebuild(self):
        out = self.root / 'web/.next/standalone'
        out.mkdir(parents=True)
        (out / 'server.js').write_text('// pre-built')
        (out / '.build-complete').write_text(f'version={self.version}\n')
        result = self.command('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SERVER_STARTED', result.stdout)
        self.assertFalse((self.root / 'mvn.log').exists())
        self.assertFalse((self.root / 'npm.log').exists())

    def test_start_rebuilds_stale_previous_release(self):
        out = self.root / 'web/.next/standalone'
        out.mkdir(parents=True)
        (out / 'server.js').write_text('// old server')
        (out / '.build-complete').write_text('version=0.6.3\n')
        result = self.command('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SERVER_STARTED', result.stdout)
        self.assertEqual((out / '.build-complete').read_text(), f'version={self.version}\n')
        self.assertTrue((self.root / 'mvn.log').exists())

    def test_start_rebuilds_incomplete_existing_output(self):
        out = self.root / 'web/.next/standalone'
        out.mkdir(parents=True)
        (out / 'server.js').write_text('// partial')
        result = self.command('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SERVER_STARTED', result.stdout)
        self.assertTrue((out / '.build-complete').is_file())
        self.assertTrue((self.root / 'mvn.log').exists())

    def test_failed_auto_build_does_not_launch_incomplete_server(self):
        result = self.command('start', FAIL_BUILD='1')
        self.assertEqual(result.returncode, 42)
        self.assertNotIn('SERVER_STARTED', result.stdout)
        self.assertFalse((self.root / 'web/.next/standalone/.build-complete').exists())
        self.assertFalse((self.root / 'web/public/maven').exists())


if __name__ == '__main__':
    unittest.main()
