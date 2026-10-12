package org.bukkit.event.player;
public class PlayerQuitEvent extends org.bukkit.event.Event {
    private final Object player;
    public PlayerQuitEvent(Object player) { this.player = player; }
    public Object getPlayer() { return player; }
}
