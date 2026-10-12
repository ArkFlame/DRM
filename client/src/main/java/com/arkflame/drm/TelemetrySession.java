package com.arkflame.drm;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Lifecycle owner for one client installation's optional opt-in v2 events. */
final class TelemetrySession {
    private static final int MAX_QUEUE = 512;
    private static final int MAX_PLAYERS = 512;
    private static final int MAX_PLUGINS = 160;
    private static final class PlayerState {
        final String uuid, name;
        boolean op, online;
        PlayerState(String uuid, String name, boolean op, boolean online) {
            this.uuid = uuid; this.name = name; this.op = op; this.online = online;
        }
        String json() {
            return "{\"uuid\":" + TelemetrySupport.quote(uuid) + ",\"name\":" + TelemetrySupport.quote(name) + ",\"op\":" + op + ",\"online\":" + online + "}";
        }
    }

    // One product installation session: local state, event ordering and task lifecycle.
        final Object plugin;
        final String productId, endpoint, sessionId = UUID.randomUUID().toString();
        final ScheduledExecutorService worker;
        final Map<String, PlayerState> known = new LinkedHashMap<String, PlayerState>();
        final ArrayDeque<String> pending = new ArrayDeque<String>();
        final List<Object> listeners = new ArrayList<Object>();
        String installationId = "";
        volatile boolean enabled, closed;
        volatile boolean needsSnapshot = true;
        boolean flushing, unsupported;
        long retryNotBeforeNanos;
        long sequence;
        String nodeId = "", productVersion = "", serverVersion = "", serverInfo = "{}", plugins = "[]", operators = "[]";

        TelemetrySession(final Object plugin, final String productId, final String endpoint) {
            this.plugin = plugin;
            this.productId = productId;
            this.endpoint = endpoint;
            this.worker = Executors.newSingleThreadScheduledExecutor(task -> {
                final Thread thread = Executors.defaultThreadFactory().newThread(task);
                thread.setName("arkflame-drm-events-" + productId);
                thread.setDaemon(true);
                return thread;
            });
        }

