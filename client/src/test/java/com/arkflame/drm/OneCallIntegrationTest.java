package com.arkflame.drm;

import com.sun.net.httpserver.HttpServer;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class OneCallIntegrationTest {
    public static final class Manager {
        private final Map<Class<?>, EventExecutor> listeners = new HashMap<>();
        public void registerEvent(Class<?> type, Listener marker, EventPriority priority, EventExecutor executor, Plugin plugin) {
            listeners.put(type, executor);
        }
        public void fire(Event event) {
            final EventExecutor executor = listeners.get(event.getClass());
            if (executor != null) executor.execute(null, event);
        }
    }
    public static final class GlobalScheduler {
        public void execute(Plugin plugin, Runnable runnable) { runnable.run(); }
    }
    public static final class Description {
        public String getName() { return "FairPlay"; }
        public String getVersion() { return "1.2"; }
    }
    public static final class Server {
        final Manager manager = new Manager();
        final GlobalScheduler scheduler = new GlobalScheduler();
        public Manager getPluginManager() { return manager; }
        public GlobalScheduler getGlobalRegionScheduler() { return scheduler; }
        public String getVersion() { return "Paper-test"; }
        public int getPort() { return 25565; }
        public int getMaxPlayers() { return 100; }
        public java.util.Collection<Object> getOnlinePlayers() { return Collections.emptyList(); }
        public java.util.Set<Object> getOperators() { return Collections.emptySet(); }
    }
    public static final class FakePlugin implements Plugin {
        private final File folder;
        final Server server = new Server();
        public FakePlugin(File folder) { this.folder = folder; }
        public File getDataFolder() { return folder; }
        public Description getDescription() { return new Description(); }
        public Server getServer() { return server; }
    }
    public static final class Player {
        final UUID id = UUID.randomUUID();
        public UUID getUniqueId() { return id; }
        public String getName() { return "OneCall"; }
        public boolean isOp() { return true; }
    }
    private static void check(boolean value, String msg) { if (!value) throw new AssertionError(msg); }
    public static void main(String[] args) throws Exception {
        final Path pluginsDir = Files.createTempDirectory("drm-one-call");
        final File dataDir = pluginsDir.resolve("FairPlay").toFile();
        final Path config = dataDir.toPath().resolve("arkflame-drm/telemetry.properties");
        Files.createDirectories(config.getParent());
        Files.write(config, ("network.enabled=true\nplayers.enabled=true\noperators.enabled=false\n"
                + "plugins.enabled=false\nmachine.enabled=false\n").getBytes(StandardCharsets.UTF_8));
        final List<String> received = Collections.synchronizedList(new ArrayList<String>());
        final CountDownLatch latch = new CountDownLatch(5); // v1 + start + join + quit + stop
        final CountDownLatch started = new CountDownLatch(1);
        final HttpServer web = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        web.createContext("/api/", exchange -> {
            final ByteArrayOutputStream result = new ByteArrayOutputStream();
            final byte[] tmp = new byte[4096]; int n;
            while ((n = exchange.getRequestBody().read(tmp)) >= 0) { if (n > 0) result.write(tmp, 0, n); }
            final String event = new String(result.toByteArray(), StandardCharsets.UTF_8);
            received.add(event);
            if (event.contains("\"event\":\"session_start\"")) started.countDown();
            latch.countDown(); exchange.sendResponseHeaders(202, -1); exchange.close();
        });
        web.start();
        try {
            final FakePlugin plugin = new FakePlugin(dataDir);
            final String url = "http://127.0.0.1:" + web.getAddress().getPort() + "/api/v1/check";
            check(ArkFlameDrm.startDetected(plugin, url).get(4, TimeUnit.SECONDS).isReported(), "v1 must report");
            check(started.await(4, TimeUnit.SECONDS), "v2 start missing");
            final Player player = new Player();
            plugin.server.manager.fire(new org.bukkit.event.player.PlayerJoinEvent(player));
            plugin.server.manager.fire(new org.bukkit.event.player.PlayerQuitEvent(player));
            plugin.server.manager.fire(new org.bukkit.event.server.PluginDisableEvent(plugin));
            check(latch.await(5, TimeUnit.SECONDS), "Lifecycle event packets missing");
            check(received.stream().allMatch(x -> x.contains("\"productId\":\"FairPlay\"")), "Auto-derived product identity missing from some v1/v2 packets");
            check(received.stream().anyMatch(x -> x.contains("\"event\":\"player_seen\"")), "Player full event missing");
            check(received.stream().anyMatch(x -> x.contains("\"event\":\"player_presence\"") && x.contains("\"online\":false")), "Quit presence missing");
            check(received.stream().anyMatch(x -> x.contains("\"event\":\"session_stop\"")), "Stop packet missing");
            check(received.stream().anyMatch(x -> x.contains("\"event\":\"session_start\"") &&
                    x.contains("\"collection\":{\"plugins\":false,\"operators\":false,\"machine\":false}")),
                    "Session start must distinguish non-consented inventory from an empty inventory");
            check(Files.isRegularFile(pluginsDir.resolve("ArkFlameDRM-node.id")), "Shared node id missing");
            System.out.println("JAVA_ONE_CALL_INTEGRATION_PASS=9");
        } finally { web.stop(0); }
    }
}
