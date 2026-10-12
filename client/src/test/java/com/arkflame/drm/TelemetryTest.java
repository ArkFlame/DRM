package com.arkflame.drm;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class TelemetryTest {
    public static final class FakePlugin {
        private final java.io.File data;
        FakePlugin(final java.io.File data) { this.data = data; }
        public java.io.File getDataFolder() { return data; }
    }
    public static final class FakePlayer {
        private final UUID id = UUID.randomUUID();
        public UUID getUniqueId() { return id; }
        public String getName() { return "Tester"; }
        public boolean isOp() { return true; }
    }
    private static void check(boolean value, String explanation) {
        if (!value) throw new AssertionError(explanation);
    }
    private static String body(HttpExchange exchange) throws Exception {
        final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        final byte[] bytes = new byte[1024];
        int n;
        while ((n = exchange.getRequestBody().read(bytes)) > 0) buffer.write(bytes, 0, n);
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }
    private static Field field(Class<?> cls, String name) throws Exception {
        final Field f = cls.getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }
    private static Method method(Class<?> cls, String name, Class<?>... args) throws Exception {
        final Method m = cls.getDeclaredMethod(name, args);
        m.setAccessible(true);
        return m;
    }
    public static void main(String[] args) throws Exception {
        final Path temp = Files.createTempDirectory("drm-telemetry-v2");
        final String id = UUID.randomUUID().toString();
        final List<String> packets = java.util.Collections.synchronizedList(new ArrayList<String>());
        final CountDownLatch latch = new CountDownLatch(3);
        final AtomicReference<Throwable> failure = new AtomicReference<Throwable>();
        final HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/api/v2/events", exchange -> {
            try { packets.add(body(exchange)); latch.countDown(); exchange.sendResponseHeaders(202, -1); }
            catch (Throwable problem) { failure.set(problem); exchange.sendResponseHeaders(500, -1); }
            finally { exchange.close(); }
        });
        http.start();
        Object session = null;
        final Class<?> type = Class.forName("com.arkflame.drm.TelemetrySession");
        try {
            final Constructor<?> constructor = type.getDeclaredConstructor(Object.class, String.class, String.class);
            constructor.setAccessible(true);
            session = constructor.newInstance(new FakePlugin(temp.toFile()), "fairplay",
                    "http://127.0.0.1:" + http.getAddress().getPort() + "/api/v2/events");
            field(type, "enabled").setBoolean(session, true);
            field(type, "playersEnabled").setBoolean(session, true);
            field(type, "installationId").set(session, UUID.randomUUID().toString());
            field(type, "nodeId").set(session, id);
            field(type, "needsSnapshot").setBoolean(session, false);
            final FakePlayer player = new FakePlayer();
            method(type, "profile", Object.class, boolean.class).invoke(session, player, true);
            method(type, "presence", Object.class, boolean.class).invoke(session, player, false);
            method(type, "profile", Object.class, boolean.class).invoke(session, player, true);
            check(latch.await(8, TimeUnit.SECONDS), "Expected first-seen and two presence events");
            check(failure.get() == null, "HTTP capture failed: " + failure.get());
            check(packets.size() == 3, "Unexpected packet count: " + packets.size());
            check(packets.get(0).contains("\"event\":\"player_seen\"") && packets.get(0).contains("\"op\":true"),
                    "First report must contain name/UUID/operator fields");
            check(packets.get(1).contains("\"event\":\"player_presence\"") &&
                    packets.get(1).contains("\"online\":false") && !packets.get(1).contains("\"name\""),
                    "Quit must send status only");
            check(packets.get(2).contains("\"event\":\"player_presence\"") &&
                    packets.get(2).contains("\"online\":true") && !packets.get(2).contains("\"name\""),
                    "Subsequent join must send status only");
            check(packets.stream().allMatch(x -> x.contains("\"nodeId\":\"" + id + "\"") &&
                    x.contains("\"protocolVersion\":2")), "Envelope missing stable node identity");
            final Method stable = method(TelemetrySupport.class, "stableId", Path.class);
            final Path nodeFile = temp.resolve("node.id");
            check(stable.invoke(null, nodeFile).equals(stable.invoke(null, nodeFile)), "Node UUID must persist");
            System.out.println("JAVA_V2_TELEMETRY_TEST_PASS=7");
        } finally {
            if (session != null) method(type, "stop").invoke(session);
            http.stop(0);
        }
    }
}
