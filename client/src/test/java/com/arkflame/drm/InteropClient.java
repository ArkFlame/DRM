package com.arkflame.drm;
import java.io.File;
import java.util.concurrent.TimeUnit;
public final class InteropClient {
    public static void main(final String[] args) throws Exception {
        final ArkFlameDrm.Result result = ArkFlameDrm.start(new File(args[0]), "interop-test",
                "1.0.0", "Paper 1.21", args[1]).get(3, TimeUnit.SECONDS);
        if (!result.isReported()) throw new AssertionError("HTTP code: " + result.getHttpStatus());
        System.out.println("END_TO_END_CLIENT_PASS");
    }
}
