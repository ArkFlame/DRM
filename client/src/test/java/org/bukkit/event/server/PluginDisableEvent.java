package org.bukkit.event.server;
public class PluginDisableEvent extends org.bukkit.event.Event {
    private final org.bukkit.plugin.Plugin plugin;
    public PluginDisableEvent(org.bukkit.plugin.Plugin plugin) { this.plugin = plugin; }
    public org.bukkit.plugin.Plugin getPlugin() { return plugin; }
}
