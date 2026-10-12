# Embed DRM into Bukkit/Spigot/Paper/Folia plugins

## Maven — add repository + dependency

```xml
<repositories>
  <repository>
    <id>arkflame</id>
    <url>https://drm.arkflame.com/maven/</url>
  </repository>
</repositories>
<dependencies>
  <dependency>
    <groupId>com.arkflame</groupId>
    <artifactId>arkflame-drm-client</artifactId>
    <version>0.6.3</version>
  </dependency>
</dependencies>
```

The dependency is a library, **not** a separately installable Bukkit plugin. It must be shaded into the plugin JAR. Example Maven Shade plugin, adjusted to your existing plugin build rather than introducing a second shade execution:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-shade-plugin</artifactId>
  <version>3.6.1</version>
  <executions><execution><phase>package</phase><goals><goal>shade</goal></goals>
    <configuration>
      <createDependencyReducedPom>false</createDependencyReducedPom>
      <minimizeJar>false</minimizeJar>
      <relocations><relocation>
        <pattern>com.arkflame.drm</pattern>
        <shadedPattern>your.plugin.internal.drm</shadedPattern>
      </relocation></relocations>
    </configuration>
  </execution></executions>
</plugin>
```

Adjust `your.plugin.internal.drm` to your plugin's real package. Avoid duplicate relocation if your build already shades dependencies.

## Gradle — repository + dependency

```groovy
repositories {
    maven { url = uri('https://drm.arkflame.com/maven/') }
    mavenCentral()
}
dependencies {
    implementation 'com.arkflame:arkflame-drm-client:0.6.3'
}
```

If producing a standalone plugin JAR, configure your existing shadow build (e.g. Shadow plugin) to include and relocate `com.arkflame.drm` in its output. Do not distribute a plugin JAR that only compiles against the library but omits it at runtime.

## One-line use

```java
import com.arkflame.drm.ArkFlameDrm;

@Override public void onEnable() {
    ArkFlameDrm.start(this);
}
```

The product identity comes from `plugin.getDescription().getName()`, i.e. the exact case-sensitive `name:` in `plugin.yml`. `FairPlay` reports `FairPlay`; `SMP.Lifesteal` reports `SMP.Lifesteal`. No manually maintained product ID. Valid names contain 1–64 ASCII letters, digits, `_`, `-`, or `.` and begin with a letter/digit. The legacy `start(this, "custom-id")` overload remains supported; switching a deployment from an old custom ID to its Bukkit name creates a new product identity on the dashboard (installation UUID is preserved).

**Consuming plugins:** Keep their existing **Spigot API 1.21** build dependency and `api-version: '1.13'` in `plugin.yml`. Do not downgrade compile dependencies to 1.8. The DRM library itself compiles to **Java 8** and uses Bukkit methods common to 1.8–1.21 via reflection. `api-version` is a Minecraft plugin descriptor field, not a field of this standalone client library. The consuming plugin's other source code and Java target must independently support its oldest claimed runtime. Example:

```yaml
name: FairPlay
main: com.example.fairplay.FairPlayPlugin
version: '1.0'
api-version: '1.13'
```

```xml
<dependency>
  <groupId>org.spigotmc</groupId>
  <artifactId>spigot-api</artifactId>
  <version>1.21-R0.1-SNAPSHOT</version>
  <scope>provided</scope>
</dependency>
```

`spigot-api` and its repository already belong to each consuming plugin build; these snippets are illustrative, not added DRM client dependencies. The return is a `CompletableFuture`; never wait for it on server-owned threads. v2 telemetry can be stopped on shutdown through `ArkFlameDrmTelemetry.stop(this)`; the Bukkit adapter also listens for plugin disable.

## BuiltByBit

The library embeds `%%__NONCE__%%` as a literal. BuiltByBit must replace this placeholder in the **final distributed JAR**, not the repository artifact. Test that your build/shading/obfuscation preserves the token prior to marketplace delivery. A nonce identifies a download but does not independently prove a specific server is licensed or unlicensed. Never distribute a pre-watermarked JAR publicly.

## Legacy/Folia safety

The library compiles for Java 8. It has zero required Bukkit compile dependencies; optional v2 event hooks access Bukkit through reflective adapters. Network calls never run from Bukkit tick callbacks. Entity-owned Folia behavior must be verified on a live Folia server before claiming compatibility; this package does not add new unsafe runtime API references.

## BuiltByBit optional provider / resilience (v0.6.3)

A BuiltByBit token is **not required** to integrate or operate ArkFlame DRM. With `BBB_EMBED_TOKEN=` blank on the backend, no BuiltByBit API request is sent, reporting and opt-in dashboard telemetry continue, and the Licensing panel shows **Provider not configured**. Manual review works. A literal watermark placeholder not injected by the marketplace results in no nonce; this is not proof of a cracked plugin.

When the provider token is present, nonce usage-rights evidence is **nonce-only and product-unverified**. Do not claim a verified per-plugin license or automatically disable/bind it to a Bukkit name until an authoritative provider resource identity mapping has been implemented and tested. Preserve the literal `%%__NONCE__%%` constant in the final *marketplace-distributed* shaded consumer JAR; exclude that constant from string obfuscation.

V1 startup reports retry transient I/O/HTTP 429/5xx asynchronously up to four attempts with a total 7s backoff budget. Invalid HTTP 4xx (except 429) do not retry. All reporting is fail-open. Opt-in v2 session startup is independent of v1 network success. Check the backend's public HTTPS endpoint and preserve the plugin's own legal Bukkit/Folia lifecycle.
