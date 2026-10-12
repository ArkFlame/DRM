package com.arkflame.drm;

import com.sun.net.httpserver.HttpServer;
import org.bukkit.plugin.Plugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Exercises Bukkit 1.8 scheduler and online-player-array method shapes. */
public final class BukkitCompatibilityTest {
    public static final class LegacyScheduler {
        int calls;
        public void runTask(Plugin plugin, Runnable task) { calls++; task.run(); }
    }
    public static final class LegacyServer {
        final OneCallIntegrationTest.Manager manager = new OneCallIntegrationTest.Manager();
        final LegacyScheduler scheduler = new LegacyScheduler();
        final OneCallIntegrationTest.Player existing = new OneCallIntegrationTest.Player();
        public Object getPluginManager() { return manager; }
        public LegacyScheduler getScheduler() { return scheduler; }
        public String getVersion() { return "Spigot 1.8.8"; }
        public int getPort() { return 25565; }
        public int getMaxPlayers() { return 30; }
        public OneCallIntegrationTest.Player[] getOnlinePlayers() { return new OneCallIntegrationTest.Player[] { existing }; }
        public Set<Object> getOperators() { return Collections.emptySet(); }
    }
    public static final class Description {
        public String getName() { return "AuthMePremium"; }
        public String getVersion() { return "5.0"; }
    }
    public static final class LegacyPlugin implements Plugin {
        final File folder;
        final LegacyServer server = new LegacyServer();
        LegacyPlugin(File folder) { this.folder = folder; }
        public File getDataFolder() { return folder; }
        public Description getDescription() { return new Description(); }
        public LegacyServer getServer() { return server; }
    }
    private static void assertTrue(boolean value, String why) { if (!value) throw new AssertionError(why); }
    public static void main(String[] args) throws Exception {
        final Path root = Files.createTempDirectory("drm-legacy-bukkit");
        final File folder = root.resolve("AuthMePremium").toFile();
        final Path optin = folder.toPath().resolve("arkflame-drm/telemetry.properties");
        Files.createDirectories(optin.getParent());
        Files.write(optin, ("network.enabled=true\nplayers.enabled=true\noperators.enabled=false\n" +
                "plugins.enabled=false\nmachine.enabled=false\n").getBytes(StandardCharsets.UTF_8));
        final List<String> reports = Collections.synchronizedList(new ArrayList<String>());
        final CountDownLatch latch = new CountDownLatch(4);
        final CountDownLatch existingPlayerReceived = new CountDownLatch(1);
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/", exchange -> {
            final ByteArrayOutputStream body = new ByteArrayOutputStream();
            final byte[] buffer = new byte[1024];
            int n;
            while ((n = exchange.getRequestBody().read(buffer)) != -1) if (n > 0) body.write(buffer, 0, n);
            final String report = new String(body.toByteArray(), StandardCharsets.UTF_8);
            reports.add(report);
            if (report.contains("\"event\":\"player_seen\"")) existingPlayerReceived.countDown();
            latch.countDown();
            exchange.sendResponseHeaders(202, -1); exchange.close();
        });
        server.start();
        try {
            final LegacyPlugin plugin = new LegacyPlugin(folder);
            final String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/check";
            assertTrue(ArkFlameDrm.startDetected(plugin, endpoint).get(4, TimeUnit.SECONDS).isReported(), "Bukkit 1.8 v1 report missing");
            assertTrue(existingPlayerReceived.await(5, TimeUnit.SECONDS), "Legacy getOnlinePlayers() array not observed");
            assertTrue(plugin.server.scheduler.calls > 0, "Bukkit 1.8 runTask fallback never selected");
            ArkFlameDrmTelemetry.stop(plugin);
            assertTrue(latch.await(5, TimeUnit.SECONDS), "Bukkit 1.8 lifecycle packets missing");
            assertTrue(reports.stream().allMatch(s -> s.contains("\"productId\":\"AuthMePremium\"")), "Product name mismatch");
            assertTrue(reports.stream().anyMatch(s -> s.contains("\"event\":\"player_seen\"")), "Existing players from array were not captured");
            assertTrue(reports.stream().anyMatch(s -> s.contains("\"event\":\"session_stop\"")), "Stop event missing");
            System.out.println("JAVA_BUKKIT_1_8_SHAPE_TEST_PASS=5");
        } finally { server.stop(0); }
    }
}
