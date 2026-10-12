package com.arkflame.drm;

import java.io.IOException;

/** v2 status handling shares the bounded v1 HTTP transport. */
final class TelemetryTransport {
    private TelemetryTransport() { }

    /** True only when endpoint reports protocol v2 unsupported. */
    static boolean send(final String endpoint, final String packet) throws IOException {
        final int status = ClientHttp.post(endpoint, packet);
        if (status == 404 || status == 405 || status == 410) return true;
        if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
        return false;
    }
}
