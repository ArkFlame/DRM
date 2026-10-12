package com.arkflame.drm;

/** Verifies a shaded-class analogue resolves a JAR basename, not a host path. */
public final class JarFilenameTest {
    private JarFilenameTest() { }
    public static void main(final String[] args) {
        if (args.length != 1) throw new IllegalArgumentException("Expected JAR basename");
        final TelemetrySession session = new TelemetrySession(new Object(), "test", "https://drm.arkflame.com/api/v2/events");
        try {
            final String actual = TelemetrySupport.jarFileName(session);
            if (!args[0].equals(actual)) throw new AssertionError("Unexpected JAR basename: " + actual);
            System.out.println("JAVA_JAR_FILENAME_PASS=1");
        } finally {
            session.worker.shutdownNow();
        }
    }
}
