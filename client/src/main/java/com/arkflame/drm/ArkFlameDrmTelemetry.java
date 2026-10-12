package com.arkflame.drm;

import java.util.Collection;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Optional, dependency-free Bukkit telemetry adapter. No Bukkit API is called from its HTTP worker. */
public final class ArkFlameDrmTelemetry {
    private static final Map<Object, TelemetrySession> SESSIONS = Collections.synchronizedMap(new IdentityHashMap<Object, TelemetrySession>());

    private ArkFlameDrmTelemetry() { }

    /** Called automatically by ArkFlameDrm.start(plugin, id) when this optional class is bundled. */
    public static void attach(final Object plugin, final String productId, final String checkEndpoint,
                              final CompletableFuture<ArkFlameDrm.Result> legacyReport) {
        if (!checkEndpoint.endsWith("/api/v1/check")) return;
        synchronized (SESSIONS) {
            if (SESSIONS.containsKey(plugin)) return;
            final TelemetrySession session = new TelemetrySession(plugin, productId, checkEndpoint.substring(0, checkEndpoint.length() - 13) + "/api/v2/events");
            SESSIONS.put(plugin, session);
            // Optional telemetry lifecycle must not wait for a failing or retrying v1 HTTP request.
            session.start();
        }
    }

    static void forget(final Object plugin, final TelemetrySession expected) {
        synchronized (SESSIONS) { SESSIONS.remove(plugin, expected); }
    }

    /** Optional explicit lifecycle hook; automatic PluginDisableEvent handling is provided for Bukkit. */
    public static void stop(final Object plugin) {
        final TelemetrySession session;
        synchronized (SESSIONS) { session = SESSIONS.remove(plugin); }
        if (session != null) session.stop();
    }

}
