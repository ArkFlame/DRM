package com.arkflame.drm;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** V1/v2 concurrent bootstraps must never rewrite one another's installation UUID. */
public final class ConcurrentIdentityTest {
    public static void main(final String[] args) throws Exception {
        final Path directory = Files.createTempDirectory("drm-identity-race-");
        final ExecutorService workers = Executors.newFixedThreadPool(12);
        final CountDownLatch start = new CountDownLatch(1);
        try {
            final List<Future<String>> results = new ArrayList<Future<String>>();
            for (int i = 0; i < 48; i++) {
                final boolean legacy = (i & 1) == 0;
                results.add(workers.submit(new Callable<String>() {
                    @Override public String call() throws Exception {
                        start.await();
                        return legacy ? ClientIdentity.installationId(directory.toFile())
                                : TelemetrySupport.stableId(directory.resolve("installation.id"));
                    }
                }));
            }
            start.countDown();
            final String first = results.get(0).get();
            for (final Future<String> next : results)
                if (!first.equals(next.get())) throw new AssertionError("Concurrent V1/V2 identities diverged");
            if (!first.equals(new String(Files.readAllBytes(directory.resolve("installation.id")), StandardCharsets.UTF_8)))
                throw new AssertionError("Persisted ID does not match reports");
            if (!UUID.fromString(first).toString().equals(first)) throw new AssertionError("Invalid generated UUID");
            System.out.println("JAVA_CONCURRENT_IDENTITY_TEST_PASS=3");
        } finally {
            workers.shutdownNow();
        }
    }
}