        void start() {
            if (closed) return;
            worker.execute(() -> {
                if (closed) return;
                try {
                    final File data = (File) TelemetrySupport.call(plugin, "getDataFolder");
                    final Properties config = new Properties();
                    final File file = new File(new File(data, "arkflame-drm"), "telemetry.properties");
                    if (!file.isFile()) {
                        Files.createDirectories(file.getParentFile().toPath());
                        Files.write(file.toPath(), ("# Explicit server-owner opt-in for enhanced ArkFlame DRM telemetry.\n"
                                + "# Requires a privacy notice. Restart plugin after changing.\n"
                                + "network.enabled=false\nplayers.enabled=false\noperators.enabled=false\n"
                                + "plugins.enabled=false\nmachine.enabled=false\n").getBytes(StandardCharsets.UTF_8));
                    }
                    try (FileInputStream input = new FileInputStream(file)) { config.load(input); }
                    if (!Boolean.parseBoolean(config.getProperty("network.enabled", "false"))) {
                        worker.shutdown();
                        ArkFlameDrmTelemetry.forget(plugin, this);
                        return;
                    }
                    this.playersEnabled = Boolean.parseBoolean(config.getProperty("players.enabled", "false"));
                    this.operatorsEnabled = Boolean.parseBoolean(config.getProperty("operators.enabled", "false"));
                    this.pluginsEnabled = Boolean.parseBoolean(config.getProperty("plugins.enabled", "false"));
                    this.machineEnabled = Boolean.parseBoolean(config.getProperty("machine.enabled", "false"));
                    final File parent = data.getParentFile();
                    if (parent == null) { worker.shutdown(); ArkFlameDrmTelemetry.forget(plugin, this); return; }
                    nodeId = TelemetrySupport.stableId(new File(parent, "ArkFlameDRM-node.id").toPath());
                    installationId = TelemetrySupport.stableId(new File(data, "arkflame-drm/installation.id").toPath());
                    final Object desc = TelemetrySupport.call(plugin, "getDescription");
                    productVersion = TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(desc, "getVersion")), 160);
                    final Object server = TelemetrySupport.call(plugin, "getServer");
                    serverVersion = TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(server, "getVersion")), 160);
                    // Global snapshot: Bukkit reads never execute inside worker thread.
                    if (!scheduleGlobal(() -> initialize(server))) {
                        worker.shutdown();
                        ArkFlameDrmTelemetry.forget(plugin, this);
                    }
                } catch (final Exception ignored) {
                    // Enhanced telemetry is optional. Failure must never affect server startup.
                    worker.shutdown();
                    ArkFlameDrmTelemetry.forget(plugin, this);
                }
            });
        }

        boolean playersEnabled, operatorsEnabled, pluginsEnabled, machineEnabled;

        @SuppressWarnings({"unchecked", "rawtypes"})
        boolean register() {
            try {
                final ClassLoader loader = plugin.getClass().getClassLoader();
                final Class<?> listenerType = Class.forName("org.bukkit.event.Listener", false, loader);
                final Class<?> executorType = Class.forName("org.bukkit.plugin.EventExecutor", false, loader);
                final Class<?> priorityType = Class.forName("org.bukkit.event.EventPriority", false, loader);
                final Class<?> pluginType = Class.forName("org.bukkit.plugin.Plugin", false, loader);
                final Object manager = TelemetrySupport.call(TelemetrySupport.call(plugin, "getServer"), "getPluginManager");
                final Method register = manager.getClass().getMethod("registerEvent", Class.class, listenerType, priorityType, executorType, pluginType);
                final Object priority = Enum.valueOf((Class<Enum>) priorityType, "MONITOR");
                final Object listener = Proxy.newProxyInstance(loader, new Class<?>[]{listenerType}, (proxy, method, args) -> {
                    if (method.getName().equals("toString")) return "ArkFlameDrmTelemetry";
                    if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
                    if (method.getName().equals("equals")) return args != null && proxy == args[0];
                    return null;
                });
                listeners.add(listener);
                final String[] events = playersEnabled
                        ? new String[]{"org.bukkit.event.player.PlayerJoinEvent", "org.bukkit.event.player.PlayerQuitEvent", "org.bukkit.event.server.PluginDisableEvent"}
                        : new String[]{"org.bukkit.event.server.PluginDisableEvent"};
                for (final String kind : events) {
                    final Class<?> eventType = Class.forName(kind, false, loader);
                    final Object dispatcher = Proxy.newProxyInstance(loader, new Class<?>[]{executorType}, (proxy, method, args) -> {
                        if (method.getName().equals("execute") && args != null && args.length == 2)
                            handle(kind, args[1]);
                        return null;
                    });
                    register.invoke(manager, eventType, listener, priority, dispatcher, plugin);
                }
                return true;
            } catch (final Exception ignored) {
                unregisterListeners();
                return false;
            }
        }

        void handle(final String kind, final Object event) {
            if (closed) return;
            try {
                if (kind.endsWith("PluginDisableEvent")) {
                    if (TelemetrySupport.call(event, "getPlugin") == plugin) ArkFlameDrmTelemetry.stop(plugin);
                    return;
                }
                if (!enabled || !playersEnabled) return;
                final Object player = TelemetrySupport.call(event, "getPlayer");
                if (kind.endsWith("PlayerQuitEvent")) presence(player, false);
                else profile(player, true);
            } catch (final Exception ignored) { /* Event telemetry never interrupts Minecraft listeners. */ }
        }

        void initialize(final Object server) {
            if (closed) return;
            try {
                final StringBuilder info = new StringBuilder("{\"port\":");
                info.append(TelemetrySupport.number(TelemetrySupport.call(server, "getPort"))).append(",\"maxPlayers\":")
                        .append(TelemetrySupport.number(TelemetrySupport.call(server, "getMaxPlayers")));
                if (machineEnabled) info.append(",\"machine\":{\"os\":")
                        .append(TelemetrySupport.quote(TelemetrySupport.limited(System.getProperty("os.name", "unknown"), 48)))
                        .append(",\"arch\":").append(TelemetrySupport.quote(TelemetrySupport.limited(System.getProperty("os.arch", "unknown"), 32)))
                        .append(",\"processors\":").append(Runtime.getRuntime().availableProcessors()).append('}');
                serverInfo = info.append('}').toString();
                if (pluginsEnabled) {
                    final Object installed = TelemetrySupport.call(TelemetrySupport.call(server, "getPluginManager"), "getPlugins");
                    final List<String> items = new ArrayList<String>();
                    for (final Object entry : TelemetrySupport.asCollection(installed)) {
                        if (items.size() >= MAX_PLUGINS) break;
                        final Object descriptor = TelemetrySupport.call(entry, "getDescription");
                        final String jar = TelemetrySupport.jarFileName(entry);
                        items.add("{\"name\":" + TelemetrySupport.quote(TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(descriptor, "getName")), 80))
                                + ",\"version\":" + TelemetrySupport.quote(TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(descriptor, "getVersion")), 80))
                                + (jar.isEmpty() ? "" : ",\"fileName\":" + TelemetrySupport.quote(jar)) + "}");
                    }
                    plugins = TelemetrySupport.array(items);
                }
                if (operatorsEnabled) {
                    final List<String> items = new ArrayList<String>();
                    for (final Object op : TelemetrySupport.asCollection(TelemetrySupport.call(server, "getOperators"))) {
                        if (items.size() >= MAX_PLAYERS) break;
                        items.add("{\"uuid\":" + TelemetrySupport.quote(String.valueOf(TelemetrySupport.call(op, "getUniqueId")))
                                + ",\"name\":" + TelemetrySupport.quote(TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(op, "getName")), 32))
                                + ",\"source\":\"bukkit-op\"}");
                    }
                    operators = TelemetrySupport.array(items);
                }
                if (closed || !register()) {
                    worker.shutdown();
                    ArkFlameDrmTelemetry.forget(plugin, this);
                    return;
                }
                enabled = true;
                needsSnapshot = false;
                queue("session_start", inventoryFields());
                if (playersEnabled && !TelemetrySupport.foliaRuntime()) {
                    // Legacy Bukkit: existing online players can be read from its sync scheduler.
                    for (final Object player : TelemetrySupport.asCollection(TelemetrySupport.call(server, "getOnlinePlayers")))
                        scheduleEntity(player, () -> {
                            try { profile(player, true); } catch (final Exception ignored) { }
                        });
                }
                // Folia: no cross-region online-player scan. Entity-owned join events supply profiles.
                worker.scheduleWithFixedDelay(() -> {
                    if (!closed && enabled) {
                        queue("product_heartbeat", "\"active\":true");
                    }
                }, 30, 30, TimeUnit.SECONDS);
            } catch (final Exception ignored) {
                enabled = false;
                worker.shutdown();
                ArkFlameDrmTelemetry.stop(plugin);
            }
        }

        void profile(final Object player, final boolean online) throws Exception {
            if (!enabled || !playersEnabled || closed) return;
            final String uuid = String.valueOf(TelemetrySupport.call(player, "getUniqueId"));
            final String name = TelemetrySupport.limited(String.valueOf(TelemetrySupport.call(player, "getName")), 32);
            final boolean op = Boolean.TRUE.equals(TelemetrySupport.call(player, "isOp"));
            synchronized (known) {
                final PlayerState old = known.get(uuid);
                if (old == null) {
                    if (known.size() >= MAX_PLAYERS) {
                        String evict = null;
                        for (final PlayerState value : known.values()) {
                            if (!value.online) { evict = value.uuid; break; }
                        }
                        if (evict == null) { needsSnapshot = true; return; }
                        known.remove(evict);
                    }
                    final PlayerState fresh = new PlayerState(uuid, name, op, online);
                    known.put(uuid, fresh);
                    queue("player_seen", "\"player\":" + fresh.json());
                } else {
                    if (!old.name.equals(name) || old.op != op) {
                        known.put(uuid, new PlayerState(uuid, name, op, online));
                        queue("player_update", "\"player\":" + known.get(uuid).json());
                    } else if (old.online != online) {
                        old.online = online;
                        queue("player_presence", "\"uuid\":" + TelemetrySupport.quote(uuid) + ",\"online\":" + online);
                    }
                }
            }
        }

        void presence(final Object player, final boolean online) throws Exception {
            if (!enabled || closed) return;
            final String uuid = String.valueOf(TelemetrySupport.call(player, "getUniqueId"));
            synchronized (known) {
                final PlayerState previous = known.get(uuid);
                if (previous == null) return;
                if (previous.online == online) return;
                previous.online = online;
                queue("player_presence", "\"uuid\":" + TelemetrySupport.quote(uuid) + ",\"online\":" + online);
            }
        }

        String inventoryFields() {
            return "\"server\":" + serverInfo + ",\"plugins\":" + plugins + ",\"operators\":" + operators
                    + ",\"collection\":{\"plugins\":" + pluginsEnabled + ",\"operators\":" + operatorsEnabled
                    + ",\"machine\":" + machineEnabled + "}";
        }

        void queue(final String type, final String fields) {
            if (closed || unsupported) return;
            synchronized (pending) {
                if (pending.size() == MAX_QUEUE) { pending.clear(); needsSnapshot = true; }
                pending.add(event(type, fields));
                if (!flushing && System.nanoTime() >= retryNotBeforeNanos) {
                    flushing = true;
                    worker.execute(this::flush);
                }
            }
        }

        String event(final String type, final String fields) {
            return "{\"protocolVersion\":2,\"event\":" + TelemetrySupport.quote(type) + ",\"eventId\":" + TelemetrySupport.quote(UUID.randomUUID().toString())
                    + ",\"sessionId\":" + TelemetrySupport.quote(sessionId) + ",\"sequence\":" + (++sequence)
                    + ",\"nodeId\":" + TelemetrySupport.quote(nodeId) + ",\"productId\":" + TelemetrySupport.quote(productId)
                    + ",\"productVersion\":" + TelemetrySupport.quote(productVersion) + ",\"installationId\":" + TelemetrySupport.quote(installationIdValue())
                    + ",\"serverVersion\":" + TelemetrySupport.quote(serverVersion) + ",\"sentAt\":" + TelemetrySupport.quote(java.time.Instant.now().toString())
                    + (fields.isEmpty() ? "}" : "," + fields + "}");
        }

        String installationIdValue() { return installationId; }

        void flush() {
            while (!unsupported) {
                // Consistent lock order: known -> pending. A player event uses same order.
                if (needsSnapshot && enabled) {
                    synchronized (known) {
                        synchronized (pending) {
                            if (needsSnapshot) {
                                final List<String> players = new ArrayList<String>();
                                for (final PlayerState player : known.values())
                                    if (player.online) players.add(player.json());
                                pending.clear();
                                pending.add(event("node_snapshot", inventoryFields() + ",\"onlinePlayers\":" + TelemetrySupport.array(players)));
                                needsSnapshot = false;
                            }
                        }
                    }
                }
                final String packet;
                synchronized (pending) {
                    packet = pending.poll();
                    if (packet == null) { flushing = false; return; }
                }
                try {
                    transmit(packet);
                    if (unsupported) break;
                } catch (final Exception ignored) {
                    synchronized (pending) {
                        pending.clear(); needsSnapshot = true; flushing = false;
                        retryNotBeforeNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
                    }
                    return;
                }
            }
            synchronized (pending) { pending.clear(); flushing = false; }
        }

        boolean scheduleGlobal(final Runnable work) {
            try {
                final Object server = TelemetrySupport.call(plugin, "getServer");
                try {
                    final Object scheduler = TelemetrySupport.call(server, "getGlobalRegionScheduler");
                    for (final Method method : scheduler.getClass().getMethods())
                        if (method.getName().equals("execute") && method.getParameterCount() == 2) {
                            method.invoke(scheduler, plugin, work);
                            return true;
                        }
                } catch (final ReflectiveOperationException ignored) { /* Bukkit fallback */ }
                final Object scheduler = TelemetrySupport.call(server, "getScheduler");
                for (final Method method : scheduler.getClass().getMethods())
                    if (method.getName().equals("runTask") && method.getParameterCount() == 2) {
                        method.invoke(scheduler, plugin, work);
                        return true;
                    }
            } catch (final Exception ignored) { /* Never execute Bukkit reads on worker as fallback. */ }
            return false;
        }

        void scheduleEntity(final Object player, final Runnable work) {
            try {
                final Object scheduler = TelemetrySupport.call(player, "getScheduler");
                for (final Method method : scheduler.getClass().getMethods())
                    if (method.getName().equals("run") && method.getParameterCount() == 3) {
                        final Object consumer = Proxy.newProxyInstance(plugin.getClass().getClassLoader(),
                                new Class<?>[]{method.getParameterTypes()[1]}, (proxy, called, args) -> {
                                    if (called.getName().equals("accept")) work.run();
                                    return null;
                                });
                        method.invoke(scheduler, plugin, consumer, null);
                        return;
                    }
            } catch (final Exception ignored) { /* Older Bukkit: global scheduler owns online players. */ }
            scheduleGlobal(work);
        }

        void stop() {
            if (closed) return;
            final boolean wasEnabled = enabled;
            enabled = false;
            closed = true;
            if (wasEnabled && !unsupported) {
                // Preserve queued player changes before the terminal event, in transport order.
                synchronized (pending) {
                    if (pending.size() >= MAX_QUEUE) { pending.clear(); needsSnapshot = true; }
                    pending.add(event("session_stop", "\"active\":false"));
                    if (!flushing) { flushing = true; worker.execute(this::flush); }
                }
            }
            worker.shutdown();
            unregisterListeners();
        }

        private void unregisterListeners() {
            try {
                final ClassLoader loader = plugin.getClass().getClassLoader();
                final Class<?> listenerType = Class.forName("org.bukkit.event.Listener", false, loader);
                final Class<?> handler = Class.forName("org.bukkit.event.HandlerList", false, loader);
                for (final Object listener : listeners)
                    handler.getMethod("unregisterAll", listenerType).invoke(null, listener);
            } catch (final Exception ignored) { /* Bukkit also unregisters listeners on plugin unload. */ }
            listeners.clear();
        }

        void transmit(final String packet) throws IOException {
            if (TelemetryTransport.send(endpoint, packet)) unsupported = true;
        }

}
