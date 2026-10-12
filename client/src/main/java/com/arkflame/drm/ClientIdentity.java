package com.arkflame.drm;

import java.io.File;
import java.io.IOException;

/** V1 and V2 share one cross-classloader-safe installation identity writer. */
final class ClientIdentity {
    private ClientIdentity() { }

    static String installationId(final File folder) throws IOException {
        return TelemetrySupport.stableId(folder.toPath().resolve("installation.id"));
    }
}
