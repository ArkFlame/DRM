package com.arkflame.drm;

import java.io.File;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;

/** Java 8-compatible, dependency-free entry point. Bundle all client classes in your plugin. */
public final class ArkFlameDrm {
    private static final String ENDPOINT = "https://drm.arkflame.com/api/v1/check";
    // BuiltByBit replaces this literal during download. Exclude it from string obfuscation.
    private static final String BUILTBYBIT_NONCE = "%%__NONCE__%%";
    private static final int MAX_REPORT_ATTEMPTS = 4;
    private static final long[] RETRY_DELAYS_MS = { 1000, 2000, 4000 };

    private ArkFlameDrm() {
    }

    /** One-call Bukkit/Spigot/Paper/Folia integration: use the exact plugin.yml name. */
    public static CompletableFuture<Result> start(final Object plugin) {
        return startDetected(plugin, ENDPOINT);
    }

    // Package-private endpoint substitution for contract tests; production uses ENDPOINT.
    static CompletableFuture<Result> startDetected(final Object plugin, final String endpoint) {
        try {
            final Object description = plugin.getClass().getMethod("getDescription").invoke(plugin);
            final Object name = description.getClass().getMethod("getName").invoke(description);
            if (name instanceof String) return start(plugin, (String) name, endpoint);
        } catch (final Exception ignored) {
            // Incompatible hosts cannot prevent normal plugin startup.
        }
        return CompletableFuture.completedFuture(new Result(false, 0));
    }

    /** Explicit identifier retained for backwards compatibility; Bukkit name is preferred. */
    public static CompletableFuture<Result> start(final Object plugin, final String productId) {
        return start(plugin, productId, ENDPOINT);
    }

    /** Custom endpoint for tests and staging; no Bukkit dependency required. */
    public static CompletableFuture<Result> start(final Object plugin, final String productId,
                                                   final String endpoint) {
        try {
            final Method folder = plugin.getClass().getMethod("getDataFolder");
            final Object description = plugin.getClass().getMethod("getDescription").invoke(plugin);
            final Object server = plugin.getClass().getMethod("getServer").invoke(plugin);
            final File dataFolder = (File) folder.invoke(plugin);
            final String version = String.valueOf(description.getClass().getMethod("getVersion").invoke(description));
            final String platform = String.valueOf(server.getClass().getMethod("getVersion").invoke(server));
            final CompletableFuture<Result> reported = start(dataFolder, productId, version, platform, endpoint);
            if (validEndpoint(endpoint) && productId != null && productId.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}"))
                ArkFlameDrmTelemetry.attach(plugin, productId, endpoint, reported);
            return reported;
        } catch (final Exception exception) {
            return CompletableFuture.completedFuture(new Result(false, 0));
        }
    }

    /** Fire-and-forget advisory report. Never changes plugin enablement or gameplay. */
    public static CompletableFuture<Result> start(final File dataFolder, final String productId,
                                                   final String productVersion, final String serverVersion) {
        return start(dataFolder, productId, productVersion, serverVersion, ENDPOINT);
    }

    /** Endpoint override intended for local testing and private staging. */
    public static CompletableFuture<Result> start(final File dataFolder, final String productId,
                                                   final String productVersion, final String serverVersion,
                                                   final String endpoint) {
        if (dataFolder == null || productId == null || !productId.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
                || productVersion == null || serverVersion == null || !validEndpoint(endpoint)) {
            return CompletableFuture.completedFuture(new Result(false, 0));
        }
        final File folder = new File(dataFolder, "arkflame-drm");
        final CompletableFuture<Result> result = new CompletableFuture<Result>();
        final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
            final Thread thread = Executors.defaultThreadFactory().newThread(task);
            thread.setName("arkflame-drm-" + productId);
            thread.setDaemon(true);
            return thread;
        });
        try {
            final String installId = ClientIdentity.installationId(folder);
            final String nonce = BUILTBYBIT_NONCE.contains("%%__") ? "" : BUILTBYBIT_NONCE;
            final String body = "{\"protocolVersion\":1,\"productId\":\"" + ClientJson.escape(productId)
                    + "\",\"productVersion\":\"" + ClientJson.escape(ClientJson.shorten(productVersion))
                    + "\",\"installationId\":\"" + installId
                    + "\",\"serverVersion\":\"" + ClientJson.escape(ClientJson.shorten(serverVersion))
                    + "\",\"javaVersion\":\"" + ClientJson.escape(ClientJson.shorten(System.getProperty("java.version", "unknown")))
                    + "\",\"distributionNonce\":\"" + ClientJson.escape(nonce) + "\"}";
            executor.execute(new Runnable() {
                private int attempts;
                @Override public void run() {
                    int code = 0;
                    try { code = ClientHttp.post(endpoint, body); }
                    catch (final Exception ignored) { /* Network/client transport failures are bounded and never reach the game thread. */ }
                    attempts++;
                    final boolean retryable = code == 0 || code == 429 || code >= 500;
                    if (retryable && attempts < MAX_REPORT_ATTEMPTS) {
                        executor.schedule(this, RETRY_DELAYS_MS[attempts - 1], TimeUnit.MILLISECONDS);
                        return;
                    }
                    result.complete(new Result(code >= 200 && code < 300, code));
                    executor.shutdown();
                }
            });
        } catch (final Exception exception) {
            result.complete(new Result(false, 0));
            executor.shutdownNow();
        }
        return result;
    }

    private static boolean validEndpoint(final String value) {
        if (value == null) return false;
        try {
            final URI url = new URI(value);
            if (url.getUserInfo() != null || url.getFragment() != null || url.getHost() == null) return false;
            if ("https".equalsIgnoreCase(url.getScheme())) return true;
            return "http".equalsIgnoreCase(url.getScheme()) && url.getPort() > 0
                    && ("127.0.0.1".equals(url.getHost()) || "localhost".equalsIgnoreCase(url.getHost()));
        } catch (final URISyntaxException exception) {
            return false;
        }
    }

    public static final class Result {
        private final boolean reported;
        private final int httpStatus;

        private Result(final boolean reported, final int httpStatus) {
            this.reported = reported;
            this.httpStatus = httpStatus;
        }

        public boolean isReported() {
            return reported;
        }

        /** Zero means no valid HTTP response was received. */
        public int getHttpStatus() {
            return httpStatus;
        }
    }
}
