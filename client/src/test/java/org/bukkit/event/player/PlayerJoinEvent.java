package org.bukkit.event.player;
public class PlayerJoinEvent extends org.bukkit.event.Event {
    private final Object player;
    public PlayerJoinEvent(Object player) { this.player = player; }
    public Object getPlayer() { return player; }
}
