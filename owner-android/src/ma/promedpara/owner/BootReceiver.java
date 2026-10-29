package ma.promedpara.owner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** After the phone restarts or the app is updated, the alert service starts again by itself (the pairing and the data are untouched). */
public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("monitoring", false) || prefs.getString("deviceToken", "").isEmpty()) return;
        try {
            Intent service = new Intent(context, MonitorService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service); else context.startService(service);
        } catch (Exception ignored) { /* the owner can start it again from the app */ }
    }
}
