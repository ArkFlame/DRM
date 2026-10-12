package com.arkflame.drm;

import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;

public final class OptOutTelemetryTest {
    public static final class FakePlugin implements org.bukkit.plugin.Plugin {
        private final File folder;
        private final FakeServer server = new FakeServer();
        public FakePlugin(final File folder) { this.folder = folder; }
        public File getDataFolder() { return folder; }
        public FakeServer getServer() { return server; }
    }

    public static final class FakeServer {
        private final FakeManager manager = new FakeManager();
        public FakeManager getPluginManager() { return manager; }
    }
    public static final class FakeManager {
        private int registrations;
        public void registerEvent(final Class<?> type, final org.bukkit.event.Listener marker,
                final org.bukkit.event.EventPriority priority, final org.bukkit.plugin.EventExecutor executor,
                final org.bukkit.plugin.Plugin plugin) { registrations++; }
    }

    public static void main(final String[] args) throws Exception {
        final File folder = Files.createTempDirectory("drm-optout").toFile();
        final FakePlugin plugin = new FakePlugin(folder);
        final TelemetrySession session = new TelemetrySession(plugin, "fairplay", "http://127.0.0.1:9999/api/v2/events");
        try {
            session.start();
            if (!session.worker.awaitTermination(3, TimeUnit.SECONDS))
                throw new AssertionError("Disabled optional telemetry must close its unused executor");
            if (session.enabled) throw new AssertionError("Disabled optional telemetry must remain disabled");
            if (plugin.server.manager.registrations != 0)
                throw new AssertionError("Opted-out telemetry must not install Bukkit listeners");
            System.out.println("JAVA_OPT_OUT_TEST_PASS=4");
        } finally {
            session.stop();
        }
        final java.util.concurrent.CompletableFuture<ArkFlameDrm.Result> reported = new java.util.concurrent.CompletableFuture<>();
        ArkFlameDrmTelemetry.attach(plugin, "fairplay", "http://127.0.0.1:9999/api/v1/check", reported);
        if (plugin.server.manager.registrations != 0)
            throw new AssertionError("Attach must not register event listeners before consent is loaded");
        final java.lang.reflect.Field sessionsField = ArkFlameDrmTelemetry.class.getDeclaredField("SESSIONS");
        sessionsField.setAccessible(true);
        final java.util.Map<?, ?> sessions = (java.util.Map<?, ?>) sessionsField.get(null);
        final TelemetrySession managed = (TelemetrySession) sessions.get(plugin);
        // No callback is completed: v2 initialization now proceeds independently of v1 HTTP.
        // It may have already removed itself from the registry before this lookup.
        if (reported.isDone()) throw new AssertionError("Unexpected v1 completion");
        if (managed != null && !managed.worker.awaitTermination(3, TimeUnit.SECONDS))
            throw new AssertionError("Opted-out attached telemetry must terminate its worker without v1 report");
        if (sessions.containsKey(plugin))
            throw new AssertionError("Opted-out telemetry must release the plugin from the registry");
        if (plugin.server.manager.registrations != 0)
            throw new AssertionError("Opted-out attached telemetry must not register Bukkit listeners");
        final TelemetrySession networkOnly = new TelemetrySession(plugin, "fairplay", "http://127.0.0.1:9999/api/v2/events");
        try {
            if (!networkOnly.register()) throw new AssertionError("Unable to register network-only lifecycle handler");
            if (plugin.server.manager.registrations != 1)
                throw new AssertionError("Network-only telemetry must register disable event, not player events");
        } finally {
            networkOnly.stop();
        }
    }
}
