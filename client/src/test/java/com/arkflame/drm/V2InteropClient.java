package com.arkflame.drm;

import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.UUID;

/** Drives actual Java v2 envelope generator and HTTP transmitter against real Node backend. */
public final class V2InteropClient {
    public static void main(final String[] args) throws Exception {
        final Class<?> type = Class.forName("com.arkflame.drm.TelemetrySession");
        final Constructor<?> ctor = type.getDeclaredConstructor(Object.class, String.class, String.class);
        ctor.setAccessible(true);
        final Object session = ctor.newInstance(new TelemetryTest.FakePlugin(new File(args[0])), "FairPlay", args[1]);
        try {
            final String node = UUID.randomUUID().toString();
            final String player = UUID.randomUUID().toString();
            for (final String[] setting : new String[][] {
                    {"nodeId", node}, {"installationId", UUID.randomUUID().toString()},
                    {"serverVersion", "Paper 1.21.4"}, {"productVersion", "4.0.3"}
            }) {
                final Field field = type.getDeclaredField(setting[0]);
                field.setAccessible(true);
                field.set(session, setting[1]);
            }
            final Method event = type.getDeclaredMethod("event", String.class, String.class);
            final Method transmit = type.getDeclaredMethod("transmit", String.class);
            event.setAccessible(true);
            transmit.setAccessible(true);
            final String[] types = {"session_start", "player_seen", "player_presence", "player_presence"};
            final String[] data = {
                    "\"server\":{\"port\":25565,\"maxPlayers\":100},\"plugins\":[{\"name\":\"FairPlay\",\"version\":\"4.0.3\"}],\"operators\":[]",
                    "\"player\":{\"uuid\":\"" + player + "\",\"name\":\"IntegrationUser\",\"op\":true,\"online\":true}",
                    "\"uuid\":\"" + player + "\",\"online\":false",
                    "\"uuid\":\"" + player + "\",\"online\":true"
            };
            for (int i=0;i<types.length;i++) transmit.invoke(session,event.invoke(session,types[i],data[i]));
            System.out.println(node + " " + player);
        } finally {
            final Method stop = type.getDeclaredMethod("stop");
            stop.setAccessible(true);
            stop.invoke(session);
        }
    }
}
