package com.arkflame.drm;

import java.io.File;
import java.util.concurrent.TimeUnit;

/** Test the descriptor-derived product identity against the real Next.js service layer. */
public final class NameInteropClient {
    public static void main(final String[] args) throws Exception {
        final ArkFlameDrm.Result response = ArkFlameDrm.startDetected(
                new ClientTest.FakePlugin(new File(args[0])), args[1]).get(3, TimeUnit.SECONDS);
        if (!response.isReported()) throw new AssertionError("Bukkit-name report HTTP " + response.getHttpStatus());
        System.out.println("NAME_INTEROP_PASS");
    }
}
