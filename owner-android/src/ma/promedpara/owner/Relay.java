package ma.promedpara.owner;

import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The internet link: the phone talks to the shop till through a relay, so it works on mobile data or any Wi-Fi.
 * Everything that crosses the relay is AES-256-GCM ciphertext; the relay cannot read it.
 * A relay address looks like https://host/&lt;16 hex&gt; (the till shows it in "Connecter mon téléphone").
 */
final class Relay {
    private static final Pattern ADDRESS = Pattern.compile("(?i)^(https?://[^/\\s]+)/([a-f0-9]{16})/?$");
    private static final SecureRandom RANDOM = new SecureRandom();
    private Relay() {}

    static boolean isRelayAddress(String address) { return address != null && ADDRESS.matcher(address.trim()).matches(); }
    static String relayBase(String address) { Matcher m = ADDRESS.matcher(address.trim()); return m.matches() ? m.group(1) : ""; }
    static String tillId(String address) { Matcher m = ADDRESS.matcher(address.trim()); return m.matches() ? m.group(2).toLowerCase(java.util.Locale.ROOT) : ""; }
    static String clean(String address) { return isRelayAddress(address) ? relayBase(address) + "/" + tillId(address) : address; }

    /** A call with the saved device key (normal use). */
    static MainActivity.Result call(SharedPreferences prefs, String method, String path, String cookie, String json) throws Exception {
        String address = prefs.getString("server", ""), key = prefs.getString("relayKey", "");
        if (key.length() != 64) throw new Exception("Ce téléphone n’a pas la clé de liaison. Associez-le à nouveau.");
        return send(address, "k", hex(key), method, path, cookie, json);
    }

    /** First pairing: the key comes from the one-time code, and the till answers with the long-term key. */
    static MainActivity.Result enroll(String address, String code, String json) throws Exception {
        byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(new PBEKeySpec(code.toCharArray(), ("promed-enroll:" + tillId(address)).getBytes(StandardCharsets.UTF_8), 60000, 256)).getEncoded();
        return send(address, "e", key, "POST", "/api/owner/enroll", "", json);
    }

    /** An owner who cannot sign in asks the administrator for a code (no key needed: the till only turns it into a notification). */
    static MainActivity.Result ring(String address, String name) throws Exception {
        String body = new JSONObject().put("m", "r").put("name", name).toString();
        HttpURLConnection c = (HttpURLConnection) new URL(relayBase(address) + "/p/" + tillId(address)).openConnection();
        c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(40000); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Connection", "close");
        try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        if (in != null) { byte[] chunk = new byte[4096]; int n; while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n); in.close(); }
        c.disconnect();
        if (status == 503) throw new Exception("La caisse est hors ligne (éteinte ou sans internet).");
        if (status != 200) throw new Exception("Liaison internet indisponible (" + status + ").");
        JSONObject reply = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8)).getJSONObject("r");
        return new MainActivity.Result(reply.optInt("s", 500), reply.optString("b", ""), "");
    }

    private static MainActivity.Result send(String address, String mode, byte[] key, String method, String path, String cookie, String json) throws Exception {
        String nonce = randomHex(8);
        JSONObject plain = new JSONObject().put("n", nonce).put("t", System.currentTimeMillis()).put("x", method).put("p", path).put("c", cookie == null ? "" : cookie).put("b", json == null ? "" : json);
        String body = new JSONObject().put("m", mode).put("d", seal(key, plain.toString())).toString();
        HttpURLConnection c = (HttpURLConnection) new URL(relayBase(address) + "/p/" + tillId(address)).openConnection();
        c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(40000); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Connection", "close");
        try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        if (in != null) { byte[] chunk = new byte[4096]; int n; while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n); in.close(); }
        c.disconnect();
        String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        if (status == 503) throw new Exception("La caisse est hors ligne (éteinte ou sans internet).");
        if (status == 504) throw new Exception("La caisse ne répond pas. Réessayez.");
        if (status == 429) throw new Exception("Trop de requêtes, patientez un instant.");
        if (status != 200) throw new Exception("Liaison internet indisponible (" + status + ").");
        JSONObject reply = new JSONObject(text);
        if (reply.has("e")) throw new Exception("La caisse a refusé la liaison. Associez à nouveau ce téléphone.");
        JSONObject inner = new JSONObject(open(key, reply.getString("d")));
        if (!nonce.equals(inner.optString("n"))) throw new Exception("Réponse inattendue de la caisse.");
        return new MainActivity.Result(inner.optInt("s", 500), inner.optString("b", ""), inner.optString("c", ""));
    }

    private static String seal(byte[] key, String text) throws Exception {
        byte[] iv = new byte[12]; RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] sealed = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));   // ciphertext || 16-byte tag
        byte[] all = new byte[12 + sealed.length];
        System.arraycopy(iv, 0, all, 0, 12); System.arraycopy(sealed, 0, all, 12, sealed.length);
        return android.util.Base64.encodeToString(all, android.util.Base64.NO_WRAP);
    }

    private static String open(byte[] key, String b64) throws Exception {
        byte[] all = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
        if (all.length < 29) throw new Exception("Réponse invalide.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, all, 0, 12));
        return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }

    private static byte[] hex(String s) { byte[] out = new byte[s.length() / 2]; for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16); return out; }
    private static String randomHex(int bytes) { byte[] b = new byte[bytes]; RANDOM.nextBytes(b); StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x)); return sb.toString(); }
}
