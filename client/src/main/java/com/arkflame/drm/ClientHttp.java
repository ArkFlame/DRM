package com.arkflame.drm;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Bounded, no-redirect reporting; callers own asynchronous execution. */
final class ClientHttp {
    private ClientHttp() { }
    static int post(final String endpoint, final String body) throws IOException {
        final byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        final HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(500);
            connection.setReadTimeout(500);
            connection.setDoOutput(true);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("User-Agent", "ArkFlameDRM/0.6.4");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            return connection.getResponseCode();
        } finally { connection.disconnect(); }
    }
}
