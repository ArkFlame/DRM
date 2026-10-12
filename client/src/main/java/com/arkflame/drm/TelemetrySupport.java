package com.arkflame.drm;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Array;
import java.util.Collection;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Stateless Bukkit reflection, bounded encoding and node identifier persistence. */
final class TelemetrySupport {
    private TelemetrySupport() { }
    /** Report only JAR basename; never expose an installation path. */
    static String jarFileName(final Object plugin) {
        try {
            final java.security.CodeSource source = plugin.getClass().getProtectionDomain().getCodeSource();
            if (source == null || source.getLocation() == null) return "";
            final String file = new File(source.getLocation().toURI()).getName();
            return file.toLowerCase(java.util.Locale.ROOT).endsWith(".jar") ? limited(file, 160) : "";
        } catch (final SecurityException | java.net.URISyntaxException ignored) {
            return "";
        }
    }

    static String stableId(final Path path) throws IOException {
        Files.createDirectories(path.getParent());
        // Lock sibling, not the target being atomically replaced, across plugin classloaders.
        synchronized (java.nio.channels.FileChannel.class) {
        try (java.nio.channels.FileChannel channel = java.nio.channels.FileChannel.open(
                path.resolveSibling(path.getFileName() + ".lock"),
                java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.WRITE);
             java.nio.channels.FileLock ignored = channel.lock()) {
            if (Files.isRegularFile(path) && Files.size(path) <= 128) {
                try { return UUID.fromString(new String(Files.readAllBytes(path), StandardCharsets.UTF_8).trim()).toString(); }
                catch (final IllegalArgumentException invalid) { /* Invalid ID is repaired under the lock. */ }
            }
            final String id = UUID.randomUUID().toString();
            final Path tmp = Files.createTempFile(path.getParent(), ".drm-", ".tmp");
            try {
                Files.write(tmp, id.getBytes(StandardCharsets.UTF_8));
                try { Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
                catch (final java.nio.file.AtomicMoveNotSupportedException unavailable) {
                    Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally { Files.deleteIfExists(tmp); }
            return id;
        }
        }
    }

    static boolean foliaRuntime() {
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer", false,
                    ArkFlameDrmTelemetry.class.getClassLoader());
            return true;
        } catch (final ClassNotFoundException ignored) { return false; }
    }

    static Object call(final Object obj, final String method) throws Exception {
        return obj.getClass().getMethod(method).invoke(obj);
    }

    static Iterable<?> asCollection(final Object object) {
        if (object instanceof Collection<?>) return (Collection<?>) object;
        if (object != null && object.getClass().isArray()) {
            final List<Object> values = new ArrayList<Object>();
            for (int i = 0; i < Array.getLength(object); i++) values.add(Array.get(object, i));
            return values;
        }
        return Collections.emptyList();
    }

    static String array(final List<String> values) { return "[" + String.join(",", values) + "]"; }
    static String number(final Object input) { return input instanceof Number ? String.valueOf(((Number) input).intValue()) : "0"; }
    static String limited(final String input, final int max) { return input.length() > max ? input.substring(0, max) : input; }
    static String quote(final String input) {
        return "\"" + ClientJson.escape(input) + "\"";
    }
}
