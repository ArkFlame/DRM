#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v mvn >/dev/null || { echo 'Maven CLI missing: install Maven 3.9+ (no wrapper)' >&2; exit 2; }
command -v npm >/dev/null || { echo 'npm CLI missing' >&2; exit 2; }
if [ ! -f web/package-lock.json ]; then
  echo 'Missing web/package-lock.json; generate and review it on a networked development host with ./scripts/generate-lockfile.sh before a reproducible production build.' >&2
  exit 2
fi
./scripts/init-env.sh
mkdir -p dist
# Preserve data and credentials. Only reproducible output directories are replaced.
mvn -B -f client/pom.xml -DskipTests package
classes=client/target/classes:client/target/test-classes
for name in ClientTest TelemetryTest OneCallIntegrationTest OptOutTelemetryTest BukkitCompatibilityTest ConcurrentIdentityTest StartupRetryTest; do
  java -cp "$classes" "com.arkflame.drm.$name"
done
client_jar="$(python3 - <<'PYBUILD'
from pathlib import Path
import xml.etree.ElementTree as ET
pom = ET.parse('client/pom.xml').getroot()
ns = {'m':'http://maven.apache.org/POM/4.0.0'}
print(pom.findtext('m:artifactId', namespaces=ns) + '-' + pom.findtext('m:version', namespaces=ns) + '.jar')
PYBUILD
)"
java -cp "client/target/$client_jar:client/target/test-classes" com.arkflame.drm.JarFilenameTest "$client_jar"
node scripts/test-java-wire.mjs
python3 -m unittest discover -s scripts/tests -v
(cd web && npm ci --no-audit --no-fund)
(cd web && npm test && npm run typecheck && npm run build)
# Only publish immutable coordinates after every client and website validation passes.
cp "client/target/$client_jar" dist/
python3 scripts/publish-maven.py "dist/$client_jar"
mkdir -p web/.next/standalone/.next
cp -a web/.next/static web/.next/standalone/.next/
cp -a web/public web/.next/standalone/
# Do not delete Maven target unless ALL steps passed.
rm -rf client/target
printf 'BUILD_PASS=1\n'
