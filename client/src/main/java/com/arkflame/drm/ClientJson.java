package com.arkflame.drm;

/** Shared v1 JSON encoding without third-party runtime dependencies. */
final class ClientJson {
    private ClientJson() { }
    static String shorten(final String value) { return value.length() <= 160 ? value : value.substring(0, 160); }
    static String escape(final String value) {
        final StringBuilder out = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            final char c = value.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '"': out.append("\\\""); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        final String hex = Integer.toHexString(c);
                        out.append("\\u");
                        for (int n = hex.length(); n < 4; n++) out.append('0');
                        out.append(hex);
                    } else out.append(c);
            }
        }
        return out.toString();
    }
}
