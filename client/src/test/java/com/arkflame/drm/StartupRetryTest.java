package com.arkflame.drm;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** HTTP failures are retried without blocking Bukkit or the optional telemetry lifecycle. */
public final class StartupRetryTest {
    private static void require(boolean ok, String why) { if (!ok) throw new AssertionError(why); }
    public static void main(String[] args) throws Exception {
        final Path temporary = Files.createTempDirectory("drm-startup-retry");
        final AtomicInteger attempts = new AtomicInteger();
        final AtomicInteger badRequestAttempts = new AtomicInteger();
        final CountDownLatch v2Start = new CountDownLatch(1);
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/check", request -> {
            request.getRequestBody().close();
            final int attempt = attempts.incrementAndGet();
            final int code = attempt < 3 ? 503 : 202;
            request.sendResponseHeaders(code, -1); request.close();
        });
        server.createContext("/api/v1/bad", request -> {
            badRequestAttempts.incrementAndGet(); request.getRequestBody().close();
            request.sendResponseHeaders(400, -1); request.close();
        });
        server.createContext("/api/v2/events", request -> {
            v2Start.countDown(); request.getRequestBody().close();
            request.sendResponseHeaders(202, -1); request.close();
        });
        server.start();
        try {
            final String base = "http://127.0.0.1:" + server.getAddress().getPort();
            final ArkFlameDrm.Result result = ArkFlameDrm.start(temporary.toFile(), "FairPlay", "1.0", "Paper", base + "/api/v1/check")
                    .get(12, TimeUnit.SECONDS);
            require(result.isReported(), "503 must retry and eventually report");
            require(attempts.get() == 3, "Expected exactly three attempts");
            final ArkFlameDrm.Result bad = ArkFlameDrm.start(temporary.toFile(), "FairPlay", "1.0", "Paper", base + "/api/v1/bad")
                    .get(2, TimeUnit.SECONDS);
            require(!bad.isReported() && bad.getHttpStatus() == 400 && badRequestAttempts.get() == 1, "400 must not retry");
            // First-party v2 is opt-in and must start independently from v1's retry barrier.
            final Path folder = temporary.resolve("FairPlay");
            final Path config = folder.resolve("arkflame-drm/telemetry.properties");
            Files.createDirectories(config.getParent());
            Files.write(config, "network.enabled=true\nplayers.enabled=false\nplugins.enabled=false\noperators.enabled=false\nmachine.enabled=false\n".getBytes(StandardCharsets.UTF_8));
            final OneCallIntegrationTest.FakePlugin plugin = new OneCallIntegrationTest.FakePlugin(folder.toFile());
            final long begin = System.nanoTime();
            final java.util.concurrent.CompletableFuture<ArkFlameDrm.Result> startup = ArkFlameDrm.startDetected(plugin, base + "/api/v1/check");
            require(v2Start.await(2, TimeUnit.SECONDS), "Opt-in v2 must start before v1 retries finish");
            require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - begin) < 2000, "v2 launch latency exceeded");
            require(startup.get(3, TimeUnit.SECONDS).isReported(), "Fourth request should already succeed");
            ArkFlameDrmTelemetry.stop(plugin);
            System.out.println("JAVA_STARTUP_RETRY_PASS=5");
        } finally { server.stop(0); }
    }
}
