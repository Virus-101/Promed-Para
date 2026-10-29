package ma.promedpara.owner;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Updates the app from the till: reads android-version.json, downloads the APK and hands it to Android's installer (one confirmation tap). */
final class Updater {
    private static boolean asked;
    private Updater() {}

    /** The newest version name when it is newer than the installed one, else null (used by the background service). */
    static String latest(android.content.Context context, String savedAddress) {
        try {
            String base = Relay.isRelayAddress(savedAddress) ? "https://github.com/Virus-101/Promed-Para/releases/latest/download" : savedAddress;
            if (base == null || base.isEmpty()) return null;
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/android-version.json").openConnection();
            c.setConnectTimeout(5000); c.setReadTimeout(5000);
            if (c.getResponseCode() != 200) return null;
            JSONObject info = new JSONObject(new String(readAll(c.getInputStream()), "UTF-8"));
            android.content.pm.PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long local = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            return info.optLong("versionCode", 0) > local ? info.optString("versionName", "") : null;
        } catch (Exception e) { return null; }
    }

    static void check(final Activity activity, final String savedAddress, final String apkName) {
        // away from the shop Wi-Fi the files come from the public GitHub release instead of the till
        final String base = Relay.isRelayAddress(savedAddress) ? "https://github.com/Virus-101/Promed-Para/releases/latest/download" : savedAddress;
        if (asked || base == null || base.isEmpty()) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/android-version.json").openConnection();
                c.setConnectTimeout(4000); c.setReadTimeout(4000);
                if (c.getResponseCode() != 200) return;
                JSONObject info = new JSONObject(new String(readAll(c.getInputStream()), "UTF-8"));
                long remote = info.optLong("versionCode", 0), local;
                local = Build.VERSION.SDK_INT >= 28 ? activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).getLongVersionCode() : activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionCode;
                if (remote <= local) return;
                final String name = info.optString("versionName", String.valueOf(remote));
                asked = true;
                activity.runOnUiThread(() -> new AlertDialog.Builder(activity)
                    .setTitle("Mise à jour disponible")
                    .setMessage("La version " + name + " de l’application est prête. Installer maintenant ? Android vous demandera de confirmer.")
                    .setPositiveButton("Installer", (d, w) -> install(activity, base + "/" + apkName))
                    .setNegativeButton("Plus tard", (d, w) -> {})
                    .show());
            } catch (Exception ignored) { }
        }).start();
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16384]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static void install(final Activity activity, final String apkUrl) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(activity, "Autorisez PromedPara à installer des applications, puis revenez.", Toast.LENGTH_LONG).show();
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            asked = false;
            return;
        }
        Toast.makeText(activity, "Téléchargement de la mise à jour…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                int id = installer.createSession(params);
                PackageInstaller.Session session = installer.openSession(id);
                HttpURLConnection c = (HttpURLConnection) new URL(apkUrl).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(20000);
                try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("update", 0, -1)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                final String action = activity.getPackageName() + ".UPDATE_RESULT";
                activity.getApplicationContext().registerReceiver(new BroadcastReceiver() {
                    @Override public void onReceive(Context context, Intent intent) {
                        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                            if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(confirm); }
                        } else {
                            if (status != PackageInstaller.STATUS_SUCCESS) { asked = false; Toast.makeText(context, "Mise à jour non installée.", Toast.LENGTH_LONG).show(); }
                            try { context.unregisterReceiver(this); } catch (Exception ignored) { }
                        }
                    }
                }, new IntentFilter(action), Context.RECEIVER_NOT_EXPORTED);
                Intent intent = new Intent(action).setPackage(activity.getPackageName());
                PendingIntent pending = PendingIntent.getBroadcast(activity, id, intent, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                session.commit(pending.getIntentSender());
                session.close();
            } catch (Exception e) {
                asked = false;
                activity.runOnUiThread(() -> Toast.makeText(activity, "Téléchargement impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }
}
