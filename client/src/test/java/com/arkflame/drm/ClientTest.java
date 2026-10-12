package com.arkflame.drm;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class ClientTest {
    public static final class FakePlugin {
        private final java.io.File folder;
        public FakePlugin(final java.io.File folder) { this.folder = folder; }
        public java.io.File getDataFolder() { return folder; }
        public FakeDescription getDescription() { return new FakeDescription(); }
        public FakeServer getServer() { return new FakeServer(); }
    }
    public static final class FakeDescription {
        public String getVersion() { return "9.8.7"; }
        public String getName() { return "SMP.Lifesteal"; }
    }
    public static final class FakeServer {
        public String getVersion() { return "Paper-test"; }
    }

    private static void require(final boolean condition, final String problem) {
        if (!condition) throw new AssertionError(problem);
    }

    private static byte[] readFully(final java.io.InputStream input) throws java.io.IOException {
        final java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        final byte[] buffer = new byte[512];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        return output.toByteArray();
    }

    public static void main(final String[] ignored) throws Exception {
        final Path tmp = Files.createTempDirectory("arkflame-java-test");
        final AtomicReference<String> payload = new AtomicReference<String>();
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/check", (HttpExchange exchange) -> {
            payload.set(new String(readFully(exchange.getRequestBody()), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(202, -1);
            exchange.close();
        });
        server.start();
        try {
            final String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/check";
            final long begin = System.nanoTime();
            final ArkFlameDrm.Result result = ArkFlameDrm.start(tmp.toFile(), "fairplay", "1.2.3", "Paper 1.21-test", endpoint).get(3, TimeUnit.SECONDS);
            require(result.isReported(), "Expected successful report");
            require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - begin) < 2900, "Unreasonable send delay");
            final String id = new String(Files.readAllBytes(tmp.resolve("arkflame-drm/installation.id")), StandardCharsets.US_ASCII);
            require(payload.get().contains(id), "Installation ID missing from payload");
            require(!payload.get().contains("%%__NONCE__%%"), "Unresolved BuiltByBit nonce leaked");
            require(ArkFlameDrm.start(tmp.toFile(), "fairplay", "1.2.3", "Paper 1.21-test", endpoint).get(3, TimeUnit.SECONDS).isReported(), "Restart report failed");
            require(new String(Files.readAllBytes(tmp.resolve("arkflame-drm/installation.id")), StandardCharsets.US_ASCII).equals(id), "Installation ID changed");
            require(ArkFlameDrm.start(new FakePlugin(tmp.toFile()), "fairplay", endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Convenience integration must report");
            require(payload.get().contains("9.8.7") && payload.get().contains("Paper-test"),
                    "Convenience integration must inspect plugin metadata");
            require(ArkFlameDrm.startDetected(new FakePlugin(tmp.toFile()), endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Auto identity must report");
            require(payload.get().contains("\"productId\":\"SMP.Lifesteal\""),
                    "Bukkit name case and punctuation must be preserved");
            require(ArkFlameDrm.start(tmp.toFile(), "X", "1", "Paper", endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Single-character Bukkit plugin name must be accepted");
            require(!ArkFlameDrm.start(tmp.toFile(), "Invalid name", "1", "Paper", endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Names containing spaces must be rejected");
            require(!ArkFlameDrm.start(new Object(), "fairplay", endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Unrecognized plugin must fail open");
            require(!ArkFlameDrm.start(tmp.toFile(), "INVALID NAME", "1", "Paper", endpoint).get(3, TimeUnit.SECONDS).isReported(),
                    "Bad product ID must not throw during plugin enable");
            require(!ArkFlameDrm.start(tmp.toFile(), "fairplay", "1.2.3", "Paper 1.21-test", "http://127.0.0.1:1/api/v1/check")
                    .get(14, TimeUnit.SECONDS).isReported(), "Offline report must be safely ignored");
            require(!ArkFlameDrm.start(tmp.toFile(), "fairplay", "1", "Paper",
                    "http://127.0.0.1:50@localhost:" + server.getAddress().getPort() + "/api/v1/check")
                    .get(3, TimeUnit.SECONDS).isReported(), "Reject endpoint disguised with URL credentials");
            require(!ArkFlameDrm.start(tmp.toFile(), "fairplay", "1", "Paper",
                    "http://127.0.0.1:42/api/v1/check#fragment")
                    .get(3, TimeUnit.SECONDS).isReported(), "Reject fragment in endpoint");
            require(Files.isRegularFile(tmp.resolve("arkflame-drm/installation.id")), "Data lost after offline failure");
            final String special = "line\nquote\"tab\tzero\u0000slash\\";
            require(TelemetrySupport.quote(special).equals("\"" + ClientJson.escape(special) + "\""),
                    "Telemetry and startup JSON escaping must share the same encoding");
            System.out.println("JAVA_CLIENT_TESTS_PASS=18");
        } finally {
            server.stop(0);
        }
    }
}
